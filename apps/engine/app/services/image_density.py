"""How many photos an images-material segment needs, and how its time is split.

One photo per 2 seconds of speech, the render pace. Each photo stays on
screen at least about 1 second (3 words), so a short segment does not
flicker. The same numbers are exported by shared/script-segments.
"""

from typing import Optional

WORDS_PER_IMAGE = 8
MIN_WORDS_PER_IMAGE = 3
MAX_IMAGES_MODE_MEDIAS = 30
MAX_PHOTO_SECONDS = 2


def min_images(words: int) -> int:
    """Photos a segment needs to cover its spoken audio at the render pace."""
    if words <= 0:
        return 0
    seconds = spoken_seconds(words)
    return (seconds + MAX_PHOTO_SECONDS - 1) // MAX_PHOTO_SECONDS


def max_images(words: int) -> int:
    """Photos a segment can hold before they flicker: at least one."""
    return max(1, words // MIN_WORDS_PER_IMAGE)


def spoken_seconds(words: int) -> int:
    """Approximate spoken seconds. Half-up, so it matches the TS validator."""
    return (words * 3 + WORDS_PER_IMAGE // 2) // WORDS_PER_IMAGE


def density_error(
    words: int,
    count: int,
    min_count: Optional[int] = None,
    covers_audio: bool = True,
) -> Optional[tuple[str, str]]:
    """(rule, fix) when count is outside the images-mode range, else None.

    min_count, when given, is what the minimum is measured against: a
    video clip covers more than one photo slot (segment_video
    CLIP_DENSITY_ITEMS), so a take carried by clips meets its minimum
    with fewer items. The maximum still counts items one for one: a
    clip flickers like a photo when the take is crowded. covers_audio
    False means the segment's photos never cover its audio: hook photos
    in a hook-only video play over the speaker's face, so the minimum
    is zero there and only the flicker maximum applies.
    """
    low = min_images(words) if covers_audio else 0
    high = max_images(words)
    seconds = spoken_seconds(words)
    effective = min_count if min_count is not None else count
    if effective < low:
        missing = low - effective
        images = "image" if low == 1 else "images"
        more = "image" if missing == 1 else "images"
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
