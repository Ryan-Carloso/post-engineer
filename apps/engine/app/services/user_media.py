"""Per-segment user media for faceless videos (MCP first, Phase 2).

A segment carries either a mediaId (an upload_media temp asset, 1 hour
TTL) or a direct image URL. The photo occupies the segment's spoken
interval: the full joined script is voiced once, Whisper's word times
are walked segment by segment, and each photo replaces the clip that
overlaps its interval most. When the word walk cannot match exactly
(numbers, contractions, punctuation split tokens differently), the
intervals fall back to timing proportional to word counts, and the
fallback is reported to the caller instead of silently placing a photo
at the wrong time.

A segment without media keeps whatever clip was already there (stock
from the agent's terms, or the neutral background) — no theme is ever
invented for it. A segment whose media fails is skipped with a warning
recorded on the task; one bad URL never fails the video. Lip-sync
videos do not render segment media yet (the intro/outro timeline would
shift every interval): their media is skipped with a warning, not
silently dropped.

Nothing here logs image content, local paths, or full URLs: warnings
carry only the segment index and a stable reason.
"""

import contextlib
import os
import re
from dataclasses import dataclass
from typing import Any, Optional, Sequence

import requests
from loguru import logger
from PIL import Image

from app.models.schema import VideoAspect
from app.services import audio_trim, face_detect, image_material, place_photos, subtitle, svg_terms
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


@dataclass
class SegmentMedia:
    """A validated still ready to take its segment's clip."""

    index: int
    still_path: str
    start: float
    end: float


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


def _prepare_still(source_path: str, dest_path: str, aspect: VideoAspect) -> tuple[str, Optional[str]]:
    """Validate, compose and face-check one image file.

    Returns (still_path, None) on success, or ("", failure_code) where the
    code is one of not_image / too_small / too_large / face_detected.
    Size is checked on the decoded pixels before composing, so a
    thumbnail is too_small rather than an opaque compose failure.
    """
    try:
        with Image.open(source_path) as opened:
            width, height = opened.size
    except (OSError, ValueError, Image.DecompressionBombError):
        return "", "not_image"
    if width * height > MAX_PHOTO_PIXELS:
        return "", "too_large"
    if max(width, height) < MIN_PHOTO_LONG_EDGE or min(width, height) < MIN_PHOTO_SHORT_EDGE:
        return "", "too_small"
    still = place_photos.compose_portrait_still(source_path, dest_path, aspect)
    if not still:
        return "", "not_image"
    if face_detect.image_contains_face(still):
        return "", "face_detected"
    return still, None


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


def check_media_code(url: str, work_dir: str, aspect: VideoAspect = VideoAspect.portrait) -> str:
    """Mechanical check of one image URL: one code, no judgement.

    No User-Agent or Referer tricks: a host that blocks the SSRF-safe
    download reports blocked_403 and the agent retries with upload_media
    bytes it fetched on its own machine. Never logs the URL.
    """
    raw_path = os.path.join(work_dir, "check-media.raw")
    still_path = os.path.join(work_dir, "check-media.jpg")
    try:
        place_photos.download_image(url, raw_path)
    except Exception as exc:  # noqa: BLE001 - every download failure maps to a code
        return _download_failure_code(exc)
    try:
        _, failure = _prepare_still(raw_path, still_path, aspect)
        return failure if failure is not None else "ok"
    finally:
        with contextlib.suppress(OSError):
            os.remove(raw_path)
        with contextlib.suppress(OSError):
            os.remove(still_path)


def _resolve_media_id(media_id: str, task_dir: str, aspect: VideoAspect) -> tuple[str, Optional[str]]:
    """A temp asset by its UUID filename, or ("", reason)."""
    if not _MEDIA_ID_PATTERN.match(media_id or ""):
        return "", "invalid media id"
    try:
        source = file_security.resolve_path_within_directory(
            _temp_assets_dir(), os.path.join(_temp_assets_dir(), media_id)
        )
    except ValueError:
        return "", "invalid media id"
    if not os.path.isfile(source):
        # The 1 hour temp_assets TTL already purged it, or it never existed.
        return "", "media expired or missing"
    still = os.path.join(task_dir, f"segment-media-{os.path.splitext(media_id)[0]}.jpg")
    return _prepare_still(source, still, aspect)


def _resolve_url(url: str, index: int, task_dir: str, aspect: VideoAspect, session=None) -> tuple[str, Optional[str]]:
    raw_path = os.path.join(task_dir, f"segment-media-{index}.raw")
    try:
        place_photos.download_image(url, raw_path, session=session)
    except Exception as exc:  # noqa: BLE001 - one bad URL costs only this segment
        return "", _CODE_TO_REASON.get(_download_failure_code(exc), "download failed")
    try:
        still, failure = _prepare_still(raw_path, os.path.join(task_dir, f"segment-media-{index}.jpg"), aspect)
        if failure is not None:
            return "", _CODE_TO_REASON.get(failure, "unusable media")
        return still, None
    finally:
        with contextlib.suppress(OSError):
            os.remove(raw_path)


def prepare_segment_media(
    task_id: str,
    segments: Sequence[Any],
    subtitle_path: str,
    audio_duration: float,
    task_dir: str,
    aspect: VideoAspect,
    *,
    lipsync_active: bool = False,
    session=None,
) -> tuple[list[SegmentMedia], list[str]]:
    """Validated stills with spoken intervals, plus per-segment skip warnings.

    Warnings carry only the segment index and a stable reason — never a
    URL, a path, or a mediaId. The caller stores them on the task so the
    status endpoint surfaces them; they are not just a log line.
    """
    prepared: list[SegmentMedia] = []
    skipped: list[str] = []
    dicts = [_segment_dict(segment) for segment in segments]
    intervals, fallback = segment_intervals_from_subtitle(dicts, subtitle_path, audio_duration)
    if fallback and dicts:
        logger.warning(f"segment media for task {task_id}: proportional intervals (word walk mismatched)")
    for index, segment in enumerate(dicts):
        media = segment.get("media")
        if not isinstance(media, dict):
            continue
        if lipsync_active:
            skipped.append(f"segment {index} media skipped: lip-sync videos do not render segment media yet")
            continue
        start, end = intervals[index] if index < len(intervals) else (0.0, 0.0)
        media_id = media.get("mediaId")
        url = media.get("url")
        if isinstance(media_id, str) and media_id:
            still, reason = _resolve_media_id(media_id, task_dir, aspect)
        elif isinstance(url, str) and url:
            still, reason = _resolve_url(url, index, task_dir, aspect, session=session)
        else:
            continue
        if reason is not None:
            skipped.append(f"segment {index} media skipped: {reason}")
            continue
        prepared.append(SegmentMedia(index=index, still_path=still, start=start, end=end))
    return prepared, skipped


def _clip_durations(clips: Sequence[str], clip_seconds: float) -> list[float]:
    """What each clip contributes to the timeline (probed, capped)."""
    durations: list[float] = []
    for clip in clips:
        try:
            durations.append(min(audio_trim.media_duration(clip), clip_seconds))
        except Exception:  # noqa: BLE001 - an unprobable clip counts as a full clip
            durations.append(clip_seconds)
    return durations


def splice_segment_media(
    clips: list[str], prepared: Sequence[SegmentMedia], clip_seconds: float
) -> tuple[list[str], list[str]]:
    """`clips` with each segment's photo clip replacing its max-overlap clip.

    Returns (clips, skipped warnings). A segment whose interval overlaps
    no clip, or whose still fails to render, keeps the original clip
    and is reported in the warnings — never just a log line.
    A segment whose best clip is already used by an earlier segment's
    photo is skipped with a warning instead of overwriting that photo
    with no trace: two short adjacent segments can both overlap the
    same clip most. The input list is untouched.
    """
    if not prepared or not clips or clip_seconds <= 0:
        return list(clips), []
    durations = _clip_durations(clips, clip_seconds)
    starts: list[float] = []
    cursor = 0.0
    for duration in durations:
        starts.append(cursor)
        cursor += duration
    result = list(clips)
    used: set[int] = set()
    skipped: list[str] = []
    for media in sorted(prepared, key=lambda item: item.start):
        best_index: Optional[int] = None
        best_overlap = 0.0
        for index, duration in enumerate(durations):
            overlap = min(media.end, starts[index] + duration) - max(media.start, starts[index])
            if overlap > best_overlap:
                best_overlap = overlap
                best_index = index
        if best_index is None:
            logger.warning("segment media interval overlaps no clip; keeping the original clip")
            skipped.append(f"segment {media.index} media skipped: interval overlaps no clip")
            continue
        if best_index in used:
            logger.warning(
                "segment media clip already used by an earlier segment; keeping the first photo"
            )
            skipped.append(
                f"segment {media.index} media skipped: clip already used by an earlier segment"
            )
            continue
        rendered = image_material.render_image_file_to_mp4(
            media.still_path, clip_duration=max(1, round(clip_seconds))
        )
        if rendered:
            result[best_index] = rendered
            used.add(best_index)
        else:
            logger.warning("segment media clip failed to render; keeping the original clip")
            skipped.append(f"segment {media.index} media skipped: photo clip failed to render")
    return result, skipped


def apply_segment_media(
    task_id: str,
    params: Any,
    clips: list[str],
    subtitle_path: str,
    audio_duration: float,
    *,
    lipsync_active: bool,
) -> tuple[list[str], list[str]]:
    """Full wiring step for tm.start: prepare, splice, report warnings.

    Returns (clips, warnings). Without segments, or without media on any
    segment, the clips and warnings pass through untouched.
    """
    segments = getattr(params, "segments", None)
    if not segments:
        return list(clips), []
    try:
        aspect = VideoAspect(params.video_aspect)
    except (ValueError, TypeError, AttributeError):
        aspect = VideoAspect.portrait
    task_dir = utils.task_dir(task_id)
    prepared, skipped = prepare_segment_media(
        task_id, segments, subtitle_path, audio_duration, task_dir, aspect,
        lipsync_active=lipsync_active,
    )
    if not prepared:
        return list(clips), skipped
    clip_seconds = svg_terms.clip_seconds(params, len(clips), audio_duration)
    if not clip_seconds:
        clip_seconds = params.video_clip_duration or 4
    spliced, splice_skipped = splice_segment_media(clips, prepared, clip_seconds)
    return spliced, [*skipped, *splice_skipped]
