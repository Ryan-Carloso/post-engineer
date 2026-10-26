"""Faceless material selection for video creation.

Two modes, chosen per post by the caller (never a site-wide default):

- "broll": the previous stock cascade (pexels, pixabay, coverr).
- "svg": only the R2 SVG catalog. No stock provider is ever queried in
  this mode, so a segment can never leak a stock clip into an
  illustration-only video. If the catalog yields nothing at all, the
  caller falls back to a single neutral clip (below) instead of failing
  the task or reaching for stock.

The neutral clip is a plain vertical gradient still rendered to mp4 by
the same image-to-clip path the SVG catalog uses. It carries no skyline,
dish, text, or identifiable place.
"""

import os

from loguru import logger
from PIL import Image, ImageDraw

from app.models.schema import VideoAspect
from app.utils import utils

# The only source the svg mode ever queries: the catalog search in
# svg_material, keyed "svg" in material._build_search_videos.
SVG_SOURCE_ORDER = ["svg"]

# Neutral gradient endpoints: a dark, unbranded backdrop.
_NEUTRAL_TOP = (38, 42, 54)
_NEUTRAL_BOTTOM = (18, 20, 28)


def svg_source_order() -> list:
    """Source order for svg mode: catalog only, never stock."""
    return list(SVG_SOURCE_ORDER)


def neutral_clip_path(task_id: str, duration: float, video_aspect: VideoAspect) -> str:
    """Build one neutral mp4 clip for the task, or "" on any failure.

    The clip lasts the full audio duration so a catalog-empty video still
    has a timeline; the caller only uses it when the catalog returned
    nothing at all. A failure here is a task failure upstream, never a
    silent substitution: this function returns "" and logs, it never
    returns a stock path.
    """
    from app.services import image_material

    width, height = video_aspect.to_resolution()
    task_directory = utils.task_dir(task_id)
    png_path = os.path.join(task_directory, "neutral.png")
    try:
        image = Image.new("RGB", (width, height), _NEUTRAL_TOP)
        draw = ImageDraw.Draw(image)
        for y in range(height):
            blend = y / max(height - 1, 1)
            color = tuple(
                int(top + (bottom - top) * blend)
                for top, bottom in zip(_NEUTRAL_TOP, _NEUTRAL_BOTTOM)
            )
            draw.line([(0, y), (width, y)], fill=color)
        image.save(png_path)
    except Exception as exc:
        logger.warning(f"neutral clip still failed to render: {exc}")
        return ""
    clip = image_material.render_image_file_to_mp4(
        png_path, clip_duration=max(1, int(duration))
    )
    if not clip:
        logger.warning("neutral clip render returned no clip")
    return clip or ""
