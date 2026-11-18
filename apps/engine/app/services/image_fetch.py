"""Fetch, validate and compose agent-supplied segment photos.

Downloading a photo through the SSRF-guarded fetcher, checking it
mechanically (validate_photo), and composing it onto a full portrait
canvas are load-bearing — user_media.py downloads segment media through
here, and segment_panels.py renders the images-mode full-frame stills
through here. Nothing in this module searches the web.
"""

from typing import Optional

from loguru import logger
from PIL import Image, ImageFilter, ImageOps

from app.models.schema import VideoAspect
from app.services import media_aspect, photo_content
from app.utils import ssrf

MAX_PHOTO_BYTES = 8 * 1024 * 1024
# Header-declared size above which a photo is refused before it is decoded.
MAX_PHOTO_PIXELS = 50_000_000
# Smaller than this is a thumbnail: blown up to a portrait frame it is mush.
MIN_PHOTO_LONG_EDGE = 600
MIN_PHOTO_SHORT_EDGE = 300
DOWNLOAD_TIMEOUT_SECONDS = 10
BLUR_RADIUS = 40


def validate_photo(source_path: str, aspect: Optional[VideoAspect] = None) -> Optional[str]:
    """Mechanical check of one image file: None when usable, else a failure code.

    The code is one of not_image / too_small / too_large / wrong_aspect.
    Size is checked on the decoded pixels, so a thumbnail is too_small
    rather than an opaque render failure. The aspect is only checked when
    one was given: a photo that cannot fill the frame is wrong_aspect, so
    it never ships as a blurred strip. Faces are not checked: these are
    the agent's own photos, and they may show people.
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
    return None


def wrong_aspect_reason(source_path: str, aspect: VideoAspect) -> str:
    """The skip reason for a wrong-ratio photo, naming both sides."""
    size = photo_content.probe_size(source_path)
    if size is None:
        return "wrong aspect ratio"
    detail = media_aspect.mismatch_detail(size[0], size[1], aspect)
    return f"wrong aspect ratio ({detail})" if detail is not None else "wrong aspect ratio"


def download_image(url: str, dest_path: str, session=None) -> str:
    """Download through the SSRF-guarded fetcher; raises UnsafeUrlError on any rejection."""
    return ssrf.download_public_file(
        url,
        dest_path,
        what="segment photo",
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
                logger.info(f"segment photo rejected: {width}x{height} is out of bounds")
                return ""
            photo = ImageOps.exif_transpose(opened).convert("RGB")
        canvas_width, canvas_height = aspect.to_resolution()
        canvas = ImageOps.fit(photo, (canvas_width, canvas_height), Image.Resampling.LANCZOS)
        canvas = canvas.filter(ImageFilter.GaussianBlur(BLUR_RADIUS))
        front = ImageOps.contain(photo, (canvas_width, canvas_height), Image.Resampling.LANCZOS)
        canvas.paste(front, ((canvas_width - front.width) // 2, (canvas_height - front.height) // 2))
        canvas.save(dest_path, "JPEG", quality=90)
    except (OSError, ValueError, Image.DecompressionBombError) as exc:
        logger.warning(f"segment photo unusable: {type(exc).__name__}")
        return ""
    return dest_path
