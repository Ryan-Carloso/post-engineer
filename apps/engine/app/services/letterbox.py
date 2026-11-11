"""Letterbox ceiling for fitting source clips to the target canvas.

A clip whose horizontal (top/bottom) bars exceed this share of the frame
is dropped as unusable instead of being letterboxed into a sliver. The
constant is mode-agnostic and video.py's _fit_clip_to_canvas still
enforces it for every clip, including the images-mode neutral canvas.
"""

from app.models.schema import VideoAspect

MAX_LETTERBOX_BARS = 0.35


def ratio_matches(width: int, height: int, aspect: VideoAspect) -> bool:
    """True when letterboxing stays within the bar ceiling.

    Side bars (a photo narrower than the canvas) and missing/zero
    dimensions reject immediately; a wider photo is accepted only while
    the horizontal bars stay within MAX_LETTERBOX_BARS. Shared by the
    engine's aspect gate (media_aspect) and video.py's fit check.

    Callers pass probed dimensions, never None: _probe_size returns
    None only when the image cannot be opened, and _validate_photo
    calls mismatch_detail only after a successful open.
    """
    if width <= 0 or height <= 0:
        return False
    file_ratio = width / height
    target_w, target_h = aspect.to_resolution()
    target_ratio = target_w / target_h
    if file_ratio < target_ratio:
        return False
    return 1 - target_ratio / file_ratio <= MAX_LETTERBOX_BARS
