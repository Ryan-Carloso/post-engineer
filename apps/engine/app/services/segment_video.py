"""Video clips (mp4) as segment media: b-roll that moves.

A clip is detected by its .mp4 reference (mediaId or URL path), never by
a new field: the segment contract is unchanged, and photos behave
exactly as before. A usable clip is h264, 1-30s, at least 600x300,
within 50M pixels, and portrait-matched when it plays full-frame — the
same bounds as the photo path, plus a duration cap and a codec gate.

A clip always plays full-frame, so it can never cover the persona's
face: on a full lip-sync video, and inside the hook window of a
hook-only video, it is skipped with a clear reason. Its audio track,
when present, is dropped at render: the spoken script is the audio.

A clip loops to fill its take (at most MAX_CLIP_LOOPS plays, the
coverage cap); a longer clip is trimmed. The check endpoint reuses the
photo codes (not_image for an unusable clip, too_large for one over the
duration cap) so the web/MCP contract keeps passing — the render skip
reasons carry the precise wording. Nothing here logs a URL or a path.
"""

import contextlib
import json
import os
import re
import shutil
import subprocess
from typing import Any, Optional
from urllib.parse import urlsplit

import requests
from loguru import logger

from app.models.schema import VideoAspect
from app.services import media_aspect, photo_content
from app.services.image_fetch import (
    MAX_PHOTO_PIXELS,
    MIN_PHOTO_LONG_EDGE,
    MIN_PHOTO_SHORT_EDGE,
)
from app.services.segment_panels import Panel
from app.utils import file_security, ssrf, utils
from app.utils.ssrf import UnsafeUrlError

MAX_CLIP_BYTES = 50 * 1024 * 1024
MAX_CLIP_DURATION_SECONDS = 30.0
MIN_CLIP_DURATION_SECONDS = 1.0
MAX_CLIP_LOOPS = 3
CLIP_DENSITY_ITEMS = 4
VIDEO_CODEC = "h264"
VIDEO_SUFFIX = ".mp4"
DOWNLOAD_TIMEOUT_SECONDS = 10

REASON_NOT_A_CLIP = "not a video clip"
REASON_CLIP_OVER_FACE = "video clip cannot cover the persona's face"
REASON_DUPLICATE_CLIP = "duplicate video clip"
REASON_OVERLAY_ON_CLIP = "overlays are not supported on video clips"
REASON_CLIP_FAILED = "video clip failed to render"

_CHECK_CODE = {"not_video": "not_image", "video_too_long": "too_large"}

_VIDEO_MEDIA_ID_PATTERN = re.compile(r"^[0-9a-f]{32}\.mp4$")


def _temp_assets_dir() -> str:
    return utils.storage_dir("temp_assets", create=True)


def is_video_ref(media: Any) -> bool:
    """True when a segment media item references a clip, by its suffix.

    The mediaId wins when present; otherwise the URL path decides. A
    suffix is admission only: ffprobe is the content gate.
    """
    if not isinstance(media, dict):
        return False
    media_id = media.get("mediaId")
    if isinstance(media_id, str) and media_id:
        return media_id.lower().endswith(VIDEO_SUFFIX)
    url = media.get("url")
    if isinstance(url, str) and url:
        try:
            return urlsplit(url).path.lower().endswith(VIDEO_SUFFIX)
        except ValueError:
            return False
    return False


def is_video_media_id(media_id: Optional[str]) -> bool:
    """True when a temp-asset id names a clip file."""
    return isinstance(media_id, str) and media_id.lower().endswith(VIDEO_SUFFIX)


def is_video_url(url: Optional[str]) -> bool:
    """True when a URL path names a clip file."""
    return is_video_ref({"url": url})


def clip_density_min_count(media: Any, counted: int) -> int:
    """The density minimum a segment's media counts as.

    A clip covers ~12s of speech, not one 3s photo slot, so each clip
    stands in for CLIP_DENSITY_ITEMS photos in the minimum. The maximum
    still counts items one for one.
    """
    clips = sum(1 for item in media if is_video_ref(item))
    return counted + (CLIP_DENSITY_ITEMS - 1) * clips


def probe_video(source_path: str) -> Optional[dict]:
    """ffprobe on one clip file: {width, height, duration, codec_name}.

    None when the file is missing, undecodable, or has no video stream.
    The path never reaches a log line.
    """
    try:
        completed = subprocess.run(
            [
                "ffprobe", "-v", "error", "-select_streams", "v:0",
                "-show_entries", "stream=width,height,codec_name",
                "-show_entries", "format=duration", "-of", "json", source_path,
            ],
            capture_output=True, text=True, timeout=DOWNLOAD_TIMEOUT_SECONDS,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        logger.warning(f"segment video probe failed: {type(exc).__name__}")
        return None
    if completed.returncode != 0:
        return None
    try:
        data = json.loads(completed.stdout)
    except ValueError:
        return None
    streams = data.get("streams") or []
    if not streams:
        return None
    stream = streams[0]
    try:
        width = int(stream["width"])
        height = int(stream["height"])
        duration = float((data.get("format") or {}).get("duration"))
    except (KeyError, TypeError, ValueError):
        return None
    codec = stream.get("codec_name")
    if width <= 0 or height <= 0 or duration <= 0 or not codec:
        return None
    return {"width": width, "height": height, "duration": duration, "codec_name": codec}


def validate_probe(
    probe: dict, size_bytes: int, aspect: Optional[VideoAspect] = None
) -> Optional[str]:
    """Failure code for a probed clip: None when usable, else one of
    not_video / too_small / too_large / wrong_aspect / video_too_long."""
    if probe["codec_name"] != VIDEO_CODEC:
        return "not_video"
    if probe["duration"] < MIN_CLIP_DURATION_SECONDS:
        return "not_video"
    if probe["duration"] > MAX_CLIP_DURATION_SECONDS:
        return "video_too_long"
    if size_bytes > MAX_CLIP_BYTES:
        return "too_large"
    if probe["width"] * probe["height"] > MAX_PHOTO_PIXELS:
        return "too_large"
    if (
        max(probe["width"], probe["height"]) < MIN_PHOTO_LONG_EDGE
        or min(probe["width"], probe["height"]) < MIN_PHOTO_SHORT_EDGE
    ):
        return "too_small"
    if aspect is not None and media_aspect.mismatch_detail(
        probe["width"], probe["height"], aspect
    ) is not None:
        return "wrong_aspect"
    return None


def validate_video(source_path: str, aspect: Optional[VideoAspect] = None) -> Optional[str]:
    """Mechanical check of one clip file: None when usable, else a failure code."""
    probe = probe_video(source_path)
    if probe is None:
        return "not_video"
    try:
        size = os.path.getsize(source_path)
    except OSError:
        return "not_video"
    return validate_probe(probe, size, aspect)


def failure_reason(
    code: str, probe: Optional[dict], aspect: Optional[VideoAspect] = None
) -> str:
    """The skip reason for a failure code, naming the numbers that matter."""
    if code == "wrong_aspect" and probe is not None and aspect is not None:
        detail = media_aspect.mismatch_detail(probe["width"], probe["height"], aspect)
        return f"wrong aspect ratio ({detail})" if detail is not None else "wrong aspect ratio"
    if code == "video_too_long" and probe is not None:
        return (
            f"video clip is too long ({probe['duration']:.1f}s; "
            f"max {MAX_CLIP_DURATION_SECONDS:.0f}s)"
        )
    return {
        "not_video": REASON_NOT_A_CLIP,
        "too_small": "too small",
        "too_large": "too large",
    }.get(code, "unusable media")


def download_video(url: str, dest_path: str, session=None) -> str:
    """Download through the SSRF-guarded fetcher; raises UnsafeUrlError on any rejection.

    The content-type prefix is permissive on purpose: the probe below is
    the codec gate, so a clip served as video/quicktime still gets its
    honest verdict instead of a download refusal.
    """
    return ssrf.download_public_file(
        url,
        dest_path,
        what="segment video clip",
        max_bytes=MAX_CLIP_BYTES,
        allowed_content_types=("video/",),
        timeout=DOWNLOAD_TIMEOUT_SECONDS,
        session=session,
    )


def _download_failure_code(exc: Exception) -> str:
    """Map a download failure onto a media (action: check) code, truthfully.

    Mirrors user_media._download_failure_code: the check endpoint reuses
    the photo codes, so the mapping is the same.
    """
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


def _download_failure_reason(exc: Exception) -> str:
    """The skip reason for a download failure: the same buckets, in words."""
    if isinstance(exc, (requests.exceptions.Timeout, TimeoutError)):
        return "download timed out"
    if isinstance(exc, UnsafeUrlError):
        message = str(exc)
        if "HTTP 403" in message:
            return "download blocked"
        if "exceeds the download limit" in message:
            return "too large"
        if "unexpected content-type" in message:
            return REASON_NOT_A_CLIP
        return "download blocked"
    if isinstance(exc, requests.exceptions.RequestException):
        return "download blocked"
    return "download blocked"


def check_media_file(source_path: str, aspect: Optional[VideoAspect] = None) -> dict:
    """The check-endpoint view of one clip file: {code, width, height, has_face}.

    has_face is always None: face detection never runs on a clip. The
    code reuses the photo vocabulary (see _CHECK_CODE).
    """
    probe = probe_video(source_path)
    if probe is None:
        return {"code": "not_image", "width": None, "height": None, "has_face": None}
    try:
        size = os.path.getsize(source_path)
    except OSError:
        return {"code": "not_image", "width": None, "height": None, "has_face": None}
    code = validate_probe(probe, size, aspect)
    check_code = "ok" if code is None else _CHECK_CODE.get(code, code)
    return {
        "code": check_code,
        "width": probe["width"],
        "height": probe["height"],
        "has_face": None,
    }


def check_media_id(media_id: str, aspect: Optional[VideoAspect] = None) -> dict:
    """The check-endpoint view of one clip temp asset.

    A malformed id or one the 1 hour TTL already purged is media_expired,
    like a missing photo.
    """
    expired = {"code": "media_expired", "width": None, "height": None, "has_face": None}
    if not _VIDEO_MEDIA_ID_PATTERN.match(media_id or ""):
        return expired
    try:
        source = file_security.resolve_path_within_directory(
            _temp_assets_dir(), os.path.join(_temp_assets_dir(), media_id)
        )
    except ValueError:
        return expired
    return check_media_file(source, aspect)


def check_media_url(url: str, aspect: Optional[VideoAspect] = None, work_dir: str = "") -> dict:
    """The check-endpoint view of one clip URL: download, probe, report."""
    raw_path = os.path.join(work_dir, "check-media-clip.raw")
    try:
        download_video(url, raw_path)
    except Exception as exc:  # noqa: BLE001
        return {"code": _download_failure_code(exc), "width": None, "height": None, "has_face": None}
    try:
        return check_media_file(raw_path, aspect)
    finally:
        with contextlib.suppress(OSError):
            os.remove(raw_path)


def _resolve_media_id(media_id: str) -> tuple[str, Optional[str]]:
    """A clip temp asset by its UUID filename: (path, None), or ("", reason)."""
    if not _VIDEO_MEDIA_ID_PATTERN.match(media_id or ""):
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


def _drop(path: str) -> None:
    if path:
        with contextlib.suppress(OSError):
            os.remove(path)


def clip_panel(
    media: Any,
    index: int,
    image_index: int,
    slice_start: float,
    slice_end: float,
    task_dir: str,
    aspect: VideoAspect,
    *,
    on_face: bool,
    seen: dict,
) -> tuple[Optional[Panel], list[str]]:
    """(Panel, lines) for one clip item: the panel when the clip plays.

    lines carries the skip line when the clip cannot play, plus the
    overlay warning when an overlay was asked (a clip never carries a
    card). The clip is copied into the task dir, never referenced in
    place: the temp asset's 1 hour TTL must not outlive the manifest.
    """
    label = f"segment {index} image {image_index}"
    if on_face:
        return None, [f"{label} media skipped: {REASON_CLIP_OVER_FACE}"]
    media_id = media.get("mediaId") if isinstance(media, dict) else None
    url = media.get("url") if isinstance(media, dict) else None
    downloaded = ""
    if isinstance(media_id, str) and media_id:
        source, reason = _resolve_media_id(media_id)
        if reason is not None:
            return None, [f"{label} media skipped: {reason}"]
    elif isinstance(url, str) and url:
        source = os.path.join(task_dir, f"segment-media-{index}-{image_index}.raw")
        try:
            download_video(url, source)
        except Exception as exc:  # noqa: BLE001
            return None, [f"{label} media skipped: {_download_failure_reason(exc)}"]
        downloaded = source
    else:
        return None, []
    probe = probe_video(source)
    if probe is None:
        _drop(downloaded)
        return None, [f"{label} media skipped: {REASON_NOT_A_CLIP}"]
    try:
        size = os.path.getsize(source)
    except OSError:
        _drop(downloaded)
        return None, [f"{label} media skipped: {REASON_NOT_A_CLIP}"]
    failure = validate_probe(probe, size, aspect)
    if failure is not None:
        _drop(downloaded)
        return None, [f"{label} media skipped: {failure_reason(failure, probe, aspect)}"]
    skip, clip_hash = photo_content.duplicate_skip(
        seen, source, index, image_index, downloaded, reason=REASON_DUPLICATE_CLIP
    )
    if skip is not None:
        return None, [skip]
    clip_path = os.path.join(task_dir, f"segment-clip-{index}-{image_index}.mp4")
    try:
        if downloaded:
            os.replace(downloaded, clip_path)
        else:
            shutil.copyfile(source, clip_path)
    except OSError:
        _drop(downloaded)
        _drop(clip_path)
        return None, [f"{label} media skipped: {REASON_CLIP_FAILED}"]
    photo_content.claim(seen, clip_hash, label)
    lines: list[str] = []
    overlay = media.get("overlay") if isinstance(media, dict) else None
    if isinstance(overlay, dict):
        lines.append(f"{label} media overlay skipped: {REASON_OVERLAY_ON_CLIP}")
    frame_width, frame_height = aspect.to_resolution()
    return (
        Panel(
            index=index, path=clip_path, x=0, y=0,
            start=slice_start, end=slice_end,
            clip_seconds=probe["duration"],
            frame_width=frame_width, frame_height=frame_height,
        ),
        lines,
    )
