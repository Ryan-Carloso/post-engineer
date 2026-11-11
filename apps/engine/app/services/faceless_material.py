"""Material selection for video creation, with or without a face.

One mode, chosen per post by the caller (never a site-wide default):

- "images": only the images the agent sends on its segments (every
  segment carries media, unless the video is a full lip-sync talking
  head — see script_segments). No catalog search runs and no keyword
  extraction happens. A neutral clip is the canvas under the
  photos, which cover it full frame (image_coverage); it never ships on
  its own.
"""

import math
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.models.schema import VideoAspect

# No runtime app imports: script_segments reads IMAGES, and schema imports
# script_segments at load time, so a schema import here would be circular.

# The agent-images-only material value, shared by validation and the pipeline.
IMAGES = "images"


def images_canvas(task_dir: str, audio_duration: float, aspect: "VideoAspect") -> list[str]:
    """The canvas for images mode: one neutral clip, or [] when it cannot render."""
    from app.services import neutral_background

    neutral = neutral_background.render_neutral_clip(task_dir, math.ceil(audio_duration), aspect)
    return [neutral] if neutral else []
