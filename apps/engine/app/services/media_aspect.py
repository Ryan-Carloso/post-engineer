"""Aspect-ratio gate for agent-supplied images.

One rule, shared by every entry point that shows an agent image
full-frame: the letterbox rule in letterbox.py. A photo narrower than
the canvas (pillarbox) is always rejected; a wider photo is accepted
only while the horizontal bars stay within MAX_LETTERBOX_BARS. The
check is mechanical: no cropping, no judgement, and the mismatch names
both sides so the agent can send the right image.
"""

from __future__ import annotations

import math
from typing import Optional, Union

from app.models.schema import VideoAspect
from app.services.image_material import MIN_MATERIAL_EDGE
from app.services.letterbox import ratio_matches


# Mirrored in the web preflight (aspect-preflight.ts: ratioLabel and
# aspectResolution): the web cannot import engine code, so the gcd and
# the aspect -> resolution mapping live in both places. The preflight
# tests pin the mapping through the 400 error strings; change both sides
# together.
def ratio_label(width: int, height: int) -> str:
    """Simplified ratio of a WxH image, e.g. 1920x1080 -> "16:9"."""
    divisor = math.gcd(width, height)
    return f"{width // divisor}:{height // divisor}"


def mismatch_detail(width: int, height: int, aspect: VideoAspect) -> Optional[str]:
    """None when the image fits the aspect, else "WxH (ratio); expected A (TxH)"."""
    if ratio_matches(width, height, aspect):
        return None
    target_w, target_h = aspect.to_resolution()
    return (
        f"{width}x{height} ({ratio_label(width, height)}); "
        f"expected {aspect.value} ({target_w}x{target_h})"
    )


def coerce_aspect(value: Union[str, VideoAspect, None]) -> Optional[VideoAspect]:
    """The aspect as a VideoAspect, or None when no aspect was given."""
    if value is None or isinstance(value, VideoAspect):
        return value
    try:
        return VideoAspect(value)
    except ValueError:
        raise ValueError(f"unsupported video aspect: {value}") from None


def rejection_reason(
    width: int,
    height: int,
    aspect: Union[str, VideoAspect, None] = None,
    min_edge: int = MIN_MATERIAL_EDGE,
) -> Optional[str]:
    """None when the image is usable, else the reason to skip it.

    The size floor is checked first: a thumbnail is too small whatever
    its shape. The aspect is only checked when one was given, so callers
    without an aspect keep the old size-only behaviour.
    """
    if width < min_edge or height < min_edge:
        return f"low resolution material: {width}x{height}, minimum {min_edge}x{min_edge} required"
    target = coerce_aspect(aspect)
    if target is None:
        return None
    detail = mismatch_detail(width, height, target)
    return f"wrong aspect ratio: {detail}" if detail is not None else None
