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
import re
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Callable, Final, cast

import requests

from app.config import config
from app.models.schema import LipSyncQuality
from app.services.analytics import scrub_error_text, track_ai_request


class LongCatError(RuntimeError):
    """Raised when LongCat cannot produce a valid intro video."""


class LongCatUnavailableError(LongCatError):
    """The Modal gateway answered 'workspace disabled' (billing exhausted).

    Distinguishable the moment the render starts — an HTTP 404 whose body is
    the gateway's `modal-http: workspace … is disabled` verdict (production:
    slot 0d88790d, 2026-10-19, run 39320019610) — instead of a generic
    pipeline failure. The task pipeline treats it as a FALLBACK trigger
    (faceless video) rather than a task failure.
    """


Request = Callable[..., requests.Response]

# --------------------------------------------------------------------------
# Upstream clip arithmetic
# --------------------------------------------------------------------------
# run_demo_avatar_single_audio_to_video.py hardcodes the per-segment frame
# budget and never exposes it on the CLI:
#   num_frames      = 93   (frames in the FIRST segment)
#   num_cond_frames = 13   (frames conditioned on the reference image)
#   save_fps        = 25   for avatar-v1.5 (16 for v1.0)
# Each extra segment appends (93 - 13) = 80 NEW frames on top of the first
# segment's 93 ("Video Continuation" mode). These three literals are the whole
# contract with upstream; the test suite pins them.
UPSTREAM_NUM_FRAMES: Final[int] = 93
UPSTREAM_NUM_COND_FRAMES: Final[int] = 13
AVATAR_V15_SAVE_FPS: Final[int] = 25

# Rendered length per segment count: 3.72s, 6.92s, 10.12s, 13.32s, 16.52s.
# MAX_SEGMENTS is the ceiling the Modal endpoint accepts; it must render at
# least PERSONA_LIPSYNC_MAX_SECONDS (the hard hook ceiling in task.py) so no
# production narration can ever ask for a clip longer than the pipeline allows.
# Pinned by a test that reads the task constant directly.
MAX_SEGMENTS: Final[int] = 5

# Silence appended after the narration so a clip that starts mid-phrase still
# has audio to render. It is NOT speech: it must not count toward the clip
# length, or a narration landing within one padding-width of a segment boundary
# buys a whole extra segment (~80 more frames of H200) it does not need.
INTRO_PADDING_SECONDS: Final[float] = 0.2

# Modal published GPU rates (https://modal.com/pricing, per-second billing).
# Only the GPU the production app requests is listed: a rate for hardware
# nothing can run on would be a second thing to keep honest for no benefit.
#
# NOTE: nothing in production reads this table — cost_usd always comes from the
# `cost_usd` field Modal reports on the completed job. It is the client-side
# anchor the sync tests compare against the deployed app's own literal (see
# TestGpuRateSync), which is why it is not dead code. Do not "clean it up".
GPU_RATES_USD_S: Final[dict[str, float]] = {
    "H200": 0.001261,
    "H100": 0.001097,
    "A100-80GB": 0.000694,
}

# LipSyncQuality -> the resolution the Modal endpoint renders. "ok" is the
# benchmarked 480p path; "very_good" renders 720p. Anything else is a caller
# bug and fails loudly rather than silently falling back to 480p.
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
        # Fail here, with the offending duration in the message, rather than
        # letting the Modal endpoint reject the request after a paid round trip.
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
    if response.status_code < 300:
        return
    body = (getattr(response, "text", "") or "").strip()
    scrubbed = re.sub(
        r"(https?://)[^\s/@]+@",
        r"\1[redacted]@",
        scrub_error_text(body, max_chars=200),
        flags=re.IGNORECASE,
    )
    # Production evidence (slot 0d88790d, run 39320019610, 2026-10-19):
    # HTTP 404 + `modal-http: workspace … is disabled`. Status AND body
    # both required — other 404s stay generic LongCatError.
    if (
        response.status_code == 404
        and "modal-http:" in body
        and "is disabled" in body
    ):
        error = LongCatUnavailableError(
            f"LongCat {operation} failed with HTTP 404: {scrubbed}"
        )
        error.response_body = scrubbed  # type: ignore[attr-defined]
        raise error
    raise LongCatError(
        f"LongCat {operation} failed with HTTP {response.status_code}"
        + (f": {scrubbed}" if scrubbed else "")
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

    ``start_seconds`` offsets the cut (used for face-fill tail segments);
    0 keeps the historical intro-trim duration behavior. A single ``-t``
    flag sets the output length: ffmpeg silently applies the LAST
    duplicate flag, so passing two is dead code with a misleading value.
    """
    input_args = ["-i", audio_path]
    if start_seconds > 0:
        # -ss before -i seeks on the demuxer; accurate enough for narration
        # segment cuts and fast on long files.
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
    the Modal job id. Tracked as one ai_request event (backend=modal): the
    Modal job id, duration, cost when reported, and sanitized error when it
    fails. The job id is captured even when the job fails after submit, so
    post-submit failures stay correlatable in PostHog.
    """
    # Validate the quality up front so an unsupported preset fails before the
    # audio is trimmed, rather than after a paid submit. The resolution itself
    # is resolved by the Modal endpoint from the same quality string, so the
    # return value is deliberately unused here.
    resolution_for_quality(quality)  # noqa: B018 — called for the raise
    start = time.monotonic()
    # Populated by _generate_intro_impl once the job is submitted, so a
    # failure during polling/download still reports the job_id.
    job_ids: list[str] = []
    try:
        output_path, job_id, cost_usd = _generate_intro_impl(
            image_path,
            audio_path,
            quality,
            output_path,
            request,
            duration_seconds,
            job_ids,
        )
    except Exception as e:
        track_ai_request(
            {
                "backend": "modal",
                "operation": "generate_intro",
                "job_id": job_ids[0] if job_ids else "",
                "duration_ms": int((time.monotonic() - start) * 1000),
                "success": False,
                "error": scrub_error_text(str(e)),
            }
        )
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
        # Private unit-economics metric: PostHog only, never in API
        # responses. Attached here so cost visibility does not depend on
        # the full pipeline finishing.
        success_props["cost_usd"] = cost_usd
    track_ai_request(success_props)
    return output_path, cost_usd, job_id


def _generate_intro_impl(
    image_path: str,
    audio_path: str,
    quality: LipSyncQuality,
    output_path: str,
    request: Request = requests.request,
    duration_seconds: float | None = None,
    job_id_holder: list[str] | None = None,
) -> tuple[str, str, float | None]:
    """Submit/poll/download the intro video.

    Returns (output_path, job_id, cost_usd): the Modal GPU cost in USD from
    the completed job's status payload, or None when it reports none.
    Appends the submitted job_id to job_id_holder as soon as the submit
    succeeds, so callers can report it even when polling/download fails.
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
        # The trimmed audio is what sets the clip length: LongCat's only length
        # knob is the segment count, so it is derived from the REAL trimmed
        # duration (not the requested one) and rounded up to cover it.
        #
        # The trailing padding is subtracted first. Measuring the padded file
        # directly inflates the count for any narration sitting within one
        # padding-width below a segment boundary -- a 6.75s hook measures 6.95s
        # and would be billed a third segment (10.12s) instead of the second
        # (6.92s). Clamped so audio shorter than the padding still renders one
        # segment instead of raising.
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
    while time.monotonic() < deadline:
        response = request(
            "POST", status_url, data={"job_id": job_id}, headers=headers, timeout=60
        )
        _raise_for_status(response, "status")
        status = _json_object(response)
        state = status.get("status")
        if state == "done":
            cost_usd = _modal_cost_usd(status)
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
    # The task storage dir can vanish between utils.task_dir() creating it
    # and the Modal job finishing its (multi-minute) poll, e.g. a cleanup
    # between stage retries. Recreate it instead of crashing the task.
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    Path(output_path).write_bytes(response.content)
    return output_path, job_id, cost_usd
