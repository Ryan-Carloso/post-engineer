"""Deterministic subtitle cleanup: only "?" survives as punctuation.

The agent's script is the narration, not the caption: commas, periods and
dashes read fine aloud but clutter the on-screen text. The user wants
captions with no terminal punctuation except "?". This is a script, not a
prompt rule and not an LLM call — it runs on every subtitle file the
engine builds, so a script that ignores the prompt still ships clean
captions. The prompt carries only the one-line prevention rule; this
module is the enforcement.

Unicode handling uses the stdlib only, the same `re` + `unicodedata`
pattern the rest of the engine uses (voice, caption_text): dashes are
detected by Unicode category `Pd`, so every dash form is covered, and
the removed punctuation is an explicit set, so apostrophes inside words
("don't"), quotes, "%" and every other character survive untouched.
"""

import os
import re
import unicodedata

from app.services import subtitle

# Sentence punctuation deleted from subtitle text. "?" is the only
# terminal mark that survives; apostrophes are not in this set on purpose.
_REMOVED_PUNCTUATION = frozenset(".,!;:…。、！；：．，‼")

# Question-mark variants normalized to "?".
_QUESTION_MARKS = frozenset({"？", "⁇", "⁈", "⁉"})

_WHITESPACE_RUN = re.compile(r"\s+")
_SPACE_BEFORE_QUESTION = re.compile(r"\s+\?")


def clean_subtitle_text(text: str) -> str:
    """Strip subtitle punctuation, keeping only "?" and apostrophes.

    Dashes (any Unicode `Pd` character) become a word break; the listed
    sentence punctuation is deleted; "?" (and its fullwidth/variant forms)
    is kept. Whitespace is collapsed, so removing "- " leaves one space.
    """
    if not text:
        return ""
    chars: list[str] = []
    for char in text:
        if char in _QUESTION_MARKS:
            chars.append("?")
        elif unicodedata.category(char) == "Pd":
            chars.append(" ")
        elif char in _REMOVED_PUNCTUATION:
            continue
        else:
            chars.append(char)
    cleaned = _WHITESPACE_RUN.sub(" ", "".join(chars)).strip()
    return _SPACE_BEFORE_QUESTION.sub("?", cleaned)


def clean_subtitle_file(subtitle_path: str) -> bool:
    """Rewrite an SRT file with every cue cleaned; False when it cannot be read.

    Timings and cue order are preserved; cues that clean to nothing are
    dropped and the rest renumbered, so the file stays valid SRT. Returns
    False for a missing file or a file with no cues.
    """
    if not subtitle_path or not os.path.isfile(subtitle_path):
        return False
    try:
        cues = subtitle.file_to_subtitles(subtitle_path)
    except (OSError, UnicodeDecodeError):
        return False
    if not cues:
        return False
    cleaned: list[tuple[str, str]] = []
    for _, timing, text in cues:
        lines = [clean_subtitle_text(line) for line in text.split("\n")]
        text = "\n".join(line for line in lines if line)
        if text:
            cleaned.append((timing.strip(), text))
    if not cleaned:
        return False
    try:
        with open(subtitle_path, "w", encoding="utf-8") as fd:
            for index, (timing, text) in enumerate(cleaned, 1):
                fd.write(f"{index}\n{timing}\n{text}\n\n")
    except OSError:
        return False
    return True
