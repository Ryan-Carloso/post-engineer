"""Latin-script guard rules used by the LLM script pipeline.

Characters from non-Latin writing systems must never reach TTS or
burnt-in subtitles when the requested language uses the Latin script.
Extracted from app/services/llm.py so the fact-injection wiring could be
added without growing that grandfathered file."""

import re

# Ranges: CJK Extension A, CJK Unified Ideographs, CJK symbols + Hiragana +
# Katakana, Hangul syllables.
_FOREIGN_SCRIPT_RE = re.compile("[㐀-䶿一-鿿　-ヿ가-힯]+")

# Languages normally written in the Latin script: only these get the
# foreign-script guard. A video in zh/ja/ko legitimately contains CJK and
# must never be rejected or stripped.
_LATIN_SCRIPT_LANGUAGES = {"pt", "en", "es", "fr", "it", "de", "nl"}


def _uses_latin_script(language: str) -> bool:
    """True when the requested language is normally written in Latin script."""
    base = (language or "").strip().lower().replace("_", "-").split("-", 1)[0]
    return base in _LATIN_SCRIPT_LANGUAGES


def _find_foreign_script(text: str) -> list[str]:
    """All runs of non-Latin-script characters found in the text."""
    return _FOREIGN_SCRIPT_RE.findall(text or "")


def _strip_foreign_script(text: str) -> str:
    """Remove non-Latin-script characters; the last-resort degradation."""
    return _FOREIGN_SCRIPT_RE.sub("", text or "")
