"""Material selection for video creation, with or without a face.

Three modes, chosen per post by the caller (never a site-wide default):

- "broll": stock only (pexels, pixabay, coverr). The SVG catalog is
  never queried, even when enabled, and a segment whose stock fails
  verification is dropped, never replaced by artwork.
- "svg": only the R2 SVG catalog. No stock provider is ever queried in
  this mode, so a segment can never leak a stock clip into an
  illustration-only video. If the catalog yields nothing at all, the
  caller falls back to a single neutral clip from the shared neutral
  renderer (material_verification.render_neutral_clip) instead of
  failing the task or reaching for stock.
- "images": only the images the agent sends on its segments (every
  segment carries media). No stock or catalog search runs and no search
  terms are generated. A neutral clip is the canvas under the photos,
  which cover it full frame (image_coverage); it never ships on its own.
"""

import math
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.models.schema import VideoAspect

# No runtime app imports: script_segments reads IMAGES, and schema imports
# script_segments at load time, so a schema import here would be circular.

# The only source the svg mode ever queries: the catalog search in
# svg_material, keyed "svg" in material._build_search_videos.
SVG_SOURCE_ORDER = ["svg"]

# The agent-images-only material value, shared by validation and the pipeline.
IMAGES = "images"


def svg_source_order() -> list:
    """Source order for svg mode: catalog only, never stock."""
    return list(SVG_SOURCE_ORDER)


def images_canvas(task_dir: str, audio_duration: float, aspect: "VideoAspect") -> list[str]:
    """The canvas for images mode: one neutral clip, or [] when it cannot render."""
    from app.services import neutral_background

    neutral = neutral_background.render_neutral_clip(task_dir, math.ceil(audio_duration), aspect)
    return [neutral] if neutral else []
