"""How many photos an images-material segment needs, and how its time is split.

One photo per about 3 seconds of speech (8 words). Each photo stays on
screen at least about 1 second (3 words), so a short segment does not
flicker. The same numbers are exported by shared/script-segments.
"""

from typing import Optional

WORDS_PER_IMAGE = 8
MIN_WORDS_PER_IMAGE = 3
MAX_IMAGES_MODE_MEDIAS = 30


def min_images(words: int) -> int:
    """Photos a segment needs: one per WORDS_PER_IMAGE words, rounded up."""
    if words <= 0:
        return 0
    return (words + WORDS_PER_IMAGE - 1) // WORDS_PER_IMAGE


def max_images(words: int) -> int:
    """Photos a segment can hold before they flicker: at least one."""
    return max(1, words // MIN_WORDS_PER_IMAGE)


def spoken_seconds(words: int) -> int:
    """Approximate spoken seconds. Half-up, so it matches the TS validator."""
    return (words * 3 + WORDS_PER_IMAGE // 2) // WORDS_PER_IMAGE


def density_error(words: int, count: int) -> Optional[tuple[str, str]]:
    """(rule, fix) when count is outside the images-mode range, else None."""
    low = min_images(words)
    high = max_images(words)
    seconds = spoken_seconds(words)
    if count < low:
        missing = low - count
        images = "image" if low == 1 else "images"
        more = "image" if missing == 1 else "images"
        return (
            f"segment has {words} words (~{seconds}s) and needs at least {low} {images} (one per ~3s); it has {count}.",
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
