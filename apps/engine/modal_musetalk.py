"""Modal runner for MuseTalk 1.5: the candidate ``very_cheap`` lip-sync tier.

The cheapest of the two mouth-only renderers measured for react videos (see
``modal_lipsync_job.py``): MuseTalk repaints only the mouth of the persona's
base clip at 256x256, in one UNet step per frame, on an L4. Not wired into
the engine yet: the ``bench`` entry point renders one clip, saves it, and
prints the GPU seconds and the price of a 60s video at that speed, against
the $0.50 target.

One-time setup (DEV Modal account; it spends GPU time):

    uv run modal secret create huggingface HF_TOKEN=hf_...
    uv run modal run modal_musetalk.py::download_weights

Measure:

    uv run modal run modal_musetalk.py::bench --image face.png --audio voice.mp3 --out /tmp/lipsync

License: MuseTalk code is MIT. The Hugging Face card lists the weights as
CreativeML OpenRAIL-M, which allows commercial use with use restrictions.
Whisper-tiny (MIT), sd-vae-ft-mse (MIT), DWPose (Apache-2.0) and the
face-parsing BiSeNet weights come with it.
"""

from __future__ import annotations

import os
import subprocess
from pathlib import Path

import modal

from modal_lipsync_job import (
    MUSETALK_GPU,
    Runner,
    musetalk_args,
    musetalk_config_yaml,
    musetalk_output_path,
    render_clip,
    save_bench_run,
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
    .apt_install("git", "ffmpeg", "libgl1", "libglib2.0-0", "curl")
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
    .add_local_file(_HERE / "modal_lipsync_job.py", "/root/modal_lipsync_job.py", copy=True)
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


def _musetalk(work: str, base_clip: str, audio_path: str, run: Runner) -> Path:
    config_path = f"{work}/task.yaml"
    Path(config_path).write_text(musetalk_config_yaml(base_clip, audio_path))
    result_dir = f"{work}/results"
    run(musetalk_args(config_path, result_dir), cwd=CHECKOUT_DIR)
    return Path(musetalk_output_path(result_dir))


@app.function(
    image=MUSETALK_IMAGE,
    gpu=MUSETALK_GPU,
    volumes={WEIGHTS_DIR: WEIGHTS_VOLUME},
    timeout=3600,
)
def render(image_bytes: bytes, audio_bytes: bytes) -> dict[str, object]:
    """Photo + narration to a lip-synced clip, with the GPU seconds it took."""
    return render_clip("very_cheap", image_bytes, audio_bytes, _musetalk)


@app.local_entrypoint()
def bench(image: str, audio: str, out: str = "lipsync-bench", repeats: int = 2) -> None:
    """Render the clip ``repeats`` times (later runs usually reuse the warm container)."""
    image_bytes = Path(image).read_bytes()
    audio_bytes = Path(audio).read_bytes()
    for index in range(1, repeats + 1):
        summary = save_bench_run(render.remote(image_bytes, audio_bytes), Path(out), index)
        print(f"run {index}/{repeats}: {summary}", flush=True)
