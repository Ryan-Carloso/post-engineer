"""Photos of the places a script names, taken from web image search.

Opt-in (``[search] place_photos = true``) and valid for every video type:
drawings, stock footage, with or without the persona's face. For each named
place (place_names) one Tavily search returns images with descriptions; an
image is used only when its title or description names the place. The
download goes through the SSRF-guarded fetcher (public addresses only, size
cap, image content types), the photo is composed onto a portrait canvas
(sharp photo over its own blurred copy, nothing cropped away), photos with
faces are skipped, and the finished photo clip replaces the clip of the final
material list nearest to the spoken name (``splice_photos``).

Every failure leaves the original clip where it was: a photo never fails a
video. The photos are third-party content: the operator takes the rights
risk by switching the feature on.
"""

import contextlib
import os
import re
import subprocess
from collections.abc import Sequence
from typing import Optional
from urllib.parse import urlparse

from loguru import logger
from PIL import Image, ImageFilter, ImageOps

from app.models.schema import VideoAspect, VideoParams
from app.services import (
    audio_trim,
    face_detect,
    image_material,
    place_names,
    script_claims,
    subtitle,
    web_search_facts,
)
from app.services.analytics import scrub_error_text, track_event
from app.services.place_names import PHOTO_FILE_PREFIX, PreparedPhoto
from app.utils import ssrf, utils

MAX_PHOTO_BYTES = 8 * 1024 * 1024
# Header-declared size above which a photo is refused before it is decoded.
MAX_PHOTO_PIXELS = 50_000_000
# Smaller than this is a thumbnail: blown up to a portrait frame it is mush.
MIN_PHOTO_LONG_EDGE = 600
MIN_PHOTO_SHORT_EDGE = 300
DOWNLOAD_TIMEOUT_SECONDS = 10
BLUR_RADIUS = 40

_WORD = re.compile(r"[^\W_]+")


def search_images(name: str, subject: str, client: web_search_facts._HttpPostClient | None = None) -> list[dict[str, str]]:
    """Image hits for a place: [{url, title, description}], possibly empty.

    Raises on HTTP or parsing failures: the caller skips that one photo.
    """
    key = os.getenv(web_search_facts.PROVIDER_ENV_KEYS["tavily"], "").strip()
    payload: dict[str, object] = {
        "query": f"{name} {subject}"[:200],
        "search_depth": "basic",
        "max_results": 3,
        "include_answer": False,
        "include_images": True,
        "include_image_descriptions": True,
    }
    owns_client = client is None
    if owns_client:
        client = web_search_facts._build_client()
    try:
        response = client.post(
            web_search_facts.TAVILY_SEARCH_URL,
            json=payload,
            headers={"Authorization": f"Bearer {key}"},
        )
        response.raise_for_status()
        body = response.json()
    finally:
        if owns_client and client is not None:
            client.close()
    images = body.get("images") if isinstance(body, dict) else None
    hits: list[dict[str, str]] = []
    for item in images or []:
        if isinstance(item, str):
            item = {"url": item}
        if not isinstance(item, dict) or not isinstance(item.get("url"), str) or not item["url"]:
            continue
        hits.append(
            {
                "url": item["url"],
                "title": str(item.get("title") or ""),
                "description": str(item.get("description") or ""),
            }
        )
    return hits


def pick_image_url(hits: list[dict[str, str]], name: str) -> Optional[str]:
    """First http(s) image whose title or description names every part of `name`."""
    parts = script_claims.name_parts(name)
    if not parts:
        return None
    for hit in hits:
        url = hit.get("url", "")
        if not url.startswith(("http://", "https://")):
            continue
        text = script_claims.fold_text(f"{hit.get('title', '')} {hit.get('description', '')}")
        words = set(_WORD.findall(text))
        if all(part in words for part in parts):
            return url
    return None


def download_image(url: str, dest_path: str, session=None) -> str:
    """Download through the SSRF-guarded fetcher; raises UnsafeUrlError on any rejection."""
    return ssrf.download_public_file(
        url,
        dest_path,
        what="place photo",
        max_bytes=MAX_PHOTO_BYTES,
        allowed_content_types=("image/",),
        timeout=DOWNLOAD_TIMEOUT_SECONDS,
        session=session,
    )


def compose_portrait_still(source_path: str, dest_path: str, aspect: VideoAspect) -> str:
    """The photo fitted onto a full portrait canvas over a blurred copy of itself.

    Returns `dest_path`, or "" for a thumbnail, a decompression bomb or a
    file that is not an image. Nothing is cropped away, and the canvas is
    always full resolution, so combine_videos' letterbox limit never drops
    a landscape photo.
    """
    try:
        with Image.open(source_path) as opened:
            width, height = opened.size
            if (
                width * height > MAX_PHOTO_PIXELS
                or max(width, height) < MIN_PHOTO_LONG_EDGE
                or min(width, height) < MIN_PHOTO_SHORT_EDGE
            ):
                logger.info(f"place photo rejected: {width}x{height} is out of bounds")
                return ""
            photo = ImageOps.exif_transpose(opened).convert("RGB")
        canvas_width, canvas_height = aspect.to_resolution()
        canvas = ImageOps.fit(photo, (canvas_width, canvas_height), Image.Resampling.LANCZOS)
        canvas = canvas.filter(ImageFilter.GaussianBlur(BLUR_RADIUS))
        front = ImageOps.contain(photo, (canvas_width, canvas_height), Image.Resampling.LANCZOS)
        canvas.paste(front, ((canvas_width - front.width) // 2, (canvas_height - front.height) // 2))
        canvas.save(dest_path, "JPEG", quality=90)
    except (OSError, ValueError, Image.DecompressionBombError) as exc:
        logger.warning(f"place photo unusable: {type(exc).__name__}")
        return ""
    return dest_path


def _prepare_one(
    name: str,
    seconds: float,
    index: int,
    task_dir: str,
    subject: str,
    aspect: VideoAspect,
    client,
    session,
) -> Optional[PreparedPhoto]:
    raw_path = os.path.join(task_dir, f"{PHOTO_FILE_PREFIX}{index}.raw")
    try:
        url = pick_image_url(search_images(name, subject, client), name)
        if url is None:
            return None
        download_image(url, raw_path, session=session)
        still = compose_portrait_still(raw_path, os.path.join(task_dir, f"{PHOTO_FILE_PREFIX}{index}.jpg"), aspect)
        if not still or face_detect.image_contains_face(still):
            return None
    except Exception as exc:  # noqa: BLE001 - one photo never costs the video
        logger.warning(f"place photo skipped: {type(exc).__name__}")
        return None
    finally:
        with contextlib.suppress(OSError):
            os.remove(raw_path)
    return PreparedPhoto(name=name, still_path=still, seconds=seconds, source_host=urlparse(url).netloc)


def prepare_photos(
    task_id: str,
    params: VideoParams,
    video_script: str,
    subtitle_path: str,
    audio_duration: float,
    *,
    window: Optional[tuple[float, float]] = None,
    client=None,
    session=None,
) -> list[PreparedPhoto]:
    """Photos for the places the script names; [] when off or when nothing works.

    `window` is the (earliest, latest) mention time, in seconds, that may get
    a photo: a persona video keeps its lip-sync intro and face outro on screen,
    so only mentions between them qualify (the edges are inclusive).

    Never raises. Logs and tracks counts only: names and URLs derive from
    third-party pages and user topics.
    """
    if not web_search_facts.place_photos_enabled():
        return []
    wanted: list[tuple[str, float]] = []
    photos: list[PreparedPhoto] = []
    try:
        words = subtitle.file_to_words(subtitle_path)
        for name in place_names.candidate_names(video_script, params.video_subject):
            seconds = place_names.mention_seconds(name, video_script, words, audio_duration)
            if seconds is None or (window is not None and not window[0] <= seconds <= window[1]):
                continue
            wanted.append((name, seconds))
        task_dir = utils.task_dir(task_id)
        aspect = VideoAspect(params.video_aspect)
        for index, (name, seconds) in enumerate(wanted):
            photo = _prepare_one(
                name, seconds, index, task_dir, params.video_subject, aspect, client, session
            )
            if photo is not None:
                photos.append(photo)
    except Exception as exc:  # noqa: BLE001 - photos are an extra, never a failure
        logger.warning(f"place photos skipped: {scrub_error_text(str(exc))}")
        photos = []
    if wanted:
        logger.info(f"place photos: {len(photos)} of {len(wanted)} named place(s) got a photo")
        track_event("place_photos", {"names": len(wanted), "photos": len(photos)})
    return photos


def _probed_seconds(clip: str, clip_seconds: float) -> float:
    """What a clip contributes to the timeline: its length, at most `clip_seconds`.

    combine_videos takes the first max_clip_duration seconds of each file. A
    clip that cannot be probed counts as a full clip.
    """
    try:
        return min(audio_trim.media_duration(clip), clip_seconds)
    except (OSError, ValueError, RuntimeError, subprocess.CalledProcessError, subprocess.TimeoutExpired):
        return clip_seconds


def splice_photos(clips: list[str], photos: Sequence[PreparedPhoto], clip_seconds: float) -> list[str]:
    """`clips` with each photo's clip replacing the clip nearest to its mention.

    `clips` is the final, ordered material list handed to combine_videos and
    `clip_seconds` the length combine_videos keeps of each. A photo whose clip
    fails to render leaves the original clip in place; the input is untouched.
    """
    if not photos or not clips or clip_seconds <= 0:
        return list(clips)
    durations = [_probed_seconds(clip, clip_seconds) for clip in clips]
    slots = place_names.assign_slots([photo.seconds for photo in photos], durations)
    photo_seconds = max(1, round(clip_seconds))
    result = list(clips)
    for photo, slot in sorted(zip(photos, slots), key=lambda pair: pair[0].seconds):
        if slot is None:
            continue
        rendered = image_material.render_image_file_to_mp4(photo.still_path, clip_duration=photo_seconds)
        if rendered:
            result[slot] = rendered
        else:
            logger.warning("place photo clip failed to render; keeping the original clip")
    return result
