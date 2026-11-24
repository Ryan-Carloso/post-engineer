"""Where a subtitle cue sits on the frame: a panel photo (segment_panels) is
an inset, so any cue on screen while one is on screen is bottom-anchored above
its top edge. Cue and panel intervals come from different sources, so any
overlap counts and the tightest band wins.

The hook title shows at the top of the frame for its first seconds: any cue
that overlaps that window is forced to the bottom and may not start above the
title's floor. When a panel's ceiling and the title's floor cannot both hold,
the floor wins, so a caption never lands on the title.
"""

from typing import NamedTuple, Optional, Sequence

MIN_MARGIN = 10

CaptionBand = tuple[float, float, int]


class TitleFloor(NamedTuple):
    """The seconds the hook title shows and the highest pixel a caption may start at."""

    start: float
    end: float
    floor: int


def cue_bottom(bands: Sequence[CaptionBand], times: tuple[float, float]) -> Optional[int]:
    """The lowest pixel a caption shown for `times` (start, end) may reach, if any."""
    start, end = times
    return min(
        (band[2] for band in bands if not isinstance(band, TitleFloor) and band[0] < end and band[1] > start),
        default=None,
    )


def cue_floor(bands: Sequence[CaptionBand], times: tuple[float, float]) -> Optional[int]:
    """The highest pixel a caption shown for `times` may start at while the title shows, if any."""
    start, end = times
    return max(
        (band.floor for band in bands if isinstance(band, TitleFloor) and band.start < end and band.end > start),
        default=None,
    )


def cue_y(
    position: Optional[str],
    custom_position: float,
    video_height: int,
    clip_height: int,
    bands: Sequence[CaptionBand],
    times: tuple[float, float],
) -> float | str:
    """Top y of the caption block for the cue shown for `times`, given every band."""
    return caption_y(
        position, custom_position, video_height, clip_height, cue_bottom(bands, times), cue_floor(bands, times)
    )


def caption_y(
    position: Optional[str],
    custom_position: float,
    video_height: int,
    clip_height: int,
    max_bottom: Optional[int] = None,
    min_top: Optional[int] = None,
) -> float | str:
    """Top y of the caption block, or "center" for the centered placement.

    `max_bottom` is the ceiling a segment panel imposes, so the photo stays clear.
    `min_top` is the floor the hook title imposes: the caption goes to the
    bottom whatever the position was, under the ceiling, and never above it.
    """
    if min_top is not None:
        bottom_y = video_height * 0.95 - clip_height
        return max(min_top, bottom_y if max_bottom is None else max(MIN_MARGIN, max_bottom - clip_height))
    if position == "top":
        return video_height * 0.05
    if max_bottom is not None:
        return max(MIN_MARGIN, max_bottom - clip_height)
    if position == "bottom":
        return video_height * 0.95 - clip_height
    if position == "custom":
        max_y = video_height - clip_height - MIN_MARGIN
        custom_y = (video_height - clip_height) * (custom_position / 100)
        return max(MIN_MARGIN, min(custom_y, max_y))
    return "center"
