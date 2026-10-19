"""Derive YouTube tags from the video topic.

Tags are extracted from the topic text itself, so they always land in the
video's own language (a Portuguese topic yields Portuguese tags, a Hindi
topic yields Hindi tags, ...). There are no per-language word lists:
tokenization keeps Unicode letters, combining marks and numbers (so
Devanagari vowel signs stay glued to their base letter) and the only
filters are language-independent (minimum token length, digits-only
tokens, duplicates).

A deterministic keyword pass is used on purpose: no LLM call, no network,
no cost, and the pre-flight check can run before any GPU/token is spent.
"""

from __future__ import annotations

import unicodedata

# YouTube accepts at most 500 characters across all tags; stay well under it.
_MAX_TAGS = 8
_MAX_TOTAL_CHARS = 400
_MIN_TOKEN_LENGTH = 3


def _is_token_char(char: str) -> bool:
    """True for letters, combining marks and numbers in any script.

    Combining marks (Mc/Mn/Me, e.g. Devanagari vowel signs) must stay glued
    to their base letter: ``\\w`` does not match them, so a regex tokenizer
    would shred "पोर्टो" into single consonants and drop every token.
    """
    return unicodedata.category(char)[0] in ("L", "M", "N")


def _tokenize(text: str) -> list[str]:
    """Split text into tokens of letters/marks/numbers, any script."""
    tokens: list[str] = []
    current: list[str] = []
    for char in text:
        if _is_token_char(char):
            current.append(char)
        elif current:
            tokens.append("".join(current))
            current = []
    if current:
        tokens.append("".join(current))
    return tokens


def derive_tags_from_topic(topic: str) -> tuple[str, ...]:
    """Extract up to ``_MAX_TAGS`` keyword tags from the topic.

    Returns lowercase, de-duplicated tokens in first-seen order. When the
    strict pass finds nothing usable, falls back to cutting the title into
    raw words with looser rules: tags are metadata garnish, not worth
    failing a slot over — a rough tag beats a failed generation. Only a
    topic with no words at all (pure punctuation) still yields ``()``,
    and only then does the publish pre-flight fail the slot.
    """
    tags = _derive_tags(topic, min_token_length=_MIN_TOKEN_LENGTH, drop_digits=True)
    if not tags:
        tags = _derive_tags(topic, min_token_length=1, drop_digits=False)
    return tags


def _derive_tags(topic: str, *, min_token_length: int, drop_digits: bool) -> tuple[str, ...]:
    seen: set[str] = set()
    tags: list[str] = []
    total_chars = 0
    for token in _tokenize(topic.lower()):
        if len(token) < min_token_length:
            continue
        if drop_digits and token.isdigit():
            continue
        if token in seen:
            continue
        if len(tags) >= _MAX_TAGS:
            break
        if total_chars + len(token) > _MAX_TOTAL_CHARS:
            break
        seen.add(token)
        tags.append(token)
        total_chars += len(token)
    return tuple(tags)
