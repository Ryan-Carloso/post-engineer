"""Image + renderer for the LongCat Modal app.

Split out of ``modal_longcat.py`` purely for file size: the container build and
the torchrun invocation are a big, self-contained block that changes for
different reasons than the HTTP surface next to it.

Deliberately NOT here: anything Modal-decorated. ``download_weights`` and
``GenerateAvatar`` stay in ``modal_longcat.py`` so ``modal deploy`` and
``modal run modal_longcat.py::download_weights`` keep resolving against that
module, and so the job-status writer is a plain call rather than something this
module has to be handed.

Nothing here is imported by the engine at runtime; the client
(``app/services/longcat.py``) only talks to the deployed HTTP endpoints. The
literals shared with that client (``MAX_SEGMENTS``, ``GPU``, ``GPU_RATE_USD_S``)
are pinned by the sync tests in ``test/services/test_longcat.py``, which read
this file alongside ``modal_longcat.py``.
"""

from __future__ import annotations

import os
import subprocess
import tempfile
import time
from pathlib import Path
from typing import TYPE_CHECKING, Final

import modal

if TYPE_CHECKING:
    from modal_longcat_resident import ResidentRenderer

LONGCAT_REPO_URL = "https://github.com/meituan-longcat/LongCat-Video.git"

WEIGHTS_DIR = "/weights"
BASE_WEIGHTS_DIR = f"{WEIGHTS_DIR}/LongCat-Video"
AVATAR_WEIGHTS_DIR = f"{WEIGHTS_DIR}/LongCat-Video-Avatar-1.5"

# Both checkpoints live on the same persistent volume: Avatar-1.5 builds on the
# LongCat-Video foundation model and the loader expects both trees under /weights.
WEIGHTS_VOLUME = modal.Volume.from_name("longcat-models", create_if_missing=True)
LONGCAT_BASE_REPO = "meituan-longcat/LongCat-Video"
LONGCAT_AVATAR_REPO = "meituan-longcat/LongCat-Video-Avatar-1.5"

# H200 (141GB) removes any capacity doubt for the clip lengths production
# renders, so an OOM means a real bug rather than a tight fit. Rate is Modal's
# published per-second price; app/services/longcat.py mirrors it in
# GPU_RATES_USD_S and a sync test pins the two against each other.
# The GPU the renderer asks Modal for. Overridable per deployment so a region
# without H200 capacity can fall back to another card the model is known to fit
# on, without editing and redeploying this module.
#
# VRAM is the constraint, not speed: the checkpoints plus the KV cache need
# roughly 54GB+ before inference starts. 48GB (L40S) OOMs; 80GB (H100, A100-80GB)
# is the documented working floor; 141GB (H200) is headroom.
GPU_RATES: Final[dict[str, float]] = {
    "H200": 0.001261,
    "H100": 0.001097,
    "A100-80GB": 0.000694,
}

# Ordered preference handed to Modal. Modal tries each in order and falls back
# only when the preferred type has no capacity, which is what keeps a persona
# video from sitting in "waiting to be scheduled" through a hardware shortage.
#
# H100 leads because it is the cheapest card the model is KNOWN to run on and
# carries the best throughput per dollar measured here (an A100 render costs
# ~1.5x more despite a 37% cheaper rate, because it needs ~2.4x the GPU
# seconds). H200 is the fallback: faster, more VRAM, slightly pricier.
GPU_PREFERENCE: Final[list[str]] = ["H100", "H200"]

GPU = os.environ.get("LONGCAT_GPU", "")
if GPU:
    # Pinned mode, used by the GPU-comparison benchmarks.
    if GPU not in GPU_RATES:
        raise RuntimeError(f"LONGCAT_GPU={GPU!r} is not one of {sorted(GPU_RATES)}")
    GPU_PREFERENCE = [GPU]
GPU_RATE_USD_S = GPU_RATES[GPU_PREFERENCE[0]]


def active_gpu_name() -> str | None:
    """Name of the GPU this container actually got, e.g. "H100".

    Necessary because Modal may serve a fallback list with any of its members,
    and each is billed at its OWN rate. Cost reporting asks this instead of
    assuming the first preference ran, otherwise an H200 fallback would be
    priced as an H100.
    """
    try:
        import torch
    except ImportError:
        return None
    if not torch.cuda.is_available():
        return None
    reported = torch.cuda.get_device_name(0)
    # Match the LONGEST priced name first and require the reported string to
    # carry the model, not merely a prefix: a naive substring test maps
    # "NVIDIA B200" onto the H200 entry because "B200" contains "200", and
    # pricing a run on a card we do not price is exactly the mis-report this
    # function exists to prevent.
    for known in sorted(GPU_RATES, key=len, reverse=True):
        if known.replace("-80GB", "") in reported:
            return known
    return reported or None


def rate_for_active_gpu() -> float:
    """USD/second to charge this run, based on the GPU it actually got.

    Falls back to the preferred card's rate when detection fails, which is the
    conservative choice: it never under-reports a run that really ran on
    something pricier.
    """
    name = active_gpu_name()
    return GPU_RATES.get(name or "", GPU_RATES[GPU_PREFERENCE[0]])

# Clip length is set by --num_segments: 93 frames for the first segment plus
# (93 - 13) = 80 new frames per extra one, at 25 fps. The client derives the
# count from the real trimmed audio; this ceiling bounds a single job's GPU
# time and must match MAX_SEGMENTS in app/services/longcat.py, which is what
# keeps a request from failing AFTER a paid submit.
MAX_SEGMENTS = 5

# Clip length is set by --num_segments, not by the audio: the script hardcodes
# num_frames = 93 per segment and appends 80 new frames per extra segment.
# app.services.longcat.clip_seconds() owns that arithmetic; the frames
# themselves must satisfy the pipeline's 4n+1 constraint, which is why 93 is not
# a free parameter.

LONGCAT_IMAGE = (
    modal.Image.from_registry(
        "pytorch/pytorch:2.6.0-cuda12.4-cudnn9-devel",
        add_python="3.10",
    )
    .apt_install("git", "ffmpeg", "libgl1", "libglib2.0-0", "libsndfile1")
    .pip_install("ninja", "packaging", "psutil")
    # The HTTP surface in modal_longcat.py is decorated with Modal's
    # fastapi_endpoint, which Modal no longer installs implicitly -- without
    # this the deploy fails with "require FastAPI to be installed in their
    # Image". loguru is imported by the request handlers at call time.
    .pip_install("fastapi[standard]", "loguru")
    .pip_install(
        "torch==2.6.0",
        "torchvision==0.21.0",
        "torchaudio==2.6.0",
        index_url="https://download.pytorch.org/whl/cu124",
    )
    # Built from source: no prebuilt wheel matches this torch/CUDA pair, and
    # --no-build-isolation is required so it sees the installed torch.
    .pip_install(
        "flash_attn==2.7.4.post1",
        extra_options="--no-build-isolation",
    )
    .run_commands(f"git clone --depth 1 {LONGCAT_REPO_URL} /LongCat-Video")
    # pip_install takes a package list, not requirement-file flags: the -r form
    # must go through run_commands, and it only works after the clone above.
    .run_commands("pip install -r /LongCat-Video/requirements.txt")
    # requirements_avatar.txt is not pure-pip: upstream installs it under conda
    # and it lists packages PyPI cannot serve -- libsndfile1 (conda-forge) and
    # tritonserverclient (NVIDIA's Triton index). Either one aborts the whole
    # install, so they are filtered here. libsndfile1 comes from apt above;
    # tritonserverclient is only needed for Triton-based serving, which this
    # app does not use.
    .run_commands(
        "grep -vE '^(libsndfile1|tritonserverclient)'"
        " /LongCat-Video/requirements_avatar.txt > /tmp/requirements_avatar_pip.txt"
    )
    .run_commands("pip install -r /tmp/requirements_avatar_pip.txt")
    # modal_longcat.py imports this module at scope, so it must be present in
    # the GPU image too -- the class that runs the renderer hydrates the same
    # package root.
    .add_local_file(
        Path(__file__).resolve().parent / "modal_longcat_gpu.py",
        "/root/modal_longcat_gpu.py",
        copy=True,
    )
    # The resident renderer is imported by the Modal class's enter hook inside
    # the GPU container; it loads the model once per container, not per clip.
    .add_local_file(
        Path(__file__).resolve().parent / "modal_longcat_resident.py",
        "/root/modal_longcat_resident.py",
        copy=True,
    )
    .env(
        {
            "PYTHONPATH": "/LongCat-Video",
            # Same module-scope read as the API image: without it in the image
            # env the container never sees a deploy-time shell variable.
            "LONGCAT_MODAL_APP_NAME": os.environ.get(
                "LONGCAT_MODAL_APP_NAME", ""
            ),
        }
    )
)


def peak_vram_gb() -> float | None:
    """Peak VRAM reserved by THIS process, or None if it cannot be measured.

    Reported per clip so an OOM can be told apart from a memory-tight run.

    Returns None rather than 0.0 when the number is not trustworthy. The model
    now lives in this process, so a real run reserves tens of GB; a sub-0.1GB
    reading means the measurement missed the model, and a silent 0.0 would read
    as "this GPU has enormous headroom", the opposite of the truth.
    """
    try:
        import torch
    except ImportError:
        return None
    if not torch.cuda.is_available():
        return None
    reserved_gb = torch.cuda.max_memory_reserved() / 1e9
    # Sub-0.1GB means the measurement missed the model entirely.
    if reserved_gb < 0.1:
        return None
    return round(reserved_gb, 2)


def run_longcat(
    renderer: ResidentRenderer,
    image_bytes: bytes,
    audio_bytes: bytes,
    resolution: str,
    num_segments: int = 1,
) -> tuple[bytes, dict[str, float | None]]:
    """Generate one avatar clip and return vertical MP4 bytes plus timings.

    ``num_segments`` is upstream's documented Video Continuation knob and the
    ONLY way to change clip length: each segment is 93 frames and each extra one
    appends (93 - 13) = 80 new frames. See ``app.services.longcat.clip_seconds``
    for the arithmetic. ``renderer`` already holds the model on the GPU, so this
    pays only the per-clip diffusion cost.
    """
    import torch

    torch.cuda.reset_peak_memory_stats()

    with tempfile.TemporaryDirectory(prefix="longcat-") as work:
        work_path = Path(work)
        image_path = work_path / "reference.png"
        audio_path = work_path / "voice.wav"
        image_path.write_bytes(image_bytes)
        audio_path.write_bytes(audio_bytes)
        output_dir = work_path / "out"
        output_dir.mkdir()

        inference_started = time.monotonic()
        renderer.render(image_path, audio_path, resolution, num_segments, output_dir)
        inference_s = time.monotonic() - inference_started

        outputs = sorted(
            output_dir.rglob("*.mp4"),
            key=lambda item: item.stat().st_mtime,
        )
        if not outputs:
            raise RuntimeError("LongCat produced no MP4")

        normalize_started = time.monotonic()
        normalized = work_path / "normalized.mp4"
        # Normalize to the same vertical 1080x1920 profile the production
        # renderer expects, so the clip splices in without a resize.
        ffmpeg = subprocess.run(
            [
                "ffmpeg", "-y", "-i", str(outputs[-1]),
                "-vf", "scale=1080:1920:force_original_aspect_ratio=increase,"
                "crop=1080:1920,setsar=1",
                "-c:v", "libx264", "-crf", "18", "-preset", "medium",
                "-c:a", "aac", "-ar", "24000", "-ac", "1",
                "-movflags", "+faststart", str(normalized),
            ],
            capture_output=True,
            text=True,
            timeout=900,
        )
        normalize_s = time.monotonic() - normalize_started
        if ffmpeg.returncode != 0:
            raise RuntimeError(f"MP4 normalization failed: {ffmpeg.stderr[-2000:]}")

        return normalized.read_bytes(), {
            "inference_s": round(inference_s, 3),
            "normalize_s": round(normalize_s, 3),
            "peak_vram_gb": peak_vram_gb(),
        }
