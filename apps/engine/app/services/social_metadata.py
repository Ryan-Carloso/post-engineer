"""Mechanical social metadata for cross-posting (no LLM involved).

Phase 5 replaces the LLM-generated YouTube cross-post copy with this
fixed fallback: the title is the video subject, the caption is empty
and there are no hashtags. It deliberately does not reuse the script
or default tags, so the metadata stays generic and predictable.

This module must never import the LLM core: a later Phase 5 PR deletes
``llm.py`` without touching this code again.
"""


def mechanical_social_metadata(video_subject: str) -> dict:
    """Return subject-only YouTube metadata for a cross-posted video.

    The shape matches what the cross-post caller expects:
    ``{"title": str, "caption": str, "hashtags": list[str]}``.
    """
    return {
        "title": (video_subject or "").strip(),
        "caption": "",
        "hashtags": [],
    }
