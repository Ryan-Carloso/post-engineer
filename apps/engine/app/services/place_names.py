"""Which named places get a photo, and which clip each photo takes.

Pure logic, no network (the lookup lives in place_photos). A name qualifies
when it is a proper name of the script that the subject does not already
cover ("Porto" is the video itself, not a place to photograph); at most
PLACE_PHOTO_MAX per video, the most specific first. The photo takes the clip
of the final material list whose start is nearest to the moment the voice says
the name, whatever the material is (drawings, stock footage, persona videos).
"""

import re
from collections.abc import Sequence
from dataclasses import dataclass

from app.services import script_claims

PLACE_PHOTO_MAX = 2
# File names of prepared photos; video_loop recognizes photo clips by it (a clip
# rendered from place-photo-0.jpg is place-photo-0.jpg.mp4).
PHOTO_FILE_PREFIX = "place-photo-"

# Capitalized in English, never a place: days, months and common nationalities.
_NOT_PLACES = frozenset(
    {
        "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
        "january", "february", "march", "april", "may", "june", "july", "august",
        "september", "october", "november", "december",
        "portuguese", "french", "spanish", "italian", "english", "german", "european",
        "american", "british", "brazilian", "asian", "african", "christmas", "easter",
    }
)

_ALNUM = re.compile(r"[^\W_]+")


@dataclass(frozen=True)
class PreparedPhoto:
    """A downloaded, validated photo still ready to take a drawing's slot."""

    name: str
    still_path: str
    seconds: float
    source_host: str


def candidate_names(script: str, subject: str) -> list[str]:
    """Up to PLACE_PHOTO_MAX proper names worth a photo, in script order."""
    subject_parts = set(script_claims.name_parts(subject))
    found: list[tuple[int, str, int]] = []
    seen: set[str] = set()
    for position, text, _ in script_claims.proper_names(script):
        parts = script_claims.name_parts(text)
        if not parts or set(parts) <= subject_parts or all(part in _NOT_PLACES for part in parts):
            continue
        key = " ".join(parts)
        if key in seen:
            continue
        seen.add(key)
        found.append((position, text, len(parts)))
    specific = sorted(found, key=lambda item: (-item[2], item[0]))[:PLACE_PHOTO_MAX]
    return [text for _, text, _ in sorted(specific)]


def _word_parts(word: str) -> list[str]:
    return _ALNUM.findall(script_claims.fold_text(word))


def mention_seconds(
    name: str, script: str, words: Sequence[tuple[str, float, float]], audio_seconds: float
) -> float | None:
    """When the voice starts saying `name`, or None when the script has no such name.

    Whisper word times give the start of the word sequence that matches the
    name (the second word may follow a short filler such as "do"). Without
    word times the character share of the first mention estimates it.
    """
    parts = script_claims.name_parts(name)
    if not parts:
        return None
    first = parts[0]
    second = parts[1] if len(parts) > 1 else None
    spoken = [(set(_word_parts(text)), start) for text, start, _ in words]
    for index, (word_parts, start) in enumerate(spoken):
        if first not in word_parts:
            continue
        if second is None:
            return start
        following = index + 1
        if following < len(spoken) and all(len(part) < 3 for part in spoken[following][0]):
            following += 1
        if following < len(spoken) and second in spoken[following][0]:
            return start
    position = script.casefold().find(name.casefold())
    if position < 0 or not script:
        return None
    return audio_seconds * position / len(script)


def nearest_slot(seconds: float, durations: Sequence[float]) -> int:
    """Index of the clip whose start is nearest to `seconds` (the earlier one on a tie)."""
    best, best_gap, start = 0, None, 0.0
    for index, duration in enumerate(durations):
        gap = abs(seconds - start)
        if best_gap is None or gap < best_gap:
            best, best_gap = index, gap
        start += duration
    return best


def assign_slots(times: Sequence[float], durations: Sequence[float]) -> list[int | None]:
    """A free clip slot for each mention time, aligned with `times`.

    Two mentions never share a slot (the later one moves to the next free
    slot); with no free slot left, or no clip at all, the mention gets None.
    """
    slots: list[int | None] = [None] * len(times)
    if not durations:
        return slots
    taken: set[int] = set()
    for position in sorted(range(len(times)), key=lambda item: times[item]):
        index = nearest_slot(times[position], durations)
        while index in taken and index + 1 < len(durations):
            index += 1
        if index in taken:
            continue
        taken.add(index)
        slots[position] = index
    return slots
