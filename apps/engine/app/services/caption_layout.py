"""Where a subtitle cue sits on the frame: a panel photo (segment_panels) is
an inset, so any cue on screen while one is on screen is bottom-anchored above
its top edge. Cue and panel intervals come from different sources, so any
overlap counts and the tightest band wins.
"""

from typing import Optional, Sequence

# Keep at least this many pixels between the caption block and the frame edge.
MIN_MARGIN = 10

# (first second, last second, lowest pixel the caption block may reach).
CaptionBand = tuple[float, float, int]


def cue_bottom(bands: Sequence[CaptionBand], times: tuple[float, float]) -> Optional[int]:
    """The lowest pixel a caption shown for `times` (start, end) may reach, if any."""
    start, end = times
    return min((band[2] for band in bands if band[0] < end and band[1] > start), default=None)


def caption_y(
    position: Optional[str],
    custom_position: float,
    video_height: int,
    clip_height: int,
    max_bottom: Optional[int] = None,
) -> float | str:
    """Top y of the caption block, or "center" for the centered placement.

    `max_bottom` is the ceiling a segment panel imposes, so the photo stays clear.
    """
    if position == "top":
        return video_height * 0.05
    if max_bottom is not None:
        return max(MIN_MARGIN, max_bottom - clip_height)
    if position == "bottom":
        return video_height * 0.95 - clip_height
    if position == "custom":
        # Keep the subtitle fully within the screen bounds.
        max_y = video_height - clip_height - MIN_MARGIN
        custom_y = (video_height - clip_height) * (custom_position / 100)
        return max(MIN_MARGIN, min(custom_y, max_y))
    return "center"
