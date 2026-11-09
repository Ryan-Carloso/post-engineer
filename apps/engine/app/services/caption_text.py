"""Grapheme-aware caption text helpers (Bluesky's 300-grapheme cap).

Extracted from ``upload_publisher`` so that module stays under the
file-size cap; ``upload_publisher`` re-exports these names for existing
callers.
"""

from __future__ import annotations

import unicodedata

BLUESKY_CAPTION_MAX_GRAPHEMES: int = 300


def count_graphemes(text: str) -> int:
    """Count user-perceived characters (emoji ZWJ sequences count as one)."""
    count = 0
    previous_combining = False
    for char in text:
        if unicodedata.combining(char) or char == "\u200d":
            previous_combining = True
            continue
        if previous_combining:
            previous_combining = False
            continue
        count += 1
    return count


def truncate_bluesky_caption(caption: str) -> str:
    """Truncate a caption to 300 graphemes with an ellipsis, never breaking emoji."""
    if count_graphemes(caption) <= BLUESKY_CAPTION_MAX_GRAPHEMES:
        return caption
    result: list[str] = []
    count = 0
    for char in caption:
        if count == BLUESKY_CAPTION_MAX_GRAPHEMES - 1:
            break
        if unicodedata.combining(char) or char == "\u200d":
            if result:
                result[-1] += char
            continue
        result.append(char)
        count += 1
    return "".join(result) + "…"
