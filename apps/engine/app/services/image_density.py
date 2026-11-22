"""How many photos an images-material segment needs, and how its time is split.

One photo per 2 seconds of speech, the render pace. Each photo stays on
screen at least about 1 second (3 words), so a short segment does not
flicker. The same numbers are exported by shared/script-segments.
"""

import math
from typing import Any, Optional

from app.services.segment_photo_duration import photo_cap

WORDS_PER_IMAGE = 8
MIN_WORDS_PER_IMAGE = 3
MAX_IMAGES_MODE_MEDIAS = 30
MAX_PHOTO_SECONDS = 2


def min_images(words: int) -> int:
    """Photos a segment needs to cover its spoken audio at the render pace.

    The seconds are not rounded first: rounding the estimate down before
    dividing by the 2s pace lets a short segment slip under the coverage
    the render check demands (6 words is 2.25s, so it needs 2 photos).
    """
    if words <= 0:
        return 0
    pace = WORDS_PER_IMAGE * MAX_PHOTO_SECONDS
    return (words * 3 + pace - 1) // pace


def max_images(words: int) -> int:
    """Photos a segment can hold before they flicker: at least one."""
    return max(1, words // MIN_WORDS_PER_IMAGE)


def spoken_seconds(words: int) -> int:
    """Approximate spoken seconds. Half-up, so it matches the TS validator."""
    return (words * 3 + WORDS_PER_IMAGE // 2) // WORDS_PER_IMAGE


def covered_slots(media: Any) -> float:
    """Photo slots a segment's media covers at the render pace.

    A clip stands in for six slots (about 12s), a photo for one by default.
    A photo with a requested duration covers its duration over the 2s pace:
    a 1s photo is half a slot, a 6s photo three. The segment_video import
    is local: importing it at module level cycles back through
    script_segments, which imports this module.
    """
    from app.services import segment_video

    if not isinstance(media, list):
        return 0.0
    slots = float(segment_video.clip_density_min_count(media, len(media)))
    for item in media:
        if isinstance(item, dict) and not segment_video.is_video_ref(item):
            slots += photo_cap(item.get("duration"), MAX_PHOTO_SECONDS) / MAX_PHOTO_SECONDS - 1
    return slots


def density_error(
    words: int,
    count: int,
    min_count: Optional[float] = None,
    covers_audio: bool = True,
) -> Optional[tuple[str, str]]:
    """(rule, fix) when count is outside the images-mode range, else None.

    min_count, when given, is what the minimum is measured against: a
    video clip covers more than one photo slot (segment_video
    CLIP_DENSITY_ITEMS), so a take carried by clips meets its minimum
    with fewer items, and a photo covers its requested duration over
    the 2s pace (covered_slots). The effective count may be fractional,
    so the missing count rounds up. The maximum still counts items one
    for one: a clip flickers like a photo when the take is crowded.
    covers_audio False means the segment's photos never cover its
    audio: hook photos in a hook-only video play over the speaker's
    face, so the minimum is zero there and only the flicker maximum
    applies. When the item count meets the minimum but the covered
    slots do not, the error names the covered seconds instead.
    """
    low = min_images(words) if covers_audio else 0
    high = max_images(words)
    seconds = spoken_seconds(words)
    effective = float(min_count) if min_count is not None else float(count)
    if effective < low:
        missing = math.ceil(low - effective)
        images = "image" if low == 1 else "images"
        more = "image" if missing == 1 else "images"
        if count >= low:
            covered = effective * MAX_PHOTO_SECONDS
            room = high - count
            if room < missing:
                return (
                    f"segment has {words} words (~{seconds}s); its photos cover only "
                    f"~{covered:g}s at their requested durations, and adding {missing} "
                    f"more {more} would exceed the {high}-image flicker cap.",
                    "Increase the durations of the short photos, or replace them with longer ones.",
                )
            return (
                f"segment has {words} words (~{seconds}s) but its photos cover only "
                f"~{covered:g}s at their requested durations; it needs ~{seconds}s "
                "of photos (one photo per 2s).",
                f"Add {missing} more {more} to this segment's media array.",
            )
        return (
            f"segment has {words} words (~{seconds}s) and needs at least {low} {images} (one per 2s); it has {count}.",
            f"Add {missing} more {more} to this segment's media array.",
        )
    if count > high:
        images = "image" if high == 1 else "images"
        return (
            f"segment has {words} words (~{seconds}s) and allows at most {high} {images} (each image needs ~1s); it has {count}.",
            f"Remove images until this segment has at most {high}.",
        )
    return None


def split_interval(start: float, end: float, count: int) -> list[tuple[float, float]]:
    """Split [start, end] into count equal slices. The last slice ends at end."""
    if count <= 0 or end <= start:
        return []
    step = (end - start) / count
    return [
        (start + index * step, end if index == count - 1 else start + (index + 1) * step)
        for index in range(count)
    ]
