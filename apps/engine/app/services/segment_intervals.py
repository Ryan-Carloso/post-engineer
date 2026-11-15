"""Spoken interval per segment, from Whisper word times.

Extracted verbatim from user_media.py so that module stays under the
file-size cap: the interval walk is pure timing logic with no dependency
on photo resolution. Exact walk: the flattened subtitle tokens must
equal the flattened segment tokens; each segment then takes the first
and last time of the tokens it consumes. Anything else (a tokenisation
mismatch, no word times at all) falls back to intervals proportional to
token counts over the full audio duration, so a photo is never placed
by a walk that silently drifted.
"""

import re
from typing import Any, Sequence

from app.services import subtitle

_WORD = re.compile(r"[^\W_]+")


def _tokens(text: str) -> list[str]:
    return _WORD.findall(text.casefold())


def segment_intervals(
    segments: Sequence[dict[str, Any]],
    words: Sequence[tuple[str, float, float]],
    audio_duration: float,
) -> tuple[list[tuple[float, float]], bool]:
    """Spoken interval per segment, plus whether proportional fallback ran."""
    counts = [len(_tokens(str(segment.get("text", "")))) for segment in segments]
    total = sum(counts)
    if not segments:
        return [], False
    if audio_duration <= 0:
        return [(0.0, 0.0) for _ in segments], True
    flat: list[tuple[str, float, float]] = []
    for text, start, end in words:
        for token in _tokens(text):
            flat.append((token, start, end))
    segment_tokens = [_tokens(str(segment.get("text", ""))) for segment in segments]
    if flat and [token for token, _, _ in flat] == [token for tokens in segment_tokens for token in tokens]:
        intervals: list[tuple[float, float]] = []
        cursor = 0
        for tokens in segment_tokens:
            if not tokens:
                # A segment with no spoken words (punctuation-only text
                # passes validation in full lip sync; the images modes
                # reject it before charging) has no interval of its own:
                # inherit the previous boundary instead of indexing an
                # empty slice, which raised IndexError and failed the video.
                boundary = flat[cursor - 1][2] if cursor > 0 else 0.0
                intervals.append((boundary, boundary))
                continue
            taken = flat[cursor : cursor + len(tokens)]
            intervals.append((taken[0][1], taken[-1][2]))
            cursor += len(tokens)
        return intervals, False
    # Proportional fallback: by token count, or evenly when nothing has words.
    intervals = []
    cursor = 0.0
    for index, count in enumerate(counts):
        share = (count / total) if total > 0 else (1.0 / len(segments))
        end = audio_duration if index == len(segments) - 1 else cursor + audio_duration * share
        intervals.append((cursor, end))
        cursor = end
    return intervals, True


def segment_intervals_from_subtitle(
    segments: Sequence[dict[str, Any]], subtitle_path: str, audio_duration: float
) -> tuple[list[tuple[float, float]], bool]:
    """Intervals from the word file next to `subtitle_path`."""
    return segment_intervals(segments, subtitle.file_to_words(subtitle_path), audio_duration)
