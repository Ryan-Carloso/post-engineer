"""Repeat detection for segment media items.

One call per media item, in segment order: the first time a mediaId or
url value appears it is recorded in ``seen`` and the call returns None;
the second time the same value appears it returns the (rule, fix) pair
the validator raises. mediaId and url are different identities: the
same characters in both fields are not the same photo. A repeated video
clip reports the clip rule, a repeated photo the photo rule.
"""

from typing import Any


def check_repeat(item: Any, seen: set[tuple[str, str]]) -> tuple[str, str] | None:
    """Record one media item and report a repeat, if it is one.

    Returns None for a first sighting (and records the token), or the
    (rule, fix) pair for a repeated photo or video clip. Non-dict items
    and items with no usable mediaId or url are ignored.
    """
    if not isinstance(item, dict):
        return None
    # Lazy: schema.py imports script_segments; a top-level import would cycle via media_aspect.
    from app.services import segment_video

    for name in ("mediaId", "url"):
        value = item.get(name)
        if isinstance(value, str) and value.strip():
            token = (name, value.strip())
            if token in seen:
                if segment_video.is_video_ref(item):
                    return (
                        "the same video clip must not repeat",
                        "Use a different video clip for each media item.",
                    )
                return (
                    "the same photo must not repeat",
                    "Use a different photo for each media item.",
                )
            seen.add(token)
            return None
    return None
