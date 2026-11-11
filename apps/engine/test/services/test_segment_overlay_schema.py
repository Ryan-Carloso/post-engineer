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
        media=[
            {"url": "https://example.com/x.jpg", "overlay": {"title": "Sushi", "badge": "EUR 35"}}
        ],
    )
    dumped = segment.model_dump(exclude_none=True)
    assert dumped["media"][0]["overlay"] == {"title": "Sushi", "badge": "EUR 35"}


@pytest.mark.parametrize(
    "overlay",
    [
        {},
        {"title": ""},
        {"title": "x" * 61},
        {"title": "x", "price": "1"},
        {"title": "x", "subtitle": ""},
    ],
)
def test_overlay_rejects_what_the_validator_rejects(overlay):
    with pytest.raises(ValidationError):
        SegmentMedia(url="https://example.com/x.jpg", overlay=overlay)


def test_overlay_text_is_measured_after_trimming_like_the_validators():
    # validate_script and the TS validators measure the trimmed string, so a
    # title that only exceeds the limit by its padding must be accepted here.
    overlay = SegmentOverlay(
        title="x" * script_segments.MAX_OVERLAY_TITLE_CHARS + "  ", badge=" EUR 35 "
    )
    assert overlay.title == "x" * script_segments.MAX_OVERLAY_TITLE_CHARS
    assert overlay.badge == "EUR 35"
    with pytest.raises(ValidationError):
        SegmentOverlay(title=" " * 3)


def _request_segments(with_media):
    hook = "Stop wasting your trip stuck in a ninety minute line for the original dish when a better table is waiting nearby for you today."
    body = (
        "Locals skip the famous house and walk two minutes to a smaller kitchen where the sauce recipe has not changed "
        "since nineteen fifty three and the cook still greets every table by name before the first plate arrives at your table tonight."
    )
    cta = "Save this video before your next trip to Porto."
    segments = [
        {"kind": "hook", "text": hook},
        {"kind": "body", "text": body},
        {"kind": "cta", "text": cta},
    ]
    if with_media:
        counts = (3, 6, 2)
        segments = [
            {
                **segment,
                "media": [{"url": f"https://example.com/{i}-{n}.jpg"} for n in range(counts[i])],
            }
            for i, segment in enumerate(segments)
        ]
    return segments


def test_images_request_with_media_on_every_segment_joins_into_the_script():
    from app.models.schema import TaskVideoRequest

    request = TaskVideoRequest(
        video_title="Porto",
        video_description="Test description.",
        video_type="faceless",
        segments=_request_segments(True),
    )
    assert request.video_script.startswith("Stop wasting your trip")


def test_images_request_with_a_segment_missing_media_is_rejected():
    import pydantic

    from app.models.schema import TaskVideoRequest

    with pytest.raises(
        pydantic.ValidationError, match="The images material needs media on every segment"
    ):
        TaskVideoRequest(
            video_title="Porto",
            video_description="Test description.",
            video_type="faceless",
            segments=_request_segments(False),
        )


def test_request_without_segments_is_accepted_for_script_only_calls():
    # Script-only direct/CLI calls carry no segments: the script is used
    # as-is. Web, MCP and the batch pipeline always send segments.
    from app.models.schema import TaskVideoRequest

    assert (
        TaskVideoRequest(
            video_title="Porto",
            video_description="Test description.",
            video_type="faceless",
            video_script="Some script.",
        ).segments
        is None
    )
