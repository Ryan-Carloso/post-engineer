"""Bluesky caption helpers: grapheme counting and safe truncation.

Extracted from ``upload_publisher`` so that module stays under the
file-size cap; the helpers are re-exported there, so existing import
sites (``fill_schedule.metadata``, the publish tests) keep working.
"""

from __future__ import annotations

BLUESKY_CAPTION_MAX_GRAPHEMES: int = 300


def count_graphemes(text: str) -> int:
    """Count user-perceived characters (emoji ZWJ sequences count as one)."""
    import unicodedata
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


def _grapheme_clusters(text: str) -> list[str]:
    """Split text into grapheme clusters, using the same rule as count_graphemes.

    A character joins the current cluster when it is a combining mark or a
    zero-width joiner, or when the previous character was one (the base
    character after a ZWJ belongs to the same emoji); otherwise it starts a
    new cluster. A cluster therefore counts as exactly one grapheme, so
    truncating on cluster boundaries can never split an emoji.
    """
    import unicodedata

    clusters: list[str] = []
    previous_continuation = False
    for char in text:
        is_continuation = unicodedata.combining(char) or char == "\u200d"
        if clusters and (is_continuation or previous_continuation):
            clusters[-1] += char
        else:
            clusters.append(char)
        previous_continuation = is_continuation
    return clusters


def truncate_bluesky_caption(caption: str) -> str:
    """Truncate a caption to 300 graphemes with an ellipsis, never breaking emoji."""
    if count_graphemes(caption) <= BLUESKY_CAPTION_MAX_GRAPHEMES:
        return caption
    # Take whole clusters up to the ellipsis budget: a cluster that does not
    # fit is dropped entirely, never cut in half.
    result: list[str] = []
    for cluster in _grapheme_clusters(caption):
        if len(result) >= BLUESKY_CAPTION_MAX_GRAPHEMES - 1:
            break
        result.append(cluster)
    return "".join(result) + "…"
