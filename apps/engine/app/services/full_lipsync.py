"""Opt-in full lip-sync rendering: the whole video is the persona talking.

Today a persona video only lip-syncs the hook intro;
the rest is b-roll background video. Full mode renders the entire
narration as talking-head windows and concatenates them, so the output
contains no b-roll stock footage at all.

Window arithmetic follows the intro path exactly, not a new model contract:
a LongCat render is capped at the observed-safe 12s window (task.py
PERSONA_LIPSYNC_MAX_SECONDS; the theoretical 5-segment ceiling is 16.52s,
but a 5-segment render SIGKILLed inside the Modal container on the first
real run, so 12s is the per-window cap this module uses). Windows are cut
on subtitle cue boundaries when they exist, otherwise on even 12s splits,
so a cut never lands mid-word when timings are available.

Fail-fast contract (the user's no-silent-fallback rule): anything that
cannot be rendered as full lip-sync raises FullLipSyncError and fails the
task. Full mode NEVER degrades to b-roll, never drops a window, and never
renders a partial face over stock. The caller must not catch this error
and ship the b-roll video instead.
"""

from __future__ import annotations

import base64
import logging
import math
import re
import subprocess
from os import path
from typing import Callable, Sequence

from app.config import config
from app.models.schema import VideoLayout, VideoParams
from app.services import longcat, persona_image
from app.services.lipsync_active import persona_lipsync_active
from app.utils import ssrf, utils

logger = logging.getLogger(__name__)
# Per-window cap, in seconds. Must stay equal to task.py
# PERSONA_LIPSYNC_MAX_SECONDS; a test pins the two literals together.
FULL_LIPSYNC_MAX_WINDOW_SECONDS: float = 12.0
# LongCat's smallest clip is one segment: 93 frames at 25fps = 3.72s.
# A window shorter than this would render a padded clip longer than its
# audio, so short tails are merged backwards (see plan_windows).
FULL_LIPSYNC_MIN_WINDOW_SECONDS: float = 3.72
# Bound on total GPU work per video: 5 windows x 12s = 60s of narration.
# The token price is flat per video (ok -> 2, very_good -> 3), so it must
# not cover unbounded GPU work: beyond 60s the job fails fast, before any
# LongCat window is submitted (plan_windows runs first in
# render_full_lipsync), instead of queueing an unbounded GPU bill. It never
# truncates, never drops a window, and never degrades to b-roll.
# Enforcement layer: the engine is authoritative, on the measured TTS
# duration. The web side cannot measure TTS seconds before charge (TTS
# happens engine-side, the same precedent as the custom-audio 60s limit
# verified by the engine with ffprobe): a >60s full-mode request passes web
# validation, is charged, then fails here before any GPU spend, and the
# failed slot is refunded by the existing fill_schedule reconciler.
MAX_FULL_LIPSYNC_WINDOWS: int = 5
MAX_FULL_LIPSYNC_SECONDS: float = MAX_FULL_LIPSYNC_WINDOWS * FULL_LIPSYNC_MAX_WINDOW_SECONDS

# Subtitle timing pattern, same shape as persona_hook's cue parser.
_CUE_TIMING_RE = re.compile(r"(\d+):(\d+):(\d+)[,\.](\d+)\s*-->\s*(\d+):(\d+):(\d+)[,\.](\d+)")


class FullLipSyncError(RuntimeError):
    """Full lip-sync cannot render this job; fail the task, never fall back."""


def cue_starts_from_subtitles(
    subtitles: Sequence[tuple[int, str, str]],
) -> list[float]:
    """Subtitle cue start times, in seconds, in order."""
    starts: list[float] = []
    for _index, timing, _text in subtitles:
        match = _CUE_TIMING_RE.search(timing)
        if match is None:
            continue
        groups = [int(g) for g in match.groups()]
        start = groups[0] * 3600 + groups[1] * 60 + groups[2] + groups[3] / 1000
        if start > 0:
            starts.append(start)
    return starts


def plan_windows(
    audio_seconds: float,
    cue_starts: Sequence[float] = (),
) -> list[tuple[float, float]]:
    """Split narration into (start, duration) windows for LongCat renders.

    Each window is at most FULL_LIPSYNC_MAX_WINDOW_SECONDS and ends on a
    subtitle cue start when one falls inside the window (at least 1s after
    the window start, so no window is a sliver). Without usable cues the
    split is even 12s chunks. Cue alignment is a preference: when it
    would need more than MAX_FULL_LIPSYNC_WINDOWS windows for audio
    within the 60s ceiling, the split falls back to an even split, so
    preflight-approved narration never fails here after charge. A
    trailing window shorter than the smallest
    LongCat clip is merged backwards into the previous window when that
    keeps both windows inside the cap; a single short video keeps its one
    window and LongCat pads it, as the intro path already does.
    """
    if not math.isfinite(audio_seconds) or audio_seconds <= 0:
        raise FullLipSyncError(f"full lip-sync needs a positive audio duration: {audio_seconds}")
    if audio_seconds > MAX_FULL_LIPSYNC_SECONDS:
        raise FullLipSyncError(
            f"full lip-sync audio {audio_seconds:g}s exceeds the "
            f"{MAX_FULL_LIPSYNC_SECONDS:g}s ceiling "
            f"({MAX_FULL_LIPSYNC_WINDOWS} windows of "
            f"{FULL_LIPSYNC_MAX_WINDOW_SECONDS:g}s)"
        )
    starts = sorted({s for s in cue_starts if 0 < s < audio_seconds})
    windows: list[tuple[float, float]] = []
    current = 0.0
    while current < audio_seconds - 1e-9:
        remaining = audio_seconds - current
        if remaining <= FULL_LIPSYNC_MAX_WINDOW_SECONDS:
            windows.append((current, remaining))
            break
        candidates = [
            s for s in starts if current + 1.0 <= s <= current + FULL_LIPSYNC_MAX_WINDOW_SECONDS
        ]
        end = max(candidates) if candidates else current + FULL_LIPSYNC_MAX_WINDOW_SECONDS
        windows.append((current, end - current))
        current = end
    if len(windows) > MAX_FULL_LIPSYNC_WINDOWS:
        # Cue cuts can overshoot the cap within 60s (58s, 5s cues -> six
        # 10s windows); an even split always fits (>= 6s over 12s).
        count = math.ceil(audio_seconds / FULL_LIPSYNC_MAX_WINDOW_SECONDS)
        windows = [(i * audio_seconds / count, audio_seconds / count) for i in range(count)]
    for start, duration in windows:
        if duration > FULL_LIPSYNC_MAX_WINDOW_SECONDS + 1e-9:
            raise FullLipSyncError(
                f"full lip-sync window {duration:g}s exceeds the "
                f"{FULL_LIPSYNC_MAX_WINDOW_SECONDS:g}s cap"
            )
    if len(windows) >= 2 and windows[-1][1] < FULL_LIPSYNC_MIN_WINDOW_SECONDS:
        prev_start, prev_duration = windows[-2]
        needed = FULL_LIPSYNC_MIN_WINDOW_SECONDS - windows[-1][1]
        new_prev = prev_duration - needed
        if FULL_LIPSYNC_MIN_WINDOW_SECONDS <= new_prev <= FULL_LIPSYNC_MAX_WINDOW_SECONDS:
            windows[-2] = (prev_start, new_prev)
            windows[-1] = (
                prev_start + new_prev,
                audio_seconds - (prev_start + new_prev),
            )
    return windows


def estimate_windows(audio_seconds: float) -> int:
    """Window count for an even split (cost-model helper, no cues)."""
    return len(plan_windows(audio_seconds, ()))


def estimate_cost_usd(window_count: int, per_window_cost_usd: float | None) -> float | None:
    """Handler-only GPU cost estimate: windows x per-window cost.

    Returns None when the per-window cost is unknown: a partial sum must
    never be presented as a total. This is the marginal handler cost only;
    container boot/weight load and the scaledown idle hold are NOT included
    (see modal_longcat.py: cost_usd is handler entry to exit, while
    container_cost_usd carries the container-to-date spend).
    """
    if per_window_cost_usd is None:
        return None
    return window_count * per_window_cost_usd


def total_cost_usd(costs: Sequence[float | None]) -> float | None:
    """Sum of per-window Modal costs, or None when any window hid its cost."""
    total = 0.0
    for cost in costs:
        if cost is None:
            return None
        total += cost
    return total


def build_concat_command(
    clip_paths: Sequence[str],
    window_seconds: Sequence[float],
    output_path: str,
    codec: str = "libx264",
) -> list[str]:
    """One ffmpeg command joining window clips into a silent full video.

    Each input is trimmed to its window duration (LongCat clips are rounded
    UP to the segment grid, so an untrimmed join would drift out of sync by
    seconds per window) and the inputs are concatenated with a single
    re-encode. Audio is dropped (-an): the downstream final encode muxes
    the full narration, exactly as the intro path does for its clip.
    """
    if len(clip_paths) != len(window_seconds):
        raise FullLipSyncError(
            f"full lip-sync concat needs one duration per clip: "
            f"{len(clip_paths)} clips, {len(window_seconds)} durations"
        )
    if not clip_paths:
        raise FullLipSyncError("full lip-sync concat needs at least one clip")
    inputs: list[str] = []
    filters: list[str] = []
    for index, (clip, seconds) in enumerate(zip(clip_paths, window_seconds)):
        inputs.extend(["-i", clip])
        filters.append(f"[{index}:v]trim=duration={seconds:g},setpts=PTS-STARTPTS,fps=25[v{index}]")
    concat_inputs = "".join(f"[v{i}]" for i in range(len(clip_paths)))
    filter_graph = ";".join(filters) + f";{concat_inputs}concat=n={len(clip_paths)}:v=1:a=0[vout]"
    return [
        "ffmpeg",
        "-y",
        *inputs,
        "-filter_complex",
        filter_graph,
        "-map",
        "[vout]",
        "-an",
        "-c:v",
        codec,
        "-pix_fmt",
        "yuv420p",
        output_path,
    ]


def resolve_persona_image(
    task_id: str,
    params: VideoParams,
    max_bytes: int,
) -> str:
    """Download the persona image to the task dir, as the intro path does.

    Extracted verbatim from task.py's intro path so both callers share one
    SSRF-safe download: data-URI images are decoded, remote images go
    through the public-address check with a 20 MB cap and image/* content
    type. Failures raise LongCatError and fail the task.
    """
    persona = params.persona
    if persona is None:
        raise longcat.LongCatError("lip sync requires a persona")
    image_url = persona.avatar_url or persona.photo_url
    if not image_url:
        raise longcat.LongCatError("lip sync requires a persona image")
    task_dir = utils.task_dir(task_id)
    image_path = path.join(task_dir, "persona-lipsync-image.png")
    if path.isfile(image_path) and path.getsize(image_path) > 0:
        # Already fetched by persona_preflight at the start of the task.
        return image_path
    if image_url.startswith("data:image/"):
        try:
            encoded = image_url.split(",", 1)[1]
            with open(image_path, "wb") as image_file:
                image_file.write(base64.b64decode(encoded))
        except (IndexError, ValueError) as exc:
            raise longcat.LongCatError("invalid persona image data URI") from exc
    else:
        try:
            ssrf.download_public_file(
                persona_image.resolve_persona_image_url(image_url),
                image_path,
                what="persona image",
                max_bytes=max_bytes,
                allowed_content_types=("image/",),
                timeout=60,
                tls_verify=config.app.get("tls_verify", True),
            )
        except ssrf.UnsafeUrlError as exc:
            raise longcat.LongCatError(f"persona image download rejected: {exc}") from exc
        except OSError as exc:
            raise longcat.LongCatError(f"persona image download failed: {exc}") from exc
    return image_path


def render_full_lipsync(
    task_id: str,
    params: VideoParams,
    image_path: str,
    audio_file: str,
    audio_seconds: float,
    subtitles: Sequence[tuple[int, str, str]],
    output_path: str,
    generate_intro: Callable[..., tuple[str, float | None, str]] = longcat.generate_intro,
    trim_audio: Callable[..., None] = longcat.trim_audio,
    run_ffmpeg: Callable[..., object] | None = None,
) -> tuple[str, float | None, list[str]]:
    """Render every narration window as lip-sync and join them.

    Returns (output_path, total_cost_usd_or_None, job_ids). Every window
    failure propagates: the caller must fail the task, never ship b-roll
    instead. Stock material is never read here; the output is the persona
    only, silent, for the downstream final encode to mux with narration.
    """
    if params.persona is None:
        raise FullLipSyncError("full lip-sync requires a persona")
    windows = plan_windows(audio_seconds, cue_starts_from_subtitles(subtitles))
    task_dir = utils.task_dir(task_id)
    clip_paths: list[str] = []
    costs: list[float | None] = []
    job_ids: list[str] = []
    for index, (start, duration) in enumerate(windows):
        window_audio = path.join(task_dir, f"full-lipsync-audio-{index}.mp3")
        trim_audio(
            audio_file,
            window_audio,
            duration_seconds=duration,
            padding_seconds=0.2,
            start_seconds=start,
        )
        clip_path = path.join(task_dir, f"full-lipsync-clip-{index}.mp4")
        _out, cost_usd, job_id = generate_intro(
            image_path=image_path,
            audio_path=window_audio,
            quality=params.video_quality,
            output_path=clip_path,
            duration_seconds=duration,
        )
        clip_paths.append(clip_path)
        costs.append(cost_usd)
        job_ids.append(job_id)
    codec = str(config.app.get("video_codec", "libx264"))
    command = build_concat_command(
        clip_paths,
        [duration for _start, duration in windows],
        output_path,
        codec=codec,
    )
    # check=False: with check=True the `status != 0` branch below is
    # unreachable in production (subprocess.run raises instead).
    runner = run_ffmpeg or (
        lambda argv: subprocess.run(argv, capture_output=True, text=True, check=False)
    )
    result = runner(command)
    status = getattr(result, "returncode", 0)
    if status != 0:
        # Raised message reaches task error/Discord via safe_reason
        # (secrets only), so stderr must not be embedded in it. It is
        # not logged either: CodeQL flags logging stderr-derived text
        # even scrubbed (verified: a codeql suppression on the scrubbed
        # log line did not clear the alert on head e07b0654).
        logger.error("full lip-sync concat failed")
        raise FullLipSyncError("full lip-sync concat failed")
    return output_path, total_cost_usd(costs), job_ids


# A lip-sync face fills the frame (full mode: the whole video; hook mode:
# the intro), so the default center caption lands on the mouth. 70% from
# the top sits under the chin and above the bottom strip the platform UI
# (title, channel) covers. 70% is the top of the caption box, not its
# center: a multi-line caption extends downward from there, and the final
# encode clamps it on-screen. The value is an estimate from a Shorts
# screenshot, not yet verified on a rendered video.
LIPSYNC_CAPTION_POSITION: float = 70.0


def caption_params(params: VideoParams) -> VideoParams:
    """Params for the final encode, with the caption moved off the face.

    Applies to full lip-sync and to the hook intro. The react exclusion
    is hook-only: in hook mode its center caption sits on the seam between
    the persona (top half) and the b-roll (bottom half), so it stays. In
    full mode the whole video is the face and there is no seam, so a full
    video in the react layout still moves. Only the default "center"
    placement moves: an explicit "top", "bottom" or "custom" choice is
    the user's and is kept. Other jobs return `params` as is.
    """
    if params.subtitle_position != "center":
        return params
    on_face = params.full_lipsync or (
        persona_lipsync_active(params) and params.video_layout != VideoLayout.react
    )
    if not on_face:
        return params
    return params.model_copy(
        update={
            "subtitle_position": "custom",
            "custom_position": LIPSYNC_CAPTION_POSITION,
        }
    )
