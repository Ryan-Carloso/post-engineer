"""Per-video CTA-take validation (issue #639): the marked take must exist,
must be a content take, and a comment CTA must ask a question."""

import pytest

from app.models.cta import CtaType
from app.services.cta_validation import validate_cta_take
from app.services.script_segments import SegmentValidationError

HOOK = {
    "kind": "hook",
    "text": "Stop wasting your trip stuck in a ninety minute line for the original dish when a better table is still waiting nearby for you today.",
}
BODY = {
    "kind": "content",
    "text": "Locals skip the famous house and walk two minutes to a smaller kitchen where the sauce recipe has not changed since nineteen fifty three and the cook still greets every table by name before the first plate arrives at your table tonight.",
}
CTA = {"kind": "content", "text": "Save this video before your next trip to Porto."}
QUESTION = {"kind": "content", "text": "What would you pack first for a weekend in Porto?"}


def test_no_cta_and_no_marker_passes():
    validate_cta_take([HOOK, BODY, CTA], None)


def test_stray_marker_without_cta_type_is_rejected():
    segments = [HOOK, BODY, {**CTA, "cta": True}]
    with pytest.raises(SegmentValidationError, match="no CTA applies"):
        validate_cta_take(segments, None)


def test_follow_with_marked_content_take_passes():
    validate_cta_take([HOOK, BODY, {**CTA, "cta": True}], CtaType.follow)


def test_cta_type_without_marked_take_is_rejected():
    with pytest.raises(SegmentValidationError, match="No content take is marked"):
        validate_cta_take([HOOK, BODY, CTA], CtaType.follow)


def test_hook_marked_as_cta_is_rejected():
    segments = [{**HOOK, "cta": True}, BODY, CTA]
    with pytest.raises(SegmentValidationError, match="hook cannot be the CTA"):
        validate_cta_take(segments, CtaType.follow)


def test_comment_cta_without_question_is_rejected():
    segments = [HOOK, BODY, {**CTA, "cta": True}]
    with pytest.raises(SegmentValidationError, match="must ask a question"):
        validate_cta_take(segments, CtaType.comment)


def test_comment_cta_with_question_passes():
    validate_cta_take([HOOK, BODY, {**QUESTION, "cta": True}], CtaType.comment)


def test_comment_cta_checks_every_marked_take():
    segments = [HOOK, BODY, {**QUESTION, "cta": True}, {**CTA, "cta": True}]
    with pytest.raises(SegmentValidationError, match="must ask a question"):
        validate_cta_take(segments, CtaType.comment)


def test_link_cta_needs_no_question():
    validate_cta_take([HOOK, BODY, {**CTA, "cta": True}], CtaType.link)
