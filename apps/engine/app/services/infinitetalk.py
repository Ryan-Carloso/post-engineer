"""Client for the private InfiniteTalk Modal HTTP workflow."""

from __future__ import annotations

import os
import math
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Callable, cast

import requests

from app.config import config
from app.models.schema import LipSyncQuality
from app.services.analytics import scrub_secret_values, track_ai_request


class InfiniteTalkError(RuntimeError):
    """Raised when InfiniteTalk cannot produce a valid intro video."""


Request = Callable[..., requests.Response]


def frames_for_duration(duration_seconds: float, fps: int = 25) -> int:
    """Return the validated 4n+1 InfiniteTalk frame count for an audio clip."""
    if not math.isfinite(duration_seconds) or duration_seconds <= 0:
        raise ValueError("audio duration must be a positive finite number")
    if fps <= 0:
        raise ValueError("fps must be positive")
    target_frames = max(5, int(duration_seconds * fps) - 4)
    return ((target_frames - 1) // 4) * 4 + 1


def audio_duration_seconds(audio_path: str) -> float:
    """Read the actual duration of the trimmed audio sent to InfiniteTalk."""
    result = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            audio_path,
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    try:
        duration = float(result.stdout.strip())
    except ValueError as error:
        raise InfiniteTalkError("ffprobe returned an invalid audio duration") from error
    if not math.isfinite(duration) or duration <= 0:
        raise InfiniteTalkError("audio duration must be positive")
    return duration


def _url(name: str) -> str:
    value = config.infinitetalk.get(name, "")
    if not isinstance(value, str) or not value.strip():
        raise InfiniteTalkError(f"InfiniteTalk {name} is not configured")
    return value


def _bearer_headers() -> dict[str, str]:
    """Authorization header for the Modal HTTP endpoints (required, no fallback)."""
    secret = config.infinitetalk.get("http_secret", "") or os.environ.get(
        "INFINITETALK_HTTP_SECRET", ""
    )
    if not isinstance(secret, str) or not secret.strip():
        raise InfiniteTalkError(
            "InfiniteTalk http_secret is not configured (config.toml [infinitetalk])"
        )
    return {"Authorization": f"Bearer {secret}"}


def _json_object(response: requests.Response) -> dict[str, object]:
    payload = response.json()
    if not isinstance(payload, dict):
        raise InfiniteTalkError("InfiniteTalk returned a non-object response")
    return cast(dict[str, object], payload)


def _raise_for_status(response: requests.Response, operation: str) -> None:
    if response.status_code >= 300:
        raise InfiniteTalkError(
            f"InfiniteTalk {operation} failed with HTTP {response.status_code}"
        )


def trim_audio(
    audio_path: str,
    output_path: str,
    duration_seconds: float = 5,
    padding_seconds: float = 0,
) -> None:
    """Create an accurately cut, standalone audio intro for InfiniteTalk."""
    result = subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-i",
            audio_path,
            "-t",
            str(duration_seconds),
            "-af",
            f"apad=pad_dur={padding_seconds}",
            "-t",
            str(duration_seconds + padding_seconds),
            "-vn",
            "-acodec",
            "libmp3lame",
            output_path,
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0 or not os.path.isfile(output_path):
        detail = (result.stderr or result.stdout or "audio trim failed").strip()
        raise InfiniteTalkError(detail[-500:])


def generate_intro(
    image_path: str,
    audio_path: str,
    quality: LipSyncQuality,
    output_path: str,
    request: Request = requests.request,
    duration_seconds: float | None = None,
) -> str:
    """Generate and download the persona intro using a fixed quality preset.

    Tracked as one ai_request event (backend=modal): the Modal job id,
    duration, and sanitized error when it fails.
    """
    start = time.monotonic()
    job_id = ""
    try:
        output_path, job_id = _generate_intro_impl(
            image_path, audio_path, quality, output_path, request, duration_seconds
        )
    except Exception as e:
        track_ai_request(
            {
                "backend": "modal",
                "operation": "generate_intro",
                "job_id": job_id,
                "duration_ms": int((time.monotonic() - start) * 1000),
                "success": False,
                "error": scrub_secret_values(str(e))[:500],
            }
        )
        raise
    track_ai_request(
        {
            "backend": "modal",
            "operation": "generate_intro",
            "job_id": job_id,
            "duration_ms": int((time.monotonic() - start) * 1000),
            "success": True,
            "error": "",
        }
    )
    return output_path


def _generate_intro_impl(
    image_path: str,
    audio_path: str,
    quality: LipSyncQuality,
    output_path: str,
    request: Request = requests.request,
    duration_seconds: float | None = None,
) -> tuple[str, str]:
    """Submit/poll/download the intro video; returns (output_path, job_id)."""
    if quality not in (LipSyncQuality.ok, LipSyncQuality.very_good):
        raise InfiniteTalkError(f"unsupported InfiniteTalk quality: {quality}")
    submit_url = _url("submit_url")
    status_url = _url("status_url")
    download_url = _url("download_url")
    headers = _bearer_headers()
    poll_seconds = float(config.infinitetalk.get("poll_interval_seconds", 5))
    timeout_seconds = float(config.infinitetalk.get("timeout_seconds", 1800))

    with tempfile.TemporaryDirectory(prefix="infinitetalk-") as temp_dir:
        short_audio = os.path.join(temp_dir, "intro.mp3")
        trim_audio(
            audio_path,
            short_audio,
            duration_seconds
            if duration_seconds is not None
            else int(config.infinitetalk.get("intro_duration_seconds", 5)),
            padding_seconds=0.2,
        )
        frames = frames_for_duration(audio_duration_seconds(short_audio))
        with open(image_path, "rb") as image_file, open(short_audio, "rb") as audio_file:
            response = request(
                "POST",
                submit_url,
                files={
                    "image": (Path(image_path).name, image_file, "image/png"),
                    "audio": ("intro.mp3", audio_file, "audio/mpeg"),
                },
                data={
                    "quality": quality.value,
                    "frames": str(frames),
                },
                headers=headers,
                timeout=120,
            )
        _raise_for_status(response, "submit")
        submitted = _json_object(response)
        job_id = submitted.get("job_id")
        if not isinstance(job_id, str) or not job_id:
            raise InfiniteTalkError("InfiniteTalk submit response has no job_id")

    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        response = request(
            "POST", status_url, data={"job_id": job_id}, headers=headers, timeout=60
        )
        _raise_for_status(response, "status")
        status = _json_object(response)
        state = status.get("status")
        if state == "done":
            break
        if state == "failed":
            error = status.get("error", "unknown error")
            raise InfiniteTalkError(f"InfiniteTalk job failed: {error}")
        time.sleep(poll_seconds)
    else:
        raise InfiniteTalkError("InfiniteTalk job timed out")

    response = request(
        "POST", download_url, data={"job_id": job_id}, headers=headers, timeout=300
    )
    _raise_for_status(response, "download")
    if not response.content:
        raise InfiniteTalkError("InfiniteTalk returned an empty video")
    Path(output_path).write_bytes(response.content)
    return output_path, job_id
