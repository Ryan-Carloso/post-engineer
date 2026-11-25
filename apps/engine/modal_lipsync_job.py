"""Shared job helpers for the candidate cheap lip-sync tiers.

Two mouth-only renderers are measured side by side for react videos, where
the persona is a small window in a corner of the screen:

* ``very_cheap``: MuseTalk 1.5 (Tencent Music, MIT code, OpenRAIL-M weights),
  one UNet step per frame at 256x256, on an L4 (``modal_musetalk.py``);
* ``cheap``: TBDub Student (Taobao Live, Apache-2.0 code and weights), a
  two-step DiT at 512x512, on an L40S (``modal_tbdub.py``).

Both repaint the mouth of an existing face *video*: a single photo would give
a frozen head with a moving mouth. ``base_clip_args`` turns the persona photo
into a short clip with a slow breathing zoom; both models loop it
forward-then-backward to cover the narration.

``render_clip`` is the flow both Modal apps run: decode the audio, build the
base clip, run the model, return the MP4 and what it cost. The model call and
the process runner are injected, so the flow is tested without a GPU.

Standard library only: the engine tests import it without Modal or torch.
"""

from __future__ import annotations

import subprocess
import tempfile
import time
from pathlib import Path
from typing import Callable, Final

MODEL_FPS: Final = 25
AUDIO_SAMPLE_RATE: Final = 16000
BASE_CLIP_SECONDS: Final = 4
BASE_CLIP_SIZE: Final = 512
ZOOM_AMPLITUDE: Final = 0.04

MUSETALK_GPU: Final = "L4"
MUSETALK_BATCH_SIZE: Final = 16
MUSETALK_OUTPUT_NAME: Final = "result.mp4"

TBDUB_GPU: Final = "L40S"
TBDUB_SAMPLE_NAME: Final = "clip"

GPU_RATES_USD_S: Final[dict[str, float]] = {
    "T4": 0.000164,
    "L4": 0.000222,
    "A10G": 0.000306,
    "L40S": 0.000542,
}

TIER_GPUS: Final[dict[str, str]] = {
    "very_cheap": MUSETALK_GPU,
    "cheap": TBDUB_GPU,
}

TARGET_USD_PER_VIDEO: Final = 0.50
REFERENCE_VIDEO_SECONDS: Final = 60.0

Runner = Callable[..., subprocess.CompletedProcess[str]]
ModelCall = Callable[[str, str, str, Runner], Path]


def base_clip_args(image_path: str, output_path: str) -> list[str]:
    """ffmpeg args: persona photo to a 25 fps square clip with a slow zoom.

    The zoom goes in and back out once per clip (a cosine starting and ending
    at 1), so the clip loops without a jump.
    """
    frames = BASE_CLIP_SECONDS * MODEL_FPS
    zoom = f"1+{ZOOM_AMPLITUDE / 2}*(1-cos(2*PI*on/{frames}))"
    size = BASE_CLIP_SIZE
    return [
        "ffmpeg", "-y", "-loop", "1", "-i", image_path,
        "-vf",
        f"scale={size * 2}:{size * 2}:force_original_aspect_ratio=increase,"
        f"crop={size * 2}:{size * 2},"
        f"zoompan=z='{zoom}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'"
        f":d=1:s={size}x{size}:fps={MODEL_FPS}",
        "-frames:v", str(frames),
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "16",
        output_path,
    ]


def audio_decode_args(source_path: str, output_path: str) -> list[str]:
    """ffmpeg args: any narration to the 16 kHz mono WAV both models read."""
    return [
        "ffmpeg", "-y", "-i", source_path,
        "-ac", "1", "-ar", str(AUDIO_SAMPLE_RATE), output_path,
    ]


def musetalk_config_yaml(video_path: str, audio_path: str) -> str:
    """The one-task YAML MuseTalk's ``scripts.inference`` reads."""
    return (
        "task_0:\n"
        f'  video_path: "{video_path}"\n'
        f'  audio_path: "{audio_path}"\n'
        f'  result_name: "{MUSETALK_OUTPUT_NAME}"\n'
    )


def musetalk_args(config_path: str, result_dir: str) -> list[str]:
    """Upstream's documented MuseTalk 1.5 call, fp16, run from the checkout."""
    return [
        "python", "-m", "scripts.inference",
        "--inference_config", config_path,
        "--result_dir", result_dir,
        "--unet_model_path", "models/musetalkV15/unet.pth",
        "--unet_config", "models/musetalkV15/musetalk.json",
        "--whisper_dir", "models/whisper",
        "--version", "v15",
        "--fps", str(MODEL_FPS),
        "--batch_size", str(MUSETALK_BATCH_SIZE),
        "--use_float16",
    ]


def musetalk_output_path(result_dir: str) -> str:
    """Where MuseTalk writes the v15 result for our config."""
    return f"{result_dir}/v15/{MUSETALK_OUTPUT_NAME}"


def tbdub_args(
    video_path: str, audio_path: str, checkpoint_dir: str, output_dir: str
) -> list[str]:
    """Upstream's documented TBDub Student call (two steps, latent motion)."""
    return [
        "python", "inference.py",
        "--video", video_path,
        "--audio", audio_path,
        "--checkpoint-dir", checkpoint_dir,
        "--inference-mode", "student",
        "--num-student-steps", "2",
        "--sigma-shift", "1.0",
        "--motion-from-latents",
        "--seed", "42",
        "--sample-name", TBDUB_SAMPLE_NAME,
        "--output-dir", output_dir,
    ]


def tbdub_output_path(output_dir: str) -> str:
    """Where TBDub writes the pasted-back result for our sample name."""
    return f"{output_dir}/{TBDUB_SAMPLE_NAME}_tbdub.mp4"


def usd_for_seconds(gpu_seconds: float, gpu: str) -> float:
    """Modal GPU price of ``gpu_seconds`` on ``gpu``."""
    if gpu not in GPU_RATES_USD_S:
        raise ValueError(f"no Modal rate for GPU {gpu!r}")
    if gpu_seconds < 0:
        raise ValueError(f"gpu_seconds must not be negative: {gpu_seconds}")
    return gpu_seconds * GPU_RATES_USD_S[gpu]


def usd_per_reference_video(gpu_seconds: float, audio_seconds: float, gpu: str) -> float:
    """Scale one measured render to a 60s video at the same speed."""
    if audio_seconds <= 0:
        raise ValueError(f"audio_seconds must be positive: {audio_seconds}")
    return usd_for_seconds(gpu_seconds, gpu) * REFERENCE_VIDEO_SECONDS / audio_seconds


def run_checked(
    args: list[str], cwd: str | None = None, timeout: int = 3600
) -> subprocess.CompletedProcess[str]:
    """Run a process; raise with the tail of its output when it fails."""
    result = subprocess.run(args, cwd=cwd, capture_output=True, text=True, timeout=timeout)
    if result.returncode != 0:
        raise RuntimeError(f"{args[0]} failed: {(result.stderr or result.stdout)[-2000:]}")
    return result


def audio_seconds(audio_path: str, run: Runner = run_checked) -> float:
    """Duration of ``audio_path`` in seconds, via ffprobe."""
    probe = run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "csv=p=0", audio_path]
    )
    return float(probe.stdout.strip())


def render_clip(
    tier: str,
    image_bytes: bytes,
    audio_bytes: bytes,
    model: ModelCall,
    run: Runner = run_checked,
) -> dict[str, object]:
    """Photo + narration to a lip-synced MP4, with timings and cost.

    ``model(work_dir, base_clip, audio_wav, run)`` runs one renderer and
    returns the path of the MP4 it wrote; a missing file raises, because both
    upstream scripts can end without an output.
    """
    gpu = TIER_GPUS[tier]
    started = time.monotonic()
    with tempfile.TemporaryDirectory(prefix=f"{tier}-") as work:
        image_path = f"{work}/persona.png"
        source_audio = f"{work}/voice.in"
        audio_path = f"{work}/voice.wav"
        Path(image_path).write_bytes(image_bytes)
        Path(source_audio).write_bytes(audio_bytes)
        run(audio_decode_args(source_audio, audio_path))
        seconds = audio_seconds(audio_path, run)

        base_started = time.monotonic()
        base_clip = f"{work}/base.mp4"
        run(base_clip_args(image_path, base_clip))
        base_clip_s = time.monotonic() - base_started

        model_started = time.monotonic()
        result = model(work, base_clip, audio_path, run)
        model_s = time.monotonic() - model_started
        if not result.is_file():
            raise RuntimeError(f"{tier} renderer produced no video at {result.name}")
        video = result.read_bytes()
    total_s = time.monotonic() - started
    return {
        "video": video,
        "tier": tier,
        "gpu": gpu,
        "audio_seconds": round(seconds, 3),
        "base_clip_s": round(base_clip_s, 3),
        "model_s": round(model_s, 3),
        "total_s": round(total_s, 3),
        "cost_usd": round(usd_for_seconds(total_s, gpu), 4),
        "usd_per_60s_video": round(usd_per_reference_video(total_s, seconds, gpu), 4),
        "target_usd_per_video": TARGET_USD_PER_VIDEO,
    }


def save_bench_run(result: dict[str, object], out_dir: Path, index: int) -> dict[str, object]:
    """Write a bench run's MP4 next to the others; return the rest of the result."""
    summary = {key: value for key, value in result.items() if key != "video"}
    video = result.get("video")
    if not isinstance(video, bytes) or not video:
        raise RuntimeError(f"bench run {index} returned no video")
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / f"{summary.get('tier')}-{index}.mp4").write_bytes(video)
    return summary
