"""Where a subtitle cue sits on the frame.

A segment photo shown as a panel (segment_panels) is an inset: the subtitles
must stay above it, never on the photo, or they cover the very thing the
photo is there to show. A cue spoken while a panel is on screen is therefore
bottom-anchored just above the panel's top edge, whatever placement the
video would use. An explicit "top" placement is already above every panel
and is kept. Full-frame photos cover the frame, so they are not bands and
the user's placement applies.
"""

from typing import Optional, Sequence

# Keep at least this many pixels between the caption block and the frame edge.
MIN_MARGIN = 10

# (first second, last second, lowest pixel the caption block may reach).
CaptionBand = tuple[float, float, int]


def cue_bottom(bands: Sequence[CaptionBand], seconds: float) -> Optional[int]:
    """The lowest pixel a caption starting at `seconds` may reach, if any."""
    for start, end, bottom in bands:
        if start <= seconds <= end:
            return bottom
    return None


def caption_y(
    position: Optional[str],
    custom_position: float,
    video_height: int,
    clip_height: int,
    max_bottom: Optional[int] = None,
) -> float | str:
    """Top y of the caption block, or "center" for the centered placement.

    `max_bottom` is the ceiling a segment panel imposes: the block is
    bottom-anchored there so the photo stays clear.
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
