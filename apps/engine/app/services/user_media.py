"""Per-segment user media (MCP first, Phase 2): photos shown as panels over the video.

A segment carries a list of photos, each a mediaId (an upload_media temp
asset, 1 hour TTL) or a direct image URL. The segment's spoken time is
split equally across them. Each photo is shown as a framed panel over the
video for its slice (segment_panels): the full
joined script is voiced once, Whisper's word times are walked segment by
segment, and each panel is on screen for its segment's interval. When the
word walk cannot match exactly (numbers, contractions, punctuation split
tokens differently), the intervals fall back to timing proportional to
word counts, and the fallback is reported to the caller instead of
silently placing a photo at the wrong time.

A panel is an overlay, so it works the same on every video: faceless over
stock or the neutral background, and on a persona video over the persona's
face (hook-only or full lip-sync). Where the face shows the panel sits at
the bottom edge, so the captions above it never cover the photo.

A segment's media may carry an overlay (title, subtitle, badge): an info
card with the place's real name, address or price, painted inside the
panel (media_overlay). A card that cannot be drawn costs only the card:
the photo still ships and the reason is recorded as a task warning.

A segment without media shows nothing extra. A segment whose media fails is
skipped with a warning recorded on the task; one bad URL never fails the
video.

Nothing here logs image content, local paths, or full URLs: warnings
carry only the segment index, a stable reason, and — for skipped
images — the image index within that segment.
"""

import contextlib
import os
import re
from typing import Any, Optional, Sequence

import requests
from loguru import logger
from PIL import Image

from app.models.schema import VideoAspect
from app.services import (
    face_detect, faceless_material, image_coverage, media_aspect, media_overlay, persona_hook, place_photos, segment_panels, subtitle, video,
)
from app.services.image_density import split_interval
from app.services.lipsync_active import persona_lipsync_active
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

CHECK_CODES = ("ok", "blocked_403", "not_image", "too_small", "too_large", "timeout", "face_detected", "wrong_aspect", "media_expired")

# check_media_code failure -> the warning reason prepare_segment_media records.
# wrong_aspect is composed with dimensions at the call site instead: the
# bare code alone cannot tell the agent which ratio it sent.
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


def _media_list(media: Any) -> list[Any]:
    """The segment's photos. A missing value or a non-list is no photos."""
    return list(media) if isinstance(media, list) else []


def _segment_dict(segment: Any) -> dict[str, Any]:
    if isinstance(segment, dict):
        return segment
    dump = getattr(segment, "model_dump", None)
    if callable(dump):
        return dict(dump(exclude_none=True))
    return {}


def _probe_size(source_path: str) -> Optional[tuple[int, int]]:
    """Decoded dimensions of an image file, or None when it is not an image."""
    try:
        with Image.open(source_path) as opened:
            return opened.size
    except (OSError, ValueError, Image.DecompressionBombError):
        return None


def _wrong_aspect_reason(source_path: str, aspect: VideoAspect) -> str:
    """The skip reason for a wrong-ratio photo, naming both sides."""
    size = _probe_size(source_path)
    if size is None:
        return "wrong aspect ratio"
    detail = media_aspect.mismatch_detail(size[0], size[1], aspect)
    return f"wrong aspect ratio ({detail})" if detail is not None else "wrong aspect ratio"


def _validate_photo(source_path: str, aspect: Optional[VideoAspect] = None) -> Optional[str]:
    """Mechanical check of one image file: None when usable, else a failure code.

    The code is one of not_image / too_small / too_large / wrong_aspect /
    face_detected. Size is checked on the decoded pixels, so a thumbnail
    is too_small rather than an opaque render failure. The aspect is only
    checked when one was given: a photo that cannot fill the frame is
    wrong_aspect, so it never ships as a blurred strip.
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
    if aspect is not None and media_aspect.mismatch_detail(width, height, aspect) is not None:
        return "wrong_aspect"
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


def _media_id_path(media_id: str) -> tuple[str, Optional[str]]:
    """Temp asset path for a media id: (path, None), or ("", reason)."""
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
    return source, None


def check_media_detail(
    url: Optional[str] = None,
    media_id: Optional[str] = None,
    aspect: Optional[VideoAspect] = None,
    work_dir: str = "",
) -> dict:
    """Mechanical check with dimensions: {"code", "width", "height"}.

    Exactly one of url/media_id. No User-Agent or Referer tricks: a host
    that blocks the SSRF-safe download reports blocked_403 and the agent
    retries with upload_media bytes fetched on its own machine. Never
    logs the URL. A media id that expired or never existed reports
    "media_expired": the caller lets the existing skip-warning path
    handle it, it never blocks the video.
    """
    if media_id is not None:
        source, reason = _media_id_path(media_id)
        if reason is not None:
            return {"code": "media_expired", "width": None, "height": None}
        size = _probe_size(source)
        code = _validate_photo(source, aspect)
        return {
            "code": code if code is not None else "ok",
            "width": size[0] if size is not None else None,
            "height": size[1] if size is not None else None,
        }
    raw_path = os.path.join(work_dir, "check-media.raw")
    try:
        place_photos.download_image(url, raw_path)
    except Exception as exc:  # noqa: BLE001 - every download failure maps to a code
        return {"code": _download_failure_code(exc), "width": None, "height": None}
    try:
        size = _probe_size(raw_path)
        failure = _validate_photo(raw_path, aspect)
        return {
            "code": failure if failure is not None else "ok",
            "width": size[0] if size is not None else None,
            "height": size[1] if size is not None else None,
        }
    finally:
        with contextlib.suppress(OSError):
            os.remove(raw_path)


def check_media_code(
    url: str, work_dir: str, aspect: Optional[VideoAspect] = None
) -> str:
    """Mechanical check of one image URL: one code, no judgement."""
    return check_media_detail(url=url, aspect=aspect, work_dir=work_dir)["code"]


def _resolve_media_id(
    media_id: str, aspect: Optional[VideoAspect] = None
) -> tuple[str, Optional[str]]:
    """A temp asset by its UUID filename: (path, None), or ("", reason)."""
    source, reason = _media_id_path(media_id)
    if reason is not None:
        return "", reason
    failure = _validate_photo(source, aspect)
    if failure is None:
        return source, None
    if failure == "wrong_aspect" and aspect is not None:
        return "", _wrong_aspect_reason(source, aspect)
    return "", _CODE_TO_REASON.get(failure, "unusable media")


def _resolve_url(
    url: str, token: str, task_dir: str, session=None, aspect: Optional[VideoAspect] = None
) -> tuple[str, Optional[str]]:
    """Download one URL to the task directory: (path, None), or ("", reason).

    The downloaded file is the caller's to remove once the panel is drawn.
    """
    raw_path = os.path.join(task_dir, f"segment-media-{token}.raw")
    try:
        place_photos.download_image(url, raw_path, session=session)
    except Exception as exc:  # noqa: BLE001 - one bad URL costs only this segment
        return "", _CODE_TO_REASON.get(_download_failure_code(exc), "download failed")
    failure = _validate_photo(raw_path, aspect)
    if failure is None:
        return raw_path, None
    if failure == "wrong_aspect" and aspect is not None:
        reason = _wrong_aspect_reason(raw_path, aspect)
    else:
        reason = _CODE_TO_REASON.get(failure, "unusable media")
    with contextlib.suppress(OSError):
        os.remove(raw_path)
    return "", reason


def _overlay_font(params: Any, segments: Sequence[Any]) -> Optional[media_overlay.FontFor]:
    """The subtitle font as a size loader, only when some segment wants a card."""
    wants_card = any(
        isinstance(item, dict) and isinstance(item.get("overlay"), dict)
        for segment in segments
        for item in _media_list(_segment_dict(segment).get("media"))
    )
    if not wants_card:
        return None
    try:
        return media_overlay.font_loader(video._resolve_font_with_fallback(params))
    except (ValueError, OSError, AttributeError) as exc:
        logger.warning(f"segment media overlay font unavailable: {type(exc).__name__}")
        return None


def _face_mode(params: Any) -> str:
    """How the persona's face appears: never, for the hook only, or all video."""
    if getattr(params, "persona", None) is None or not persona_lipsync_active(params):
        return segment_panels.FACE_NONE
    if getattr(params, "full_lipsync", False) is True:
        return segment_panels.FACE_FULL
    return segment_panels.FACE_HOOK


def _hook_end(video_script: str, subtitle_path: str, audio_duration: float) -> float:
    """Where the face hands over: the intro's own window, never the segment
    intervals (a proportional interval could draw a full-frame photo over the face)."""
    if not video_script.strip():
        return 0.0
    hook_end, _estimated = persona_hook.measure_hook_end(
        video_script,
        subtitle.file_to_subtitles(subtitle_path),
        audio_duration,
        subtitle.file_to_words(subtitle_path),
    )
    return min(persona_hook.PERSONA_HOOK_MAX_SECONDS, hook_end)


def prepare_segment_media(
    task_id: str,
    segments: Sequence[Any],
    subtitle_path: str,
    audio_duration: float,
    task_dir: str,
    aspect: VideoAspect,
    *,
    face: str = segment_panels.FACE_NONE,
    video_script: str = "",
    session=None,
    font_for: Optional[media_overlay.FontFor] = None,
) -> tuple[list[Panel], list[str]]:
    """Drawn photos (panels or full frame) with spoken intervals, plus skip warnings.

    A warning carries only the segment index, the image index within that
    segment, and a stable reason, never a URL, a path or a mediaId, and
    the caller stores it on the task.
    """
    panels: list[Panel] = []
    skipped: list[str] = []
    dicts = [_segment_dict(segment) for segment in segments]
    intervals, fallback = segment_intervals_from_subtitle(dicts, subtitle_path, audio_duration)
    if fallback and dicts:
        logger.warning(f"segment media for task {task_id}: proportional intervals (word walk mismatched)")
    hook_end = _hook_end(video_script, subtitle_path, audio_duration)
    for index, segment in enumerate(dicts):
        items = _media_list(segment.get("media"))
        if not items:
            continue
        start, end = intervals[index] if index < len(intervals) else (0.0, 0.0)
        if end <= start:
            skipped.extend(
                f"segment {index} image {image_index} media skipped: {REASON_NO_SPOKEN_TIME}"
                for image_index in range(len(items))
            )
            continue
        for image_index, (media, (slice_start, slice_end)) in enumerate(zip(items, split_interval(start, end, len(items)))):
            if not isinstance(media, dict):
                continue
            on_face = face == segment_panels.FACE_FULL or (face == segment_panels.FACE_HOOK and slice_start < hook_end)
            # A photo that fills the frame must match its ratio; a photo
            # shown as a panel is contained by the panel, so no gate.
            resolve_aspect = None if on_face else aspect
            media_id = media.get("mediaId")
            url = media.get("url")
            downloaded = ""
            if isinstance(media_id, str) and media_id:
                photo, reason = _resolve_media_id(media_id, resolve_aspect)
            elif isinstance(url, str) and url:
                photo, reason = _resolve_url(
                    url, f"{index}-{image_index}", task_dir, aspect=resolve_aspect, session=session
                )
                downloaded = photo
            else:
                continue
            if reason is not None:
                skipped.append(f"segment {index} image {image_index} media skipped: {reason}")
                continue
            overlay = media.get("overlay")
            overlay = overlay if isinstance(overlay, dict) else None
            out_path = os.path.join(task_dir, f"segment-panel-{index}-{image_index}.png")
            try:
                if on_face:
                    built = segment_panels.build_panel(photo, overlay, font_for, aspect, out_path)
                else:
                    built = segment_panels.build_full(photo, overlay, font_for, aspect, out_path)
            finally:
                if downloaded:
                    with contextlib.suppress(OSError):
                        os.remove(downloaded)
            if built is None:
                skipped.append(f"segment {index} image {image_index} media skipped: {REASON_PANEL_FAILED}")
                continue
            if built.card_reason is not None:
                skipped.append(f"segment {index} image {image_index} media overlay skipped: {built.card_reason}")
            panels.append(Panel(
                index=index, path=built.path, x=built.x, y=built.y,
                start=slice_start, end=slice_end, caption_bottom=built.caption_bottom,
            ))
    return panels, skipped


def prepare_segment_panels(task_id: str, params: Any, subtitle_path: str, audio_duration: float) -> list[str]:
    """Materials-stage step for tm.start: draw the panels, persist them, report warnings.

    They are overlaid when the final video is assembled (segment_panels.overlay_onto).
    With the images material, raises image_coverage.ImagesDoNotCoverAudio when no
    full-frame photo survived.
    """
    segments = getattr(params, "segments", None)
    if not segments:
        return []
    try:
        aspect = VideoAspect(params.video_aspect)
    except (ValueError, TypeError, AttributeError):
        aspect = VideoAspect.portrait
    face = _face_mode(params)
    video_script = getattr(params, "video_script", "") or ""
    panels, warnings = prepare_segment_media(
        task_id, segments, subtitle_path, audio_duration, utils.task_dir(task_id), aspect,
        face=face, video_script=video_script,
        font_for=_overlay_font(params, segments),
    )
    if getattr(params, "faceless_material", None) == faceless_material.IMAGES:
        # The photos are the whole picture: neighbours cover gaps; none left fails the task.
        hook_end = _hook_end(video_script, subtitle_path, audio_duration) if face == segment_panels.FACE_HOOK else 0.0
        panels, gap_warnings = image_coverage.extend_over_gaps(
            panels, image_coverage.coverage_start(face, hook_end), audio_duration
        )
        warnings = [*warnings, *gap_warnings]
    segment_panels.write_manifest(task_id, panels, warnings)
    return warnings
