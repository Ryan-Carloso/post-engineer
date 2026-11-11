"""Fetch and compose agent-supplied segment photos.

Downloading a photo through the SSRF-guarded fetcher and composing it
onto a full portrait canvas are load-bearing — user_media.py downloads
segment media through here, and segment_panels.py renders the
images-mode full-frame stills through here. Nothing in this module
searches the web.
"""

from loguru import logger
from PIL import Image, ImageFilter, ImageOps

from app.models.schema import VideoAspect
from app.utils import ssrf

MAX_PHOTO_BYTES = 8 * 1024 * 1024
# Header-declared size above which a photo is refused before it is decoded.
MAX_PHOTO_PIXELS = 50_000_000
# Smaller than this is a thumbnail: blown up to a portrait frame it is mush.
MIN_PHOTO_LONG_EDGE = 600
MIN_PHOTO_SHORT_EDGE = 300
DOWNLOAD_TIMEOUT_SECONDS = 10
BLUR_RADIUS = 40


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
