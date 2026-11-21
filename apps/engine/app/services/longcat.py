"""Client for the LongCat-Video-Avatar 1.5 Modal HTTP workflow.

LongCat (Meituan, MIT) is an audio-driven avatar model: a reference photo plus
an audio clip produces a speaking video. It is the ONLY lip-sync model in the
persona pipeline — the app has no model switch, so there is exactly one set of
endpoints, one bearer secret, and one cost table to keep correct.

The clip arithmetic lives here rather than in a separate module because the
length a request asks for and the length the pipeline can actually render are
one contract: upstream fixes the per-segment frame budget and exposes
``--num_segments`` as the only length knob, so every caller that computes a
duration needs those literals.

Clip length is driven by ``--num_segments``, NOT by the audio. Rounding the
segment count UP is therefore mandatory: upstream only pads audio that is
shorter than the clip, so a clip shorter than its narration desyncs the lip
sync past the last frame. The surplus is trimmed away when the clip is spliced
into the video (``video.replace_video_intro_with_lipsync`` applies ``-t``).
"""

from __future__ import annotations

import math
import os
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Callable, Final, cast

import requests

from app.config import config
from app.models.schema import LipSyncQuality
from app.services.analytics import scrub_error_text, track_ai_request
from app.services.longcat_cost import ModalJobCost, parse_modal_job_cost


class LongCatError(RuntimeError):
    """Raised when LongCat cannot produce a valid intro video."""

    def __init__(
        self, message: str, response_body: str | None = None
    ) -> None:
        super().__init__(message)
        self.response_body = response_body


Request = Callable[..., requests.Response]

UPSTREAM_NUM_FRAMES: Final[int] = 93
UPSTREAM_NUM_COND_FRAMES: Final[int] = 13
AVATAR_V15_SAVE_FPS: Final[int] = 25

MAX_SEGMENTS: Final[int] = 5

INTRO_PADDING_SECONDS: Final[float] = 0.2

GPU_RATES_USD_S: Final[dict[str, float]] = {
    "H200": 0.001261,
    "H100": 0.001097,
    "A100-80GB": 0.000694,
}

QUALITY_RESOLUTIONS: Final[dict[LipSyncQuality, str]] = {
    LipSyncQuality.ok: "480p",
    LipSyncQuality.very_good: "720p",
}

_LONGCAT_ENV_VARS: Final[dict[str, str]] = {
    "submit_url": "LONGCAT_SUBMIT_URL",
    "status_url": "LONGCAT_STATUS_URL",
    "download_url": "LONGCAT_DOWNLOAD_URL",
}


def clip_seconds(num_segments: int) -> float:
    """Rendered clip length, in seconds, for a given --num_segments value.

    Mirrors upstream's own accounting:
        duration = num_frames/save_fps
            + (num_segments - 1) * (num_frames - num_cond_frames) / save_fps
    """
    if num_segments < 1:
        raise LongCatError(f"num_segments must be at least 1: {num_segments}")
    if num_segments > MAX_SEGMENTS:
        raise LongCatError(
            f"num_segments must be at most {MAX_SEGMENTS}: {num_segments}"
        )
    extra_frames = (num_segments - 1) * (
        UPSTREAM_NUM_FRAMES - UPSTREAM_NUM_COND_FRAMES
    )
    return (UPSTREAM_NUM_FRAMES + extra_frames) / AVATAR_V15_SAVE_FPS


def segments_for_duration(seconds: float) -> int:
    """Smallest segment count whose rendered clip is at least ``seconds``.

    Rounds UP so the clip always covers the audio it is given: upstream pads
    audio that is too short but never truncates audio that is too long, so
    under-rendering would leave the last seconds of narration with no matching
    lip motion.
    """
    if not math.isfinite(seconds) or seconds <= 0:
        raise LongCatError(
            f"duration must be a positive finite number: {seconds}"
        )
    per_extra = UPSTREAM_NUM_FRAMES - UPSTREAM_NUM_COND_FRAMES
    needed_frames = seconds * AVATAR_V15_SAVE_FPS
    extra = math.ceil((needed_frames - UPSTREAM_NUM_FRAMES) / per_extra)
    segments = max(1, 1 + int(extra))
    if segments > MAX_SEGMENTS:
        raise LongCatError(
            f"{seconds:g}s exceeds the {MAX_SEGMENTS}-segment LongCat ceiling "
            f"({clip_seconds(MAX_SEGMENTS):g}s)"
        )
    return segments


def resolution_for_quality(quality: LipSyncQuality) -> str:
    """The resolution preset a LipSyncQuality renders at."""
    resolution = QUALITY_RESOLUTIONS.get(quality)
    if resolution is None:
        raise LongCatError(f"unsupported LongCat quality: {quality}")
    return resolution


def audio_duration_seconds(audio_path: str) -> float:
    """Read the actual duration of the trimmed audio sent to LongCat."""
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
        raise LongCatError("ffprobe returned an invalid audio duration") from error
    if not math.isfinite(duration) or duration <= 0:
        raise LongCatError("audio duration must be positive")
    return duration


def _url(name: str) -> str:
    env_name = _LONGCAT_ENV_VARS[name]
    value = os.environ.get(env_name, "")
    if not value.strip():
        raise LongCatError(f"LongCat {name} is not configured ({env_name})")
    return value


def _bearer_headers() -> dict[str, str]:
    """Authorization header for the Modal HTTP endpoints (required, no fallback)."""
    secret = os.environ.get("LONGCAT_HTTP_SECRET", "")
    if not secret.strip():
        raise LongCatError("LONGCAT_HTTP_SECRET is not configured")
    return {"Authorization": f"Bearer {secret}"}


def _json_object(response: requests.Response) -> dict[str, object]:
    payload = response.json()
    if not isinstance(payload, dict):
        raise LongCatError("LongCat returned a non-object response")
    return cast(dict[str, object], payload)


def _raise_for_status(response: requests.Response, operation: str) -> None:
    if response.status_code >= 300:
        try:
            body = response.text[:500] if response.text else None
        except Exception:
            body = None
        raise LongCatError(
            f"LongCat {operation} failed with HTTP {response.status_code}",
            response_body=body,
        )


def _modal_cost_usd(status: dict[str, object]) -> float | None:
    """Extract the GPU cost (USD) the Modal app reports on a done job.

    Returns None when the payload carries no usable cost; a non-numeric value
    is "unknown", never zero. bool is excluded explicitly because it is an int
    subclass and True would otherwise read as $1.
    """
    cost = status.get("cost_usd")
    if isinstance(cost, bool) or not isinstance(cost, (int, float)):
        return None
    if not math.isfinite(cost):
        return None
    return float(cost)


def trim_audio(
    audio_path: str,
    output_path: str,
    duration_seconds: float = 5,
    padding_seconds: float = 0,
    start_seconds: float = 0,
) -> None:
    """Create an accurately cut, standalone audio segment for LongCat.

    ``start_seconds`` offsets the cut (full lip-sync window trims pass a
    nonzero offset); 0 keeps the historical intro-trim duration behavior. A single ``-t``
    flag sets the output length: ffmpeg silently applies the LAST
    duplicate flag, so passing two is dead code with a misleading value.
    """
    input_args = ["-i", audio_path]
    if start_seconds > 0:
        input_args = ["-ss", str(start_seconds)] + input_args
    result = subprocess.run(
        [
            "ffmpeg",
            "-y",
            *input_args,
            "-t",
            str(duration_seconds + padding_seconds),
            "-af",
            f"apad=pad_dur={padding_seconds}",
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
        raise LongCatError(detail[-500:])


def _generate_intro_tracked(
    image_path: str,
    audio_path: str,
    quality: LipSyncQuality,
    output_path: str,
    request: Request,
    duration_seconds: float | None,
) -> tuple[str, float | None, str, ModalJobCost | None]:
    """Generate an intro and track one ai_request event, with full cost.

    Returns (output_path, cost_usd, job_id, job_cost): job_cost is the
    container snapshot from the done payload, with None fields when the
    backend reported no snapshot (an older deployment). The job id is
    captured even when the job fails after submit, so post-submit
    failures stay correlatable in PostHog.
    """
    resolution_for_quality(quality)  # noqa: B018
    start = time.monotonic()
    job_ids: list[str] = []
    try:
        output_path, job_id, cost_usd, job_cost = _generate_intro_impl(
            image_path,
            audio_path,
            quality,
            output_path,
            request,
            duration_seconds,
            job_ids,
        )
    except Exception as e:
        failure_props: dict[str, object] = {
            "backend": "modal",
            "operation": "generate_intro",
            "job_id": job_ids[0] if job_ids else "",
            "duration_ms": int((time.monotonic() - start) * 1000),
            "success": False,
            "error": scrub_error_text(str(e)),
        }
        body = getattr(e, "response_body", None)
        if body:
            failure_props["response_body"] = scrub_error_text(body)
        track_ai_request(failure_props)
        raise
    success_props: dict[str, object] = {
        "backend": "modal",
        "operation": "generate_intro",
        "job_id": job_id,
        "duration_ms": int((time.monotonic() - start) * 1000),
        "success": True,
        "error": "",
    }
    if cost_usd is not None:
        success_props["cost_usd"] = cost_usd
    track_ai_request(success_props)
    return output_path, cost_usd, job_id, job_cost


def generate_intro(
    image_path: str,
    audio_path: str,
    quality: LipSyncQuality,
    output_path: str,
    request: Request = requests.request,
    duration_seconds: float | None = None,
) -> tuple[str, float | None, str]:
    """Generate and download the persona intro using a fixed quality preset.

    Returns (output_path, cost_usd, job_id): the Modal GPU cost in USD
    reported on the completed job (None when the job reports no cost) and
    the Modal job id. Kept as the 3-tuple callers already unpack; use
    generate_intro_with_container when the container snapshot is needed.
    """
    output_path, cost_usd, job_id, _ = _generate_intro_tracked(
        image_path, audio_path, quality, output_path, request, duration_seconds
    )
    return output_path, cost_usd, job_id


def generate_intro_with_container(
    image_path: str,
    audio_path: str,
    quality: LipSyncQuality,
    output_path: str,
    request: Request = requests.request,
    duration_seconds: float | None = None,
) -> tuple[str, float | None, str, ModalJobCost | None]:
    """Generate an intro and return its full container cost snapshot.

    Same call, tracking, and failure behaviour as generate_intro, plus
    the container snapshot (container_cost_usd, container_id, scaledown,
    jobs served) the engine needs to amortise shared container spend
    across the videos one container served.
    """
    return _generate_intro_tracked(
        image_path, audio_path, quality, output_path, request, duration_seconds
    )


def _generate_intro_impl(
    image_path: str,
    audio_path: str,
    quality: LipSyncQuality,
    output_path: str,
    request: Request = requests.request,
    duration_seconds: float | None = None,
    job_id_holder: list[str] | None = None,
) -> tuple[str, str, float | None, ModalJobCost | None]:
    """Submit/poll/download the intro video.

    Returns (output_path, job_id, cost_usd, job_cost): the Modal GPU cost
    in USD from the completed job's status payload, or None when it
    reports none, plus the full container snapshot (or None when the
    done payload carried none). Appends the submitted job_id to
    job_id_holder as soon as the submit succeeds, so callers can report
    it even when polling/download fails.
    """
    submit_url = _url("submit_url")
    status_url = _url("status_url")
    download_url = _url("download_url")
    headers = _bearer_headers()
    poll_seconds = float(config.longcat.get("poll_interval_seconds", 5))
    timeout_seconds = float(config.longcat.get("timeout_seconds", 1800))

    with tempfile.TemporaryDirectory(prefix="longcat-") as temp_dir:
        short_audio = os.path.join(temp_dir, "intro.mp3")
        trim_audio(
            audio_path,
            short_audio,
            duration_seconds
            if duration_seconds is not None
            else int(config.longcat.get("intro_duration_seconds", 5)),
            padding_seconds=INTRO_PADDING_SECONDS,
        )
        measured_seconds = audio_duration_seconds(short_audio)
        speech_seconds = measured_seconds - INTRO_PADDING_SECONDS
        if speech_seconds <= 0:
            speech_seconds = measured_seconds
        num_segments = segments_for_duration(speech_seconds)
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
                    "num_segments": str(num_segments),
                },
                headers=headers,
                timeout=120,
            )
        _raise_for_status(response, "submit")
        submitted = _json_object(response)
        job_id = submitted.get("job_id")
        if not isinstance(job_id, str) or not job_id:
            raise LongCatError("LongCat submit response has no job_id")
        if job_id_holder is not None:
            job_id_holder.append(job_id)

    deadline = time.monotonic() + timeout_seconds
    cost_usd: float | None = None
    job_cost: ModalJobCost | None = None
    while time.monotonic() < deadline:
        response = request(
            "POST", status_url, data={"job_id": job_id}, headers=headers, timeout=60
        )
        _raise_for_status(response, "status")
        status = _json_object(response)
        state = status.get("status")
        if state == "done":
            cost_usd = _modal_cost_usd(status)
            job_cost = parse_modal_job_cost(status)
            break
        if state == "failed":
            error = status.get("error", "unknown error")
            raise LongCatError(f"LongCat job failed: {error}")
        time.sleep(poll_seconds)
    else:
        raise LongCatError("LongCat job timed out")

    response = request(
        "POST", download_url, data={"job_id": job_id}, headers=headers, timeout=300
    )
    _raise_for_status(response, "download")
    if not response.content:
        raise LongCatError("LongCat returned an empty video")
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    Path(output_path).write_bytes(response.content)
    return output_path, job_id, cost_usd, job_cost
