"""Modal runner for TBDub Student: the candidate ``cheap`` lip-sync tier.

The better-looking of the two mouth-only renderers measured for react videos
(see ``modal_lipsync_job.py``): TBDub (Taobao Live, Apache-2.0 code and
weights) is a visual-dubbing DiT that repaints the mouth region of the
persona's base clip at 512x512. The Student variant samples in two steps.
Upstream reports 7.13 FPS on one H20, and about 28 GiB of GPU memory with the
models resident, so it runs on an L40S (48 GB). Not wired into the engine
yet: the ``bench`` entry point renders one clip, saves it, and prints the GPU
seconds and the price of a 60s video at that speed, against the $0.50 target.

One-time setup (DEV Modal account; it spends GPU time):

    uv run modal secret create huggingface HF_TOKEN=hf_...
    uv run modal run modal_tbdub.py::download_weights

Measure:

    uv run modal run modal_tbdub.py::bench --image face.png --audio voice.mp3 --out /tmp/lipsync

Weights: the Student DiT (about 12.6 GB), the Wan2.2 VAE from KlingTeam/X-Dub,
HuBERT large (facebook/hubert-large-ll60k) and MediaPipe's Face Landmarker,
which is checked against upstream's published SHA-256.
"""

from __future__ import annotations

import hashlib
import os
import urllib.request
from pathlib import Path

import modal

from modal_lipsync_job import (
    TBDUB_GPU,
    Runner,
    render_clip,
    save_bench_run,
    tbdub_args,
    tbdub_output_path,
)

TBDUB_REPO_URL = "https://github.com/TaoLiveAIGC/TBDub.git"
TBDUB_REPO_COMMIT = "19e18e4ba8e2a19e6716cb38110ee2de1dae9bb3"
CHECKOUT_DIR = "/TBDub"
WEIGHTS_DIR = "/weights"
FACE_LANDMARKER_URL = (
    "https://storage.googleapis.com/mediapipe-models/face_landmarker/"
    "face_landmarker/float16/1/face_landmarker.task"
)
FACE_LANDMARKER_SHA256 = "64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff"

WEIGHTS_VOLUME = modal.Volume.from_name("tbdub-models", create_if_missing=True)

_HERE = Path(__file__).resolve().parent

TBDUB_IMAGE = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("git", "ffmpeg", "libgl1", "libglib2.0-0")
    .pip_install(
        "torch==2.9.0",
        "torchvision==0.24.0",
        index_url="https://download.pytorch.org/whl/cu128",
    )
    .run_commands(
        f"git init -q {CHECKOUT_DIR} && cd {CHECKOUT_DIR}"
        f" && git fetch -q --depth 1 {TBDUB_REPO_URL} {TBDUB_REPO_COMMIT}"
        " && git checkout -q FETCH_HEAD"
    )
    .run_commands(f"pip install -r {CHECKOUT_DIR}/requirements.txt")
    .add_local_file(_HERE / "modal_lipsync_job.py", "/root/modal_lipsync_job.py", copy=True)
)

app = modal.App("moneyprint-tbdub")


@app.function(
    image=TBDUB_IMAGE,
    volumes={WEIGHTS_DIR: WEIGHTS_VOLUME},
    secrets=[modal.Secret.from_name("huggingface")],
    timeout=3600,
)
def download_weights() -> str:
    """Fetch the Student checkpoint set from upstream's README into the volume."""
    from huggingface_hub import hf_hub_download

    token = os.environ["HF_TOKEN"]
    files = [
        ("TaoLiveAIGC/TBDub", "config.json", WEIGHTS_DIR),
        ("TaoLiveAIGC/TBDub", "null_prompt_emb.pt", WEIGHTS_DIR),
        ("TaoLiveAIGC/TBDub", "tbdub_student.safetensors", WEIGHTS_DIR),
        ("KlingTeam/X-Dub", "Wan2.2_VAE.safetensors", WEIGHTS_DIR),
        ("facebook/hubert-large-ll60k", "config.json", f"{WEIGHTS_DIR}/hubert-large-ll60k"),
        ("facebook/hubert-large-ll60k", "preprocessor_config.json", f"{WEIGHTS_DIR}/hubert-large-ll60k"),
        ("facebook/hubert-large-ll60k", "pytorch_model.bin", f"{WEIGHTS_DIR}/hubert-large-ll60k"),
    ]
    for repo_id, filename, local_dir in files:
        print(f"downloading {repo_id}/{filename}", flush=True)
        hf_hub_download(repo_id=repo_id, filename=filename, local_dir=local_dir, token=token)
    landmarker = Path(WEIGHTS_DIR) / "face_landmarker.task"
    with urllib.request.urlopen(FACE_LANDMARKER_URL, timeout=120) as response:
        payload = response.read()
    digest = hashlib.sha256(payload).hexdigest()
    if digest != FACE_LANDMARKER_SHA256:
        raise RuntimeError(f"face_landmarker.task SHA-256 mismatch: {digest}")
    landmarker.write_bytes(payload)
    WEIGHTS_VOLUME.commit()
    total = sum(1 for item in Path(WEIGHTS_DIR).rglob("*") if item.is_file())
    return f"TBDub weights ready: {total} files"


def _tbdub(work: str, base_clip: str, audio_path: str, run: Runner) -> Path:
    output_dir = f"{work}/results"
    run(tbdub_args(base_clip, audio_path, WEIGHTS_DIR, output_dir), cwd=CHECKOUT_DIR)
    return Path(tbdub_output_path(output_dir))


@app.function(
    image=TBDUB_IMAGE,
    gpu=TBDUB_GPU,
    volumes={WEIGHTS_DIR: WEIGHTS_VOLUME},
    timeout=3600,
)
def render(image_bytes: bytes, audio_bytes: bytes) -> dict[str, object]:
    """Photo + narration to a lip-synced clip, with the GPU seconds it took."""
    return render_clip("cheap", image_bytes, audio_bytes, _tbdub)


@app.local_entrypoint()
def bench(image: str, audio: str, out: str = "lipsync-bench", repeats: int = 2) -> None:
    """Render the clip ``repeats`` times (later runs usually reuse the warm container)."""
    image_bytes = Path(image).read_bytes()
    audio_bytes = Path(audio).read_bytes()
    for index in range(1, repeats + 1):
        summary = save_bench_run(render.remote(image_bytes, audio_bytes), Path(out), index)
        print(f"run {index}/{repeats}: {summary}", flush=True)
