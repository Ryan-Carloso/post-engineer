"""Replicate client and media helpers for persona lip sync."""

import base64
import mimetypes
import os
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Any, Callable

import requests

REPLICATE_API_URL = "https://api.replicate.com/v1"
LIPSYNC_DURATION_SECONDS = 5


class LipSyncError(RuntimeError):
    """Raised when the Replicate lip-sync pipeline cannot complete."""


def replicate_token() -> str:
    token = os.getenv("REPLICATE_API_TOKEN")
    if not token:
        raise LipSyncError("REPLICATE_API_TOKEN is not defined")
    return token


def replicate_model() -> str:
    model = os.getenv("REPLICATE_LIPSYNC_MODEL")
    if not model:
        raise LipSyncError("REPLICATE_LIPSYNC_MODEL is not defined")
    return model


def _model_and_version(model: str) -> tuple[str, str | None]:
    """Split ``owner/name[:version]`` into a model and an optional version."""
    if ":" in model:
        name, version = model.split(":", 1)
        return name, version
    return model, None


def resolve_version(model: str, token: str, request: Callable[..., requests.Response] = requests.request) -> str:
    """Return the model's default/latest version id, resolving 404s on old models."""
    name, version = _model_and_version(model)
    if version:
        return version
    response = request(
        "GET",
        f"{REPLICATE_API_URL}/models/{name}",
        headers=_headers(token),
        timeout=60,
    )
    if response.status_code >= 300:
        raise LipSyncError(f"Replicate model lookup failed: HTTP {response.status_code}")
    data = response.json()
    resolved = data.get("latest_version", {}).get("id")
    if not isinstance(resolved, str):
        raise LipSyncError(f"Replicate model has no resolvable version: {name}")
    return resolved


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _data_uri(file_path: str) -> str:
    mime = mimetypes.guess_type(file_path)[0] or "application/octet-stream"
    encoded = base64.b64encode(Path(file_path).read_bytes()).decode("ascii")
    return f"data:{mime};base64,{encoded}"


def _prediction_output_url(output: Any) -> str:
    if isinstance(output, str):
        return output
    if isinstance(output, list) and output and isinstance(output[0], str):
        return output[0]
    raise LipSyncError("Replicate returned an invalid video output")


def run_prediction(
    image_path: str,
    audio_path: str,
    request: Callable[..., requests.Response] = requests.request,
    poll_seconds: float = 2.0,
    timeout_seconds: float = 300.0,
) -> bytes:
    """Run the configured image+audio model and return the generated video."""
    token = replicate_token()
    model = replicate_model()
    version = resolve_version(model, token, request)
    response = request(
        "POST",
        f"{REPLICATE_API_URL}/predictions",
        headers=_headers(token),
        json={
            "version": version,
            "input": {"source_image": _data_uri(image_path), "driven_audio": _data_uri(audio_path)},
        },
        timeout=60,
    )
    if response.status_code >= 300:
        raise LipSyncError(f"Replicate prediction failed: HTTP {response.status_code}")

    prediction = response.json()
    status_url = prediction.get("urls", {}).get("get")
    if not isinstance(status_url, str):
        raise LipSyncError("Replicate response has no prediction status URL")

    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        status_response = request("GET", status_url, headers=_headers(token), timeout=60)
        if status_response.status_code >= 300:
            raise LipSyncError(f"Replicate polling failed: HTTP {status_response.status_code}")
        status = status_response.json()
        state = status.get("status")
        if state == "succeeded":
            output_url = _prediction_output_url(status.get("output"))
            output_response = request("GET", output_url, timeout=60)
            if output_response.status_code >= 300:
                raise LipSyncError(f"Replicate output download failed: HTTP {output_response.status_code}")
            return output_response.content
        if state in {"failed", "canceled"}:
            raise LipSyncError(f"Replicate prediction {state}: {status.get('error', '')}")
        time.sleep(poll_seconds)
    raise LipSyncError("Replicate lip-sync prediction timed out")


def trim_audio(audio_path: str, output_path: str, duration: int = LIPSYNC_DURATION_SECONDS) -> None:
    """Trim the audio input to the avatar segment duration."""
    result = subprocess.run(
        ["ffmpeg", "-y", "-i", audio_path, "-t", str(duration), "-acodec", "copy", output_path],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        raise LipSyncError(f"Unable to trim lip-sync audio: {result.stderr[-500:]}")


def create_lipsync_video(
    image_path: str,
    audio_path: str,
    output_path: str,
    run: Callable[[str, str], bytes] = run_prediction,
) -> str:
    """Generate and save the five-second talking-avatar segment."""
    with tempfile.TemporaryDirectory(prefix="lipsync-") as temp_dir:
        short_audio = os.path.join(temp_dir, "audio.mp3")
        trim_audio(audio_path, short_audio)
        video_bytes = run(image_path, short_audio)
        Path(output_path).write_bytes(video_bytes)
    return output_path
