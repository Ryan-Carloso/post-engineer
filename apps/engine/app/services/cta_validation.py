"""Per-video CTA-take validation (issue #639).

The agent marks the content take that performs this video's CTA with
``cta: true``. When a CTA applies (the request carries a ``cta_type``),
the marked take must exist, must be a content take, and a comment CTA
must ask a question about this video's topic. When no CTA applies, a
stray marker is rejected too: a marker nobody asked for would otherwise
pass silently and confuse the next reader. The check runs on the
model-dumped segments inside the TaskVideoRequest validator, so it
covers direct dispatch, batch dispatch, and redispatch alike.
"""

from typing import Any, Optional, Sequence

from app.models.cta import CtaType
from app.services.script_segments import SegmentValidationError


def validate_cta_take(
    segments: Sequence[dict[str, Any]],
    cta_type: Optional[CtaType],
) -> None:
    """Enforce the CTA-take rule for one video's segments."""
    marked = [index for index, segment in enumerate(segments) if segment.get("cta") is True]
    if cta_type is None:
        if marked:
            raise SegmentValidationError(
                "segments",
                "A segment is marked as the CTA take but no CTA applies to this video.",
                "Remove the cta marker, or send a cta_type.",
            )
        return
    if not marked:
        raise SegmentValidationError(
            "segments",
            "No content take is marked as the CTA take.",
            "Mark the take that performs this video's CTA with cta: true.",
        )
    for index in marked:
        segment = segments[index]
        if segment.get("kind") != "content":
            raise SegmentValidationError(
                f"segments.{index}.cta",
                "The hook cannot be the CTA take.",
                "Mark a content take with cta: true instead.",
            )
        if cta_type == CtaType.comment and "?" not in str(segment.get("text") or ""):
            raise SegmentValidationError(
                f"segments.{index}.text",
                "A comment CTA must ask a question.",
                "End the marked take with a question about this video's topic.",
            )
