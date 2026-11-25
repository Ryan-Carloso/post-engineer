"""Modal runner for MuseTalk 1.5: the candidate ``cheap`` lip-sync tier.

The ``cheap`` tier is for react videos, where the persona is a small window in
a corner of the screen. LongCat (the ``ok`` / ``very_good`` renderer) costs
about $0.58 of H100 per 12s window, because it generates whole frames with a
13.6B video model. MuseTalk only repaints the mouth of an existing face clip,
at 256x256, in one UNet step per frame, on an L4. The target is under $0.50
for a 60s video (``modal_musetalk_job.TARGET_USD_PER_VIDEO``).

This app is a measurement step, not wired into the engine yet: the
``bench`` entry point renders one clip from a photo and an audio file, saves
the MP4 to watch, and prints the GPU seconds and the price of a 60s video at
that speed. The HTTP endpoints and the ``cheap`` quality come after the
numbers are known.

One-time setup (DEV Modal account; it spends GPU time):

    uv run modal secret create huggingface HF_TOKEN=hf_...
    uv run modal run modal_musetalk.py::download_weights

Measure:

    uv run modal run modal_musetalk.py::bench --image face.png --audio voice.mp3 --out /tmp/musetalk

License: MuseTalk code is MIT. The Hugging Face card lists the weights as
CreativeML OpenRAIL-M, which allows commercial use with use restrictions.
Whisper-tiny (MIT), sd-vae-ft-mse (MIT), DWPose (Apache-2.0) and the
face-parsing BiSeNet weights come with it.
"""

from __future__ import annotations

import os
import subprocess
import tempfile
import time
from pathlib import Path

import modal

from modal_musetalk_job import (
    GPU,
    base_clip_args,
    inference_args,
    inference_config_yaml,
    output_path,
    usd_for_seconds,
    usd_per_reference_video,
)

MUSETALK_REPO_URL = "https://github.com/TMElyralab/MuseTalk.git"
MUSETALK_REPO_COMMIT = "2536eaf06b85f775d8e04b7fd81bf6699155a58d"
CHECKOUT_DIR = "/MuseTalk"
WEIGHTS_DIR = "/weights"
FACE_PARSE_DRIVE_ID = "154JgKpzCPW82qINcVieuPH3fZ2e0P812"
RESNET18_URL = "https://download.pytorch.org/models/resnet18-5c106cde.pth"

WEIGHTS_VOLUME = modal.Volume.from_name("musetalk-models", create_if_missing=True)

_HERE = Path(__file__).resolve().parent

MUSETALK_IMAGE = (
    modal.Image.debian_slim(python_version="3.10")
    .apt_install("git", "ffmpeg", "libgl1", "libglib2.0-0")
    .pip_install(
        "torch==2.0.1",
        "torchvision==0.15.2",
        "torchaudio==2.0.2",
        index_url="https://download.pytorch.org/whl/cu118",
    )
    .run_commands(
        f"git init -q {CHECKOUT_DIR} && cd {CHECKOUT_DIR}"
        f" && git fetch -q --depth 1 {MUSETALK_REPO_URL} {MUSETALK_REPO_COMMIT}"
        " && git checkout -q FETCH_HEAD"
    )
    .run_commands(
        f"grep -vE '^(tensorflow|tensorboard|gradio)' {CHECKOUT_DIR}/requirements.txt"
        " > /tmp/musetalk-requirements.txt"
        " && pip install -r /tmp/musetalk-requirements.txt"
    )
    .pip_install("openmim", "gdown", "huggingface_hub[cli]")
    .pip_install(
        "mmcv==2.0.1",
        find_links="https://download.openmmlab.com/mmcv/dist/cu118/torch2.0/index.html",
    )
    .pip_install("mmengine", "mmdet==3.1.0", "mmpose==1.1.0")
    .run_commands(f"ln -s {WEIGHTS_DIR} {CHECKOUT_DIR}/models")
    .add_local_file(_HERE / "modal_musetalk_job.py", "/root/modal_musetalk_job.py", copy=True)
)

app = modal.App("moneyprint-musetalk")


@app.function(
    image=MUSETALK_IMAGE,
    volumes={WEIGHTS_DIR: WEIGHTS_VOLUME},
    secrets=[modal.Secret.from_name("huggingface")],
    timeout=3600,
)
def download_weights() -> str:
    """Fetch upstream's download_weights.sh set into the volume (MuseTalk 1.5 only)."""
    from huggingface_hub import hf_hub_download

    token = os.environ["HF_TOKEN"]
    files = [
        ("TMElyralab/MuseTalk", "musetalkV15/musetalk.json", WEIGHTS_DIR),
        ("TMElyralab/MuseTalk", "musetalkV15/unet.pth", WEIGHTS_DIR),
        ("stabilityai/sd-vae-ft-mse", "config.json", f"{WEIGHTS_DIR}/sd-vae"),
        ("stabilityai/sd-vae-ft-mse", "diffusion_pytorch_model.bin", f"{WEIGHTS_DIR}/sd-vae"),
        ("openai/whisper-tiny", "config.json", f"{WEIGHTS_DIR}/whisper"),
        ("openai/whisper-tiny", "pytorch_model.bin", f"{WEIGHTS_DIR}/whisper"),
        ("openai/whisper-tiny", "preprocessor_config.json", f"{WEIGHTS_DIR}/whisper"),
        ("yzd-v/DWPose", "dw-ll_ucoco_384.pth", f"{WEIGHTS_DIR}/dwpose"),
    ]
    for repo_id, filename, local_dir in files:
        print(f"downloading {repo_id}/{filename}", flush=True)
        hf_hub_download(repo_id=repo_id, filename=filename, local_dir=local_dir, token=token)
    face_parse = Path(WEIGHTS_DIR) / "face-parse-bisent"
    face_parse.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["gdown", "--id", FACE_PARSE_DRIVE_ID, "-O", str(face_parse / "79999_iter.pth")],
        check=True,
    )
    subprocess.run(
        ["curl", "-fsSL", RESNET18_URL, "-o", str(face_parse / "resnet18-5c106cde.pth")],
        check=True,
    )
    WEIGHTS_VOLUME.commit()
    total = sum(1 for item in Path(WEIGHTS_DIR).rglob("*") if item.is_file())
    return f"MuseTalk weights ready: {total} files"


def _run(args: list[str], cwd: str | None = None, timeout: int = 1800) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(args, cwd=cwd, capture_output=True, text=True, timeout=timeout)
    if result.returncode != 0:
        raise RuntimeError(f"{args[0]} failed: {(result.stderr or result.stdout)[-2000:]}")
    return result


def _audio_seconds(audio_path: str) -> float:
    probe = _run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", audio_path]
    )
    return float(probe.stdout.strip())


@app.function(
    image=MUSETALK_IMAGE,
    gpu=GPU,
    volumes={WEIGHTS_DIR: WEIGHTS_VOLUME},
    timeout=3600,
)
def render(image_bytes: bytes, audio_bytes: bytes) -> dict[str, object]:
    """Photo + narration to a lip-synced clip, with the GPU seconds it took."""
    started = time.monotonic()
    with tempfile.TemporaryDirectory(prefix="musetalk-") as work:
        image_path = f"{work}/persona.png"
        audio_path = f"{work}/voice.wav"
        Path(image_path).write_bytes(image_bytes)
        Path(f"{work}/voice.in").write_bytes(audio_bytes)
        _run(["ffmpeg", "-y", "-i", f"{work}/voice.in", "-ac", "1", "-ar", "16000", audio_path])
        audio_seconds = _audio_seconds(audio_path)

        base_started = time.monotonic()
        base_clip = f"{work}/base.mp4"
        _run(base_clip_args(image_path, base_clip))
        base_clip_s = time.monotonic() - base_started

        config_path = f"{work}/task.yaml"
        Path(config_path).write_text(inference_config_yaml(base_clip, audio_path))
        result_dir = f"{work}/results"
        inference_started = time.monotonic()
        inference = _run(inference_args(config_path, result_dir), cwd=CHECKOUT_DIR)
        inference_s = time.monotonic() - inference_started
        result = Path(output_path(result_dir))
        if not result.is_file():
            raise RuntimeError(
                "MuseTalk produced no video: " + (inference.stdout + inference.stderr)[-2000:]
            )
        video = result.read_bytes()
    total_s = time.monotonic() - started
    return {
        "video": video,
        "gpu": GPU,
        "audio_seconds": round(audio_seconds, 3),
        "base_clip_s": round(base_clip_s, 3),
        "inference_s": round(inference_s, 3),
        "total_s": round(total_s, 3),
        "cost_usd": round(usd_for_seconds(total_s), 4),
        "usd_per_60s_video": round(usd_per_reference_video(total_s, audio_seconds), 4),
    }


@app.local_entrypoint()
def bench(image: str, audio: str, out: str = "musetalk-bench", repeats: int = 2) -> None:
    """Render the clip ``repeats`` times (later runs usually reuse the warm container)."""
    out_dir = Path(out)
    out_dir.mkdir(parents=True, exist_ok=True)
    image_bytes = Path(image).read_bytes()
    audio_bytes = Path(audio).read_bytes()
    for index in range(1, repeats + 1):
        result = render.remote(image_bytes, audio_bytes)
        video = result.pop("video")
        if isinstance(video, bytes):
            (out_dir / f"musetalk-{index}.mp4").write_bytes(video)
        print(f"run {index}/{repeats}: {result}", flush=True)
