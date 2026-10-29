"""Mechanical social metadata for cross-posting (no LLM involved).

Phase 5 replaces the LLM-generated YouTube cross-post copy with this
fixed fallback: the title is the video subject, the caption is empty
and there are no hashtags. It deliberately does not reuse the script
or default tags, so the metadata stays generic and predictable.

An empty or whitespace-only subject falls back to the generic title
(the same string the cross-post caller already uses for the video
title), so the upload service never receives an empty YouTube title.
That mirrors the old LLM fallback's non-empty-title guarantee, with a
fixed string instead of the first script sentence.

This module never imported the LLM core: deleting ``llm.py``
(Phase 5 PR 6) left this code untouched.
"""

GENERIC_VIDEO_TITLE = "Check out this video! #shorts #viral"


def mechanical_social_metadata(video_subject: str) -> dict:
    """Return subject-only YouTube metadata for a cross-posted video.

    The shape matches what the cross-post caller expects:
    ``{"title": str, "caption": str, "hashtags": list[str]}``.
    """
    subject = (video_subject or "").strip()
    return {
        "title": subject or GENERIC_VIDEO_TITLE,
        "caption": "",
        "hashtags": [],
    }
