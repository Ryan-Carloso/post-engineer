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

import json
import subprocess
import tempfile
import time
from pathlib import Path

import modal

LONGCAT_REPO_URL = "https://github.com/meituan-longcat/LongCat-Video.git"

WEIGHTS_DIR = "/weights"
AVATAR_WEIGHTS_DIR = f"{WEIGHTS_DIR}/LongCat-Video-Avatar-1.5"

# H200 (141GB) removes any capacity doubt for the clip lengths production
# renders, so an OOM means a real bug rather than a tight fit. Rate is Modal's
# published per-second price; app/services/longcat.py mirrors it in
# GPU_RATES_USD_S and a sync test pins the two against each other.
GPU = "H200"
GPU_RATE_USD_S = 0.001261

# Clip length is set by --num_segments: 93 frames for the first segment plus
# (93 - 13) = 80 new frames per extra one, at 25 fps. The client derives the
# count from the real trimmed audio; this ceiling bounds a single job's GPU
# time and must match MAX_SEGMENTS in app/services/longcat.py, which is what
# keeps a request from failing AFTER a paid submit.
MAX_SEGMENTS = 5

# Upstream defaults. --use_distill is REQUIRED for avatar-v1.5 and --use_int8
# is only supported on that same model type, so these two are not tunable.
USE_DISTILL = True
USE_INT8 = True
MODEL_TYPE = "avatar-v1.5"
# Audio guidance trades lip-sync accuracy for prompt adherence; upstream reports
# 3-5 as the sweet spot, and its own default is 4.0. Verified flag name:
# --audio_guidance_scale.
AUDIO_GUIDANCE_SCALE_DEFAULT = 4.0
# Upstream defaults that mitigate repeated gestures in longer clips.
REF_IMG_INDEX_DEFAULT = 10
MASK_FRAME_RANGE_DEFAULT = 3

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
    .add_local_file(
        Path(__file__).resolve().parent / "app" / "utils" / "longcat_vocal_patch.py",
        "/root/longcat_vocal_patch.py",
        copy=True,
    )
    # Chatterbox narration is already a clean vocal stem, so upstream's neural
    # source separation is wasted GPU time. The patch re-encodes the audio to
    # the same 16 kHz mono WAV the separator produced -- passing the raw file
    # through instead killed the child silently. It FAILS THE BUILD if
    # upstream's call site moved, so a silent no-op is impossible.
    .run_commands("python3 /root/longcat_vocal_patch.py")
    .env({"PYTHONPATH": "/LongCat-Video"})
)


def peak_vram_gb() -> float | None:
    """Peak VRAM reserved by THIS process, or None if it cannot be measured.

    Reported per clip so an OOM can be told apart from a memory-tight run.

    Returns None rather than 0.0 when the number is not trustworthy: the
    upstream script runs under torchrun, which launches the model in a
    CHILD process, so this parent's torch allocator sees none of the real
    usage and max_memory_reserved() legitimately reports ~0. A silent 0.0
    would read as "this GPU has enormous headroom", the opposite of the truth.
    """
    try:
        import torch
    except ImportError:
        return None
    if not torch.cuda.is_available():
        return None
    reserved_gb = torch.cuda.max_memory_reserved() / 1e9
    # Sub-0.1GB means the measurement missed the worker process entirely.
    if reserved_gb < 0.1:
        return None
    return round(reserved_gb, 2)


def run_longcat(
    image_bytes: bytes,
    audio_bytes: bytes,
    resolution: str,
    num_segments: int = 1,
) -> tuple[bytes, dict[str, float | None]]:
    """Generate one avatar clip and return vertical MP4 bytes plus timings.

    ``num_segments`` is upstream's documented Video Continuation knob and the
    ONLY way to change clip length: the script hardcodes num_frames = 93 per
    segment and each extra segment appends (93 - 13) = 80 new frames. See
    ``app.services.longcat.clip_seconds`` for the arithmetic.
    """
    import torch

    torch.cuda.reset_peak_memory_stats()

    with tempfile.TemporaryDirectory(prefix="longcat-") as work:
        work_path = Path(work)
        image_path = work_path / "reference.png"
        audio_path = work_path / "voice.wav"
        image_path.write_bytes(image_bytes)
        audio_path.write_bytes(audio_bytes)

        # The upstream demo takes a JSON manifest rather than loose files, so
        # the paths must be passed through it. Schema read from the upstream
        # script: it reads input_data['prompt'], input_data['cond_image'] and
        # input_data['cond_audio']['person1'] -- NOT 'image'/'audio'.
        manifest = work_path / "input.json"
        manifest.write_text(
            json.dumps(
                {
                    "prompt": "A person speaking directly to camera, natural head motion.",
                    "cond_image": str(image_path),
                    "cond_audio": {"person1": str(audio_path)},
                }
            )
        )

        inference_started = time.monotonic()
        # Verified against the upstream script's _parse_args (read from
        # github.com/meituan-longcat/LongCat-Video, run_demo_avatar_single_audio
        # _to_video.py). Flags that do NOT exist upstream and must not be passed:
        #   --num_frames          num_frames is hardcoded to 93 in the script
        #   --base_checkpoint_dir the base model is resolved from --checkpoint_dir
        #   --audio_cfg           the real name is --audio_guidance_scale
        command = [
            "torchrun",
            # torchrun's OWN flags use hyphens and must precede the script.
            # The upstream README writes --nproc_per_node with an underscore,
            # which this torchrun rejects at argparse (exit 2). --standalone
            # keeps the rendezvous in-process for the single node.
            "--standalone",
            "--nproc-per-node=1",
            "run_demo_avatar_single_audio_to_video.py",
            # Everything below is a SCRIPT flag passed through to its argparse.
            "--context_parallel_size=1",
            f"--checkpoint_dir={AVATAR_WEIGHTS_DIR}",
            f"--output_dir={work_path / 'out'}",
            # ai2v == Audio-Image-to-Video: the reference photo drives identity,
            # which is exactly the persona use case.
            "--stage_1=ai2v",
            # The script reads a manifest, not loose paths. cond_image drives
            # identity; cond_audio.person1 is the narration to lip-sync.
            f"--input_json={manifest}",
            f"--resolution={resolution}",
            # Clip length knob. 1 segment = 93 frames = 3.72s; each extra
            # segment appends 80 new frames (Video Continuation mode).
            f"--num_segments={num_segments}",
            f"--ref_img_index={REF_IMG_INDEX_DEFAULT}",
            f"--mask_frame_range={MASK_FRAME_RANGE_DEFAULT}",
            f"--audio_guidance_scale={AUDIO_GUIDANCE_SCALE_DEFAULT}",
            f"--model_type={MODEL_TYPE}",
        ]
        if USE_DISTILL:
            command.append("--use_distill")
        if USE_INT8:
            command.append("--use_int8")

        # check=False so the upstream stderr survives into the exception: a
        # CalledProcessError string is just the argv, which says nothing about
        # why a wrong flag or a missing weight file failed.
        torchrun = subprocess.run(
            command,
            cwd="/LongCat-Video",
            check=False,
            capture_output=True,
            text=True,
            timeout=10800,
        )
        if torchrun.returncode != 0:
            # torchrun relays the child's Python traceback on STDOUT while its
            # own noise (NCCL warnings, ChildFailedError) goes to STDERR.
            # Reporting stderr alone hides the actual exception.
            combined = (
                f"--- stdout ---\n{torchrun.stdout[-2000:]}"
                f"\n--- stderr ---\n{torchrun.stderr[-2000:]}"
            )
            raise RuntimeError(
                f"torchrun exited {torchrun.returncode}: {combined}"
            )
        inference_s = time.monotonic() - inference_started

        outputs = sorted(
            (work_path / "out").rglob("*.mp4"),
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
