"""Per-segment user media (MCP first, Phase 2): photos shown as panels over the video.

A segment carries a list of photos, each a mediaId (an media (action: upload) temp
asset, 1 hour TTL) or a direct image URL. The segment's spoken time is
split equally across them. Each photo is shown as a framed panel over the
video for its slice (segment_panels): the full
joined script is voiced once, Whisper's word times are walked segment by
segment, and each panel is on screen for its segment's interval. When the
word walk cannot match exactly (numbers, contractions, punctuation split
tokens differently), the intervals fall back to timing proportional to
word counts, and the fallback is reported to the caller instead of
silently placing a photo at the wrong time.

A panel is an overlay, so it works the same on every video: voiceover over
the neutral background, and on a persona video over the persona's
face (hook-only or full lip-sync). Where the face shows the panel sits at
the bottom edge, so the captions above it never cover the photo.

A segment's media may carry an overlay (title, subtitle, badge): an info
card with the place's real name, address or price, painted inside the
panel (media_overlay). A card that cannot be drawn costs only the card:
the photo still ships and the reason is recorded as a task warning.

A segment without media shows nothing extra. In the images modes every sent
photo must survive render: a skipped one fails the task with
images_do_not_cover_audio naming the photo (full lip sync stays lenient and
only warns). The warning itself never carries a URL, a path or a mediaId.

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

from app.models.schema import VideoAspect
from app.services import (
    face_detect, image_coverage, media_overlay, persona_hook, image_fetch, segment_panels, subtitle, video,
    photo_content, segment_video,
)
from app.services.image_density import media_weights, split_weighted
from app.services.lipsync_active import persona_lipsync_active
from app.services.segment_intervals import segment_intervals_from_subtitle
from app.services.segment_panels import Panel
from app.utils import file_security, utils
from app.utils.ssrf import UnsafeUrlError

MAX_SEGMENT_MEDIA_BYTES = image_fetch.MAX_PHOTO_BYTES
MIN_PHOTO_LONG_EDGE = image_fetch.MIN_PHOTO_LONG_EDGE
MIN_PHOTO_SHORT_EDGE = image_fetch.MIN_PHOTO_SHORT_EDGE
MAX_PHOTO_PIXELS = image_fetch.MAX_PHOTO_PIXELS

_MEDIA_ID_PATTERN = re.compile(r"^[0-9a-f]{32}\.(jpg|jpeg|png|webp|mp4)$")

CHECK_CODES = ("ok", "blocked_403", "not_image", "too_small", "too_large", "timeout", "wrong_aspect", "media_expired")

_CODE_TO_REASON = {
    "blocked_403": "download blocked",
    "not_image": "not an image",
    "too_small": "too small",
    "too_large": "too large",
    "timeout": "download timed out",
}
REASON_NO_SPOKEN_TIME = "segment has no spoken time"
REASON_PANEL_FAILED = "photo panel failed to render"


def _temp_assets_dir() -> str:
    return utils.storage_dir("temp_assets", create=True)


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


def first_segment_media(segments: Sequence[Any]) -> tuple[int, int, dict] | None:
    """The first photo of the video: (segment index, image index, media dict).

    The first usable photo across segments, in order — usable means it
    carries a mediaId or a url, mirroring the web selector in
    apps/web/lib/hook-photo.ts and the segment-media path, which both
    skip ref-less items. A video clip is never the hook photo: the hook
    opens with a still. None when no segment carries a usable photo.
    Pure selection; the caller resolves the ref (mediaId or url) to a
    file. The hook opens with this photo (issue #589).
    """
    for segment_index, segment in enumerate(segments):
        for image_index, media in enumerate(
            _media_list(_segment_dict(segment).get("media"))
        ):
            if not isinstance(media, dict):
                continue
            media_id = media.get("mediaId")
            url = media.get("url")
            if not (isinstance(media_id, str) and media_id) and not (
                isinstance(url, str) and url
            ):
                continue
            if segment_video.is_video_ref(media):
                continue
            return segment_index, image_index, media
    return None


def resolve_first_segment_photo(
    task_dir: str, segments: Sequence[Any], session=None
) -> tuple[str, int, int, str | None]:
    """Download the first photo of the video: (path, segment index, image index, reason).

    reason is None on success, "no_segment_media" when no segment
    carries a usable photo (the caller fails the task with no_first_photo), or
    the per-photo failure (expired media id, blocked download,
    unusable file) — the caller fails the task naming the segment and
    image. The downloaded file is the caller's to remove once copied.
    Faces are not checked here: the lip-sync resolution that consumes
    this photo owns the face gate.
    """
    found = first_segment_media(segments)
    if found is None:
        return "", -1, -1, "no_segment_media"
    segment_index, image_index, media = found
    photo, reason = resolve_photo_ref(media, "hook-first", task_dir, session=session)
    return photo, segment_index, image_index, reason


def resolve_photo_ref(
    media: dict, token: str, task_dir: str, session=None
) -> tuple[str, Optional[str]]:
    """One still photo from a {mediaId} or {url} ref: (path, None), or ("", reason).

    A url download lands in the task directory and is the caller's to
    remove; a mediaId resolves to its temp asset in place. A video clip
    is never a photo.
    """
    if segment_video.is_video_ref(media):
        return "", "a video clip is not a photo"
    media_id = media.get("mediaId")
    url = media.get("url")
    if isinstance(media_id, str) and media_id:
        return _resolve_media_id(media_id)
    if isinstance(url, str) and url:
        return _resolve_url(url, token, task_dir, session=session)
    return "", "unusable media"


def _download_failure_code(exc: Exception) -> str:
    """Map a download failure onto a media (action: check) code, truthfully."""
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
        if str(exc) == "file does not exist":
            return "", "media expired or missing"
        return "", "invalid media id"
    return source, None


def _face_verdict(source_path: str, failure: Optional[str]) -> bool | None:
    """Face verdict for a checked file: None when the mechanical checks
    rejected it (undecodable, too small, too large) — detection never
    runs on those, and the verdict is meaningless. A wrong-ratio file
    is still decodable, so its verdict feeds the hook gate."""
    if failure is not None and failure != "wrong_aspect":
        return None
    return face_detect.image_contains_face(source_path)


def check_media_detail(
    url: Optional[str] = None,
    media_id: Optional[str] = None,
    aspect: Optional[VideoAspect] = None,
    work_dir: str = "",
) -> dict:
    """Mechanical check with dimensions: {"code", "width", "height", "has_face"}.

    Exactly one of url/media_id. No User-Agent or Referer tricks: a host
    that blocks the SSRF-safe download reports blocked_403 and the agent
    retries with media (action: upload) bytes fetched on its own machine. Never
    logs the URL. A media id that expired or never existed reports
    "media_expired": in the images modes the skip now fails the task
    (images_do_not_cover_audio names the photo); full lip sync only
    records the warning.

    has_face reports whether a detectable face is in the photo
    (True/False), or None when there is no file to check (expired
    media, failed download), the detector is unavailable, or the file
    failed the mechanical checks (undecodable, too small, too large —
    detection never runs on those). It is a reported fact, never a
    filter: this path never rejects a photo for lacking a face (issue
    #589 — the hook-photo gate that consumes it lives in the lip-sync
    resolution and the web pre-charge preflight).

    A clip (.mp4 mediaId or URL) is checked by segment_video instead:
    same {code, width, height, has_face} shape, has_face always None,
    and the code reuses the photo vocabulary (an unusable clip is
    not_image, one over the duration cap is too_large).
    """
    if media_id is not None and segment_video.is_video_media_id(media_id):
        return segment_video.check_media_id(media_id, aspect)
    if url is not None and segment_video.is_video_url(url):
        return segment_video.check_media_url(url, aspect, work_dir)
    if media_id is not None:
        source, reason = _media_id_path(media_id)
        if reason is not None:
            return {"code": "media_expired", "width": None, "height": None, "has_face": None}
        size = photo_content.probe_size(source)
        code = image_fetch.validate_photo(source, aspect)
        return {
            "code": code if code is not None else "ok",
            "width": size[0] if size is not None else None,
            "height": size[1] if size is not None else None,
            "has_face": _face_verdict(source, code),
        }
    raw_path = os.path.join(work_dir, "check-media.raw")
    try:
        image_fetch.download_image(url, raw_path)
    except Exception as exc:
        logger.warning(f"check-media image download failed: {type(exc).__name__}")
        return {"code": _download_failure_code(exc), "width": None, "height": None, "has_face": None}
    try:
        size = photo_content.probe_size(raw_path)
        failure = image_fetch.validate_photo(raw_path, aspect)
        return {
            "code": failure if failure is not None else "ok",
            "width": size[0] if size is not None else None,
            "height": size[1] if size is not None else None,
            "has_face": _face_verdict(raw_path, failure),
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
    failure = image_fetch.validate_photo(source, aspect)
    if failure is None:
        return source, None
    if failure == "wrong_aspect" and aspect is not None:
        return "", image_fetch.wrong_aspect_reason(source, aspect)
    return "", _CODE_TO_REASON.get(failure, "unusable media")


def _resolve_url(
    url: str, token: str, task_dir: str, session=None, aspect: Optional[VideoAspect] = None
) -> tuple[str, Optional[str]]:
    """Download one URL to the task directory: (path, None), or ("", reason).

    The downloaded file is the caller's to remove once the panel is drawn.
    """
    raw_path = os.path.join(task_dir, f"segment-media-{token}.raw")
    try:
        image_fetch.download_image(url, raw_path, session=session)
    except Exception as exc:
        logger.warning(f"segment image download failed: {type(exc).__name__}")
        return "", _CODE_TO_REASON.get(_download_failure_code(exc), "download failed")
    failure = image_fetch.validate_photo(raw_path, aspect)
    if failure is None:
        return raw_path, None
    if failure == "wrong_aspect" and aspect is not None:
        reason = image_fetch.wrong_aspect_reason(raw_path, aspect)
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
    if getattr(params, "video_type", None) == "full_lipsync":
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
    hook_panel: bool = True,
) -> tuple[list[Panel], list[str]]:
    """Drawn photos (panels or full frame) with spoken intervals, plus skip warnings.

    hook_panel=False keeps the hook-only lip sync face alone on screen: a
    photo that would start over the face is not drawn (the first one still
    opens the video as the lip-sync image).

    A warning carries only the segment index, the image index within that
    segment, and a stable reason, never a URL, a path or a mediaId, and
    the caller stores it on the task.
    """
    panels: list[Panel] = []
    skipped: list[str] = []
    seen_hashes: dict[str, str] = {}
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
        for image_index, (media, (slice_start, slice_end)) in enumerate(zip(items, split_weighted(start, end, media_weights(items)))):
            if not isinstance(media, dict):
                continue
            over_hook = face == segment_panels.FACE_HOOK and slice_start < hook_end
            if over_hook and not hook_panel:
                continue
            on_face = face == segment_panels.FACE_FULL or over_hook
            if segment_video.is_video_ref(media):
                panel, lines = segment_video.clip_panel(
                    media, index, image_index, slice_start, slice_end, task_dir,
                    aspect, on_face=on_face, seen=seen_hashes,
                )
                skipped.extend(lines)
                if panel is not None:
                    panels.append(panel)
                continue
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
            skip, photo_hash = photo_content.duplicate_skip(
                seen_hashes, photo, index, image_index, downloaded
            )
            if skip is not None:
                skipped.append(skip)
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
            photo_content.claim(seen_hashes, photo_hash, f"segment {index} image {image_index}")
            if built.card_reason is not None:
                skipped.append(f"segment {index} image {image_index} media overlay skipped: {built.card_reason}")
            panels.append(Panel(index=index, path=built.path, x=built.x, y=built.y,
                start=slice_start, end=slice_end, caption_bottom=built.caption_bottom,
                requested_duration=media.get("duration")))
    return panels, skipped


def prepare_segment_panels(task_id: str, params: Any, subtitle_path: str, audio_duration: float) -> list[str]:
    """Materials-stage step for tm.start: draw the panels, persist them, report warnings.

    They are overlaid when the final video is assembled (segment_panels.overlay_onto).
    With the images material, raises image_coverage.ImagesDoNotCoverAudio when any
    sent photo was skipped at render, naming the skip reasons. Full lip sync
    keeps the lenient behavior: a skipped photo is a warning there.
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
        hook_panel=getattr(params, "hook_panel", True) is not False,
    )
    hook_end = _hook_end(video_script, subtitle_path, audio_duration) if face == segment_panels.FACE_HOOK else 0.0
    sent = sum(len(_media_list(_segment_dict(s).get("media"))) for s in segments)
    panels = image_coverage.ensure_coverage(
        panels, face=face, hook_end=hook_end, audio_duration=audio_duration,
        sent=sent, skipped=warnings,
        variation_seed=getattr(params, "video_variation_seed", None),
    )
    segment_panels.write_manifest(task_id, panels, warnings)
    return warnings
