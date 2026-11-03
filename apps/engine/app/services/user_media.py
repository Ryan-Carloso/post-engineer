"""Per-segment user media (MCP first, Phase 2): photos shown as panels over the video.

A segment carries either a mediaId (an upload_media temp asset, 1 hour
TTL) or a direct image URL. The photo is shown as a framed panel over the
video for the seconds its segment is spoken (segment_panels): the full
joined script is voiced once, Whisper's word times are walked segment by
segment, and each panel is on screen for its segment's interval. When the
word walk cannot match exactly (numbers, contractions, punctuation split
tokens differently), the intervals fall back to timing proportional to
word counts, and the fallback is reported to the caller instead of
silently placing a photo at the wrong time.

A panel is an overlay, so it works the same on every video: faceless over
stock or the neutral background, and on a persona video over the persona's
face (hook-only or full lip-sync). In the react layout the persona fills
the top half, so the panel anchors to the bottom edge instead.

A segment's media may carry an overlay (title, subtitle, badge): an info
card with the place's real name, address or price, painted inside the
panel (media_overlay). A card that cannot be drawn costs only the card:
the photo still ships and the reason is recorded as a task warning.

A segment without media shows nothing extra. A segment whose media fails is
skipped with a warning recorded on the task; one bad URL never fails the
video.

Nothing here logs image content, local paths, or full URLs: warnings
carry only the segment index and a stable reason.
"""

import contextlib
import os
import re
from typing import Any, Optional, Sequence

import requests
from loguru import logger
from PIL import Image

from app.models.schema import VideoAspect
from app.services import face_detect, media_overlay, persona_hook, place_photos, segment_panels, subtitle, video
from app.services.lipsync_active import persona_lipsync_active
from app.services.lipsync_layout import LAYOUT_REACT
from app.services.segment_panels import Panel
from app.utils import file_security, utils
from app.utils.ssrf import UnsafeUrlError

# The segment-media bottleneck is the engine photo path, not the persona
# library: place_photos refuses downloads over this size, so a larger
# segment upload could never render. Pinned by test against both limits.
MAX_SEGMENT_MEDIA_BYTES = place_photos.MAX_PHOTO_BYTES
MIN_PHOTO_LONG_EDGE = place_photos.MIN_PHOTO_LONG_EDGE
MIN_PHOTO_SHORT_EDGE = place_photos.MIN_PHOTO_SHORT_EDGE
MAX_PHOTO_PIXELS = place_photos.MAX_PHOTO_PIXELS

_WORD = re.compile(r"[^\W_]+")
_MEDIA_ID_PATTERN = re.compile(r"^[0-9a-f]{32}\.(jpg|jpeg|png|webp)$")

CHECK_CODES = ("ok", "blocked_403", "not_image", "too_small", "too_large", "timeout", "face_detected")

# check_media_code failure -> the warning reason prepare_segment_media records.
_CODE_TO_REASON = {
    "blocked_403": "download blocked",
    "not_image": "not an image",
    "too_small": "too small",
    "too_large": "too large",
    "timeout": "download timed out",
    "face_detected": "face detected",
}
REASON_NO_SPOKEN_TIME = "segment has no spoken time"
REASON_PANEL_FAILED = "photo panel failed to render"


def _temp_assets_dir() -> str:
    return utils.storage_dir("temp_assets", create=True)


def _tokens(text: str) -> list[str]:
    return _WORD.findall(text.casefold())


def segment_intervals(
    segments: Sequence[dict[str, Any]],
    words: Sequence[tuple[str, float, float]],
    audio_duration: float,
) -> tuple[list[tuple[float, float]], bool]:
    """Spoken interval per segment, plus whether proportional fallback ran.

    Exact walk: the flattened subtitle tokens must equal the flattened
    segment tokens; each segment then takes the first/last time of the
    tokens it consumes. Anything else (a tokenisation mismatch, no word
    times at all) falls back to intervals proportional to token counts
    over the full audio duration, so a photo is never placed by a walk
    that silently drifted.
    """
    counts = [len(_tokens(str(segment.get("text", "")))) for segment in segments]
    total = sum(counts)
    if not segments:
        return [], False
    if audio_duration <= 0:
        return [(0.0, 0.0) for _ in segments], True
    flat: list[tuple[str, float, float]] = []
    for text, start, end in words:
        for token in _tokens(text):
            flat.append((token, start, end))
    segment_tokens = [_tokens(str(segment.get("text", ""))) for segment in segments]
    if flat and [token for token, _, _ in flat] == [token for tokens in segment_tokens for token in tokens]:
        intervals: list[tuple[float, float]] = []
        cursor = 0
        for tokens in segment_tokens:
            if not tokens:
                # A segment with no spoken words (punctuation-only text
                # passes validation) has no interval of its own: inherit
                # the previous boundary instead of indexing an empty
                # slice, which raised IndexError and failed the video.
                boundary = flat[cursor - 1][2] if cursor > 0 else 0.0
                intervals.append((boundary, boundary))
                continue
            taken = flat[cursor : cursor + len(tokens)]
            intervals.append((taken[0][1], taken[-1][2]))
            cursor += len(tokens)
        return intervals, False
    # Proportional fallback: by token count, or evenly when nothing has words.
    intervals = []
    cursor = 0.0
    for index, count in enumerate(counts):
        share = (count / total) if total > 0 else (1.0 / len(segments))
        end = audio_duration if index == len(segments) - 1 else cursor + audio_duration * share
        intervals.append((cursor, end))
        cursor = end
    return intervals, True


def segment_intervals_from_subtitle(
    segments: Sequence[dict[str, Any]], subtitle_path: str, audio_duration: float
) -> tuple[list[tuple[float, float]], bool]:
    """Intervals from the word file next to `subtitle_path`."""
    return segment_intervals(segments, subtitle.file_to_words(subtitle_path), audio_duration)


def _segment_dict(segment: Any) -> dict[str, Any]:
    if isinstance(segment, dict):
        return segment
    dump = getattr(segment, "model_dump", None)
    if callable(dump):
        return dict(dump(exclude_none=True))
    return {}


def _validate_photo(source_path: str) -> Optional[str]:
    """Mechanical check of one image file: None when usable, else a failure code.

    The code is one of not_image / too_small / too_large / face_detected.
    Size is checked on the decoded pixels, so a thumbnail is too_small
    rather than an opaque render failure.
    """
    try:
        with Image.open(source_path) as opened:
            width, height = opened.size
    except (OSError, ValueError, Image.DecompressionBombError):
        return "not_image"
    if width * height > MAX_PHOTO_PIXELS:
        return "too_large"
    if max(width, height) < MIN_PHOTO_LONG_EDGE or min(width, height) < MIN_PHOTO_SHORT_EDGE:
        return "too_small"
    if face_detect.image_contains_face(source_path):
        return "face_detected"
    return None


def _download_failure_code(exc: Exception) -> str:
    """Map a download failure onto a check_media code, truthfully."""
    if isinstance(exc, (requests.exceptions.Timeout, TimeoutError)):
        return "timeout"
    if isinstance(exc, UnsafeUrlError):
        message = str(exc)
        if "HTTP 403" in message:
            return "blocked_403"
        if "exceeds the download limit" in message:
            return "too_large"
        if "unexpected content-type" in message:
            return "not_image"
        # SSRF-guard refusals (private address, unresolvable host, other
        # HTTP failures): the host blocked or refused the download.
        return "blocked_403"
    if isinstance(exc, requests.exceptions.RequestException):
        return "blocked_403"
    return "blocked_403"


def check_media_code(url: str, work_dir: str) -> str:
    """Mechanical check of one image URL: one code, no judgement.

    No User-Agent or Referer tricks: a host that blocks the SSRF-safe
    download reports blocked_403 and the agent retries with upload_media
    bytes it fetched on its own machine. Never logs the URL.
    """
    raw_path = os.path.join(work_dir, "check-media.raw")
    try:
        place_photos.download_image(url, raw_path)
    except Exception as exc:  # noqa: BLE001 - every download failure maps to a code
        return _download_failure_code(exc)
    try:
        failure = _validate_photo(raw_path)
        return failure if failure is not None else "ok"
    finally:
        with contextlib.suppress(OSError):
            os.remove(raw_path)


def _resolve_media_id(media_id: str) -> tuple[str, Optional[str]]:
    """A temp asset by its UUID filename: (path, None), or ("", reason)."""
    if not _MEDIA_ID_PATTERN.match(media_id or ""):
        return "", "invalid media id"
    try:
        source = file_security.resolve_path_within_directory(
            _temp_assets_dir(), os.path.join(_temp_assets_dir(), media_id)
        )
    except ValueError as exc:
        # A well-formed id whose temp asset the 1 hour TTL already purged
        # is expired, not invalid; anything else (an escaping path) is invalid.
        if str(exc) == "file does not exist":
            return "", "media expired or missing"
        return "", "invalid media id"
    failure = _validate_photo(source)
    return (source, None) if failure is None else ("", _CODE_TO_REASON.get(failure, "unusable media"))


def _resolve_url(url: str, index: int, task_dir: str, session=None) -> tuple[str, Optional[str]]:
    """Download one URL to the task directory: (path, None), or ("", reason).

    The downloaded file is the caller's to remove once the panel is drawn.
    """
    raw_path = os.path.join(task_dir, f"segment-media-{index}.raw")
    try:
        place_photos.download_image(url, raw_path, session=session)
    except Exception as exc:  # noqa: BLE001 - one bad URL costs only this segment
        return "", _CODE_TO_REASON.get(_download_failure_code(exc), "download failed")
    failure = _validate_photo(raw_path)
    if failure is not None:
        with contextlib.suppress(OSError):
            os.remove(raw_path)
        return "", _CODE_TO_REASON.get(failure, "unusable media")
    return raw_path, None


def _overlay_font(params: Any, segments: Sequence[Any]) -> Optional[media_overlay.FontFor]:
    """The subtitle font as a size loader, only when some segment wants a card."""
    wants_card = any(
        isinstance(_segment_dict(segment).get("media"), dict)
        and isinstance(_segment_dict(segment)["media"].get("overlay"), dict)
        for segment in segments
    )
    if not wants_card:
        return None
    try:
        return media_overlay.font_loader(video._resolve_font_with_fallback(params))
    except (ValueError, OSError, AttributeError) as exc:
        logger.warning(f"segment media overlay font unavailable: {type(exc).__name__}")
        return None


def _anchor(params: Any) -> str:
    """Bottom for the react layout (persona on top), top for every other video."""
    layout = getattr(params, "video_layout", None)
    layout = getattr(layout, "value", layout)
    persona = getattr(params, "persona", None)
    face_on_top = (
        layout == LAYOUT_REACT
        and persona is not None
        and persona_lipsync_active(params)
        and getattr(params, "full_lipsync", False) is not True
    )
    return segment_panels.ANCHOR_BOTTOM if face_on_top else segment_panels.ANCHOR_TOP


def _face_mode(params: Any) -> str:
    """How the persona's face appears: never, for the hook only, or all video."""
    if getattr(params, "persona", None) is None or not persona_lipsync_active(params):
        return segment_panels.FACE_NONE
    if getattr(params, "full_lipsync", False) is True:
        return segment_panels.FACE_FULL
    return segment_panels.FACE_HOOK


def _hook_end(segments: Sequence[dict[str, Any]], intervals: Sequence[tuple[float, float]]) -> float:
    """Second at which a hook-only lip-sync intro ends: the hook's spoken end.

    The intro is the hook, capped at the hook ceiling (the lip-sync GPU
    window), so a hook that runs past the ceiling still hands over to b-roll
    at the ceiling.
    """
    ceiling = persona_hook.PERSONA_HOOK_MAX_SECONDS
    if not segments or not intervals or segments[0].get("kind") != "hook":
        return ceiling
    return min(ceiling, intervals[0][1])


def prepare_segment_media(
    task_id: str,
    segments: Sequence[Any],
    subtitle_path: str,
    audio_duration: float,
    task_dir: str,
    aspect: VideoAspect,
    *,
    face: str = segment_panels.FACE_NONE,
    anchor: str = segment_panels.ANCHOR_TOP,
    session=None,
    font_for: Optional[media_overlay.FontFor] = None,
) -> tuple[list[Panel], list[str]]:
    """Drawn photos (panels or full frame) with spoken intervals, plus skip warnings.

    Warnings carry only the segment index and a stable reason, never a
    URL, a path, or a mediaId. The caller stores them on the task so the
    status endpoint surfaces them; they are not just a log line.
    """
    panels: list[Panel] = []
    skipped: list[str] = []
    dicts = [_segment_dict(segment) for segment in segments]
    intervals, fallback = segment_intervals_from_subtitle(dicts, subtitle_path, audio_duration)
    if fallback and dicts:
        logger.warning(f"segment media for task {task_id}: proportional intervals (word walk mismatched)")
    hook_end = _hook_end(dicts, intervals)
    for index, segment in enumerate(dicts):
        media = segment.get("media")
        if not isinstance(media, dict):
            continue
        start, end = intervals[index] if index < len(intervals) else (0.0, 0.0)
        if end <= start:
            skipped.append(f"segment {index} media skipped: {REASON_NO_SPOKEN_TIME}")
            continue
        media_id = media.get("mediaId")
        url = media.get("url")
        downloaded = ""
        if isinstance(media_id, str) and media_id:
            photo, reason = _resolve_media_id(media_id)
        elif isinstance(url, str) and url:
            photo, reason = _resolve_url(url, index, task_dir, session=session)
            downloaded = photo
        else:
            continue
        if reason is not None:
            skipped.append(f"segment {index} media skipped: {reason}")
            continue
        overlay = media.get("overlay")
        overlay = overlay if isinstance(overlay, dict) else None
        out_path = os.path.join(task_dir, f"segment-panel-{index}.png")
        on_face = face == segment_panels.FACE_FULL or (face == segment_panels.FACE_HOOK and start < hook_end)
        try:
            if on_face:
                built = segment_panels.build_panel(photo, overlay, font_for, aspect, anchor, out_path)
            else:
                built = segment_panels.build_full(photo, overlay, font_for, aspect, out_path)
        finally:
            if downloaded:
                with contextlib.suppress(OSError):
                    os.remove(downloaded)
        if built is None:
            skipped.append(f"segment {index} media skipped: {REASON_PANEL_FAILED}")
            continue
        if built.card_reason is not None:
            skipped.append(f"segment {index} media overlay skipped: {built.card_reason}")
        panels.append(Panel(index=index, path=built.path, x=built.x, y=built.y, start=start, end=end))
    return panels, skipped


def prepare_segment_panels(task_id: str, params: Any, subtitle_path: str, audio_duration: float) -> list[str]:
    """Materials-stage step for tm.start: draw the panels, persist them, report warnings.

    The panels are overlaid when the final video is assembled
    (segment_panels.overlay_onto), so a persona's intro or a full lip-sync
    render underneath never changes where a photo lands. Without segments
    nothing is written. Returns the task warnings.
    """
    segments = getattr(params, "segments", None)
    if not segments:
        return []
    try:
        aspect = VideoAspect(params.video_aspect)
    except (ValueError, TypeError, AttributeError):
        aspect = VideoAspect.portrait
    panels, warnings = prepare_segment_media(
        task_id, segments, subtitle_path, audio_duration, utils.task_dir(task_id), aspect,
        face=_face_mode(params), anchor=_anchor(params), font_for=_overlay_font(params, segments),
    )
    segment_panels.write_manifest(task_id, panels, warnings)
    return warnings
