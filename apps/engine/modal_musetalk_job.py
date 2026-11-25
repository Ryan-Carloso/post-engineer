"""Pure job helpers for the MuseTalk ``cheap`` lip-sync renderer.

MuseTalk 1.5 (Tencent Music, MIT code) repaints only the mouth region of an
existing face video, one UNet step per frame at 256x256, which is why it runs
near real time on a small GPU. It needs a face *video* to repaint: a single
photo would give a frozen head with a moving mouth. ``base_clip_args`` turns
the persona photo into a short clip with a slow breathing zoom, so the head
in the corner of a react video is not a still picture.

Everything here is standard library, so the engine tests import it without
Modal, torch or the MuseTalk checkout.
"""

from __future__ import annotations

from typing import Final

MUSETALK_FPS: Final = 25
BASE_CLIP_SECONDS: Final = 4
BASE_CLIP_SIZE: Final = 512
ZOOM_AMPLITUDE: Final = 0.04
BATCH_SIZE: Final = 16

GPU: Final = "L4"
GPU_RATES_USD_S: Final[dict[str, float]] = {
    "T4": 0.000164,
    "L4": 0.000222,
    "A10G": 0.000306,
}

TARGET_USD_PER_VIDEO: Final = 0.50
REFERENCE_VIDEO_SECONDS: Final = 60.0

OUTPUT_NAME: Final = "result.mp4"


def base_clip_args(image_path: str, output_path: str) -> list[str]:
    """ffmpeg args: persona photo to a 25 fps square clip with a slow zoom.

    The zoom goes in and back out once per clip (a cosine), so the clip loops
    without a jump; MuseTalk also plays the frames forward then backward.
    """
    frames = BASE_CLIP_SECONDS * MUSETALK_FPS
    zoom = f"1+{ZOOM_AMPLITUDE / 2}*(1-cos(2*PI*on/{frames}))"
    size = BASE_CLIP_SIZE
    return [
        "ffmpeg", "-y", "-loop", "1", "-i", image_path,
        "-vf",
        f"scale={size * 2}:{size * 2}:force_original_aspect_ratio=increase,"
        f"crop={size * 2}:{size * 2},"
        f"zoompan=z='{zoom}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'"
        f":d=1:s={size}x{size}:fps={MUSETALK_FPS}",
        "-frames:v", str(frames),
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "16",
        output_path,
    ]


def inference_config_yaml(video_path: str, audio_path: str) -> str:
    """The one-task YAML ``scripts.inference`` reads as --inference_config."""
    return (
        "task_0:\n"
        f'  video_path: "{video_path}"\n'
        f'  audio_path: "{audio_path}"\n'
        f'  result_name: "{OUTPUT_NAME}"\n'
    )


def inference_args(config_path: str, result_dir: str) -> list[str]:
    """Upstream's documented MuseTalk 1.5 call, fp16, run from the checkout."""
    return [
        "python", "-m", "scripts.inference",
        "--inference_config", config_path,
        "--result_dir", result_dir,
        "--unet_model_path", "models/musetalkV15/unet.pth",
        "--unet_config", "models/musetalkV15/musetalk.json",
        "--whisper_dir", "models/whisper",
        "--version", "v15",
        "--fps", str(MUSETALK_FPS),
        "--batch_size", str(BATCH_SIZE),
        "--use_float16",
    ]


def output_path(result_dir: str) -> str:
    """Where ``scripts.inference`` writes the v15 result for our config."""
    return f"{result_dir}/v15/{OUTPUT_NAME}"


def usd_for_seconds(gpu_seconds: float, gpu: str = GPU) -> float:
    """Modal GPU price of ``gpu_seconds`` on ``gpu``."""
    if gpu not in GPU_RATES_USD_S:
        raise ValueError(f"no Modal rate for GPU {gpu!r}")
    if gpu_seconds < 0:
        raise ValueError(f"gpu_seconds must not be negative: {gpu_seconds}")
    return gpu_seconds * GPU_RATES_USD_S[gpu]


def usd_per_reference_video(
    gpu_seconds: float, audio_seconds: float, gpu: str = GPU
) -> float:
    """Scale one measured render to a 60s video at the same speed."""
    if audio_seconds <= 0:
        raise ValueError(f"audio_seconds must be positive: {audio_seconds}")
    return usd_for_seconds(gpu_seconds, gpu) * REFERENCE_VIDEO_SECONDS / audio_seconds
