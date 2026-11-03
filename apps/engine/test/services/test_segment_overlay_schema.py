"""SegmentMedia.overlay on the request path: strict like the validators."""

import pytest
from pydantic import ValidationError

from app.models.schema import ScriptSegment, SegmentMedia, SegmentOverlay
from app.services import script_segments


def test_overlay_limits_come_from_the_segments_validator():
    fields = SegmentOverlay.model_fields
    limits = {
        "title": script_segments.MAX_OVERLAY_TITLE_CHARS,
        "subtitle": script_segments.MAX_OVERLAY_SUBTITLE_CHARS,
        "badge": script_segments.MAX_OVERLAY_BADGE_CHARS,
    }
    for name, limit in limits.items():
        max_length = [m.max_length for m in fields[name].metadata if hasattr(m, "max_length")]
        assert max_length == [limit], name


def test_segment_media_carries_an_overlay_through_a_request_dump():
    segment = ScriptSegment(
        kind="body",
        text="Where the river meets the sea.",
        media={"url": "https://example.com/x.jpg", "overlay": {"title": "Sushi", "badge": "EUR 35"}},
    )
    dumped = segment.model_dump(exclude_none=True)
    assert dumped["media"]["overlay"] == {"title": "Sushi", "badge": "EUR 35"}


@pytest.mark.parametrize(
    "overlay",
    [{}, {"title": ""}, {"title": "x" * 61}, {"title": "x", "price": "1"}, {"title": "x", "subtitle": ""}],
)
def test_overlay_rejects_what_the_validator_rejects(overlay):
    with pytest.raises(ValidationError):
        SegmentMedia(url="https://example.com/x.jpg", overlay=overlay)


def test_overlay_text_is_measured_after_trimming_like_the_validators():
    # validate_script and the TS validators measure the trimmed string, so a
    # title that only exceeds the limit by its padding must be accepted here.
    overlay = SegmentOverlay(title="x" * script_segments.MAX_OVERLAY_TITLE_CHARS + "  ", badge=" EUR 35 ")
    assert overlay.title == "x" * script_segments.MAX_OVERLAY_TITLE_CHARS
    assert overlay.badge == "EUR 35"
    with pytest.raises(ValidationError):
        SegmentOverlay(title=" " * 3)
