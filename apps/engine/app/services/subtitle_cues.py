"""Subtitle cue splitting shared by every subtitle provider.

A cue is one on-screen caption. The script is split at punctuation first,
then any line longer than MAX_CUE_WORDS is cut into balanced chunks, so a
9:16 frame never has to wrap a caption over more than two or three lines.
"""

import math

from app.utils import utils

# Words per on-screen cue. Both the TTS-timeline path (voice.create_subtitle)
# and the Whisper path (subtitle.correct) split with this cap.
MAX_CUE_WORDS = 6


def split_cue(text: str, max_words: int = MAX_CUE_WORDS) -> list[str]:
    """Cut one line into balanced chunks of at most `max_words` words.

    Balanced, not greedy: 7 words become 4 + 3, never 6 + 1, so no cue is a
    lone orphan word.
    """
    words = text.split()
    if not words:
        return []
    chunk_count = math.ceil(len(words) / max_words)
    base, extra = divmod(len(words), chunk_count)
    cues: list[str] = []
    start = 0
    for index in range(chunk_count):
        size = base + (1 if index < extra else 0)
        cues.append(" ".join(words[start : start + size]))
        start += size
    return cues


def split_script_lines(text: str) -> list[str]:
    """Split script text at punctuation, then cap each line's word count."""
    lines: list[str] = []
    for line in utils.split_string_by_punctuations(text):
        lines.extend(split_cue(line))
    return lines
