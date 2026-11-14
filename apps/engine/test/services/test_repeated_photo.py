"""The same photo must not appear twice in one video.

web, MCP, and the engine share this rule and the same fix text. A repeated
mediaId or url fails on the second item, before a later density or cap rule.
"""

import pytest

from app.services import script_segments
from app.services.script_segments import SegmentValidationError

REPEAT_RULE = "the same photo must not repeat"
REPEAT_FIX = "Use a different photo for each media item."

HOOK = (
    "Stop wasting your trip stuck in a ninety minute line for the "
    "original dish when a better table is waiting nearby for you today."
)
BODY = (
    "Locals skip the famous house and walk two minutes to a smaller "
    "kitchen where the sauce recipe has not changed since nineteen "
    "fifty three and the cook still greets every table by name "
    "before the first plate arrives at your table tonight."
)
CTA = "Save this video before your next trip to Porto."


def _segments():
    return [
        {"kind": "hook", "text": HOOK},
        {"kind": "content", "text": BODY},
        {"kind": "content", "text": CTA},
    ]


def test_repeated_media_id_across_segments_names_the_second_item():
    segments = _segments()
    segments[0]["media"] = [{"mediaId": "photo-1"}]
    segments[1]["media"] = [{"mediaId": "photo-1"}]
    with pytest.raises(SegmentValidationError) as exc_info:
        script_segments.validate_segments(segments, video_type="full_lipsync")
    assert exc_info.value.field == "segments.1.media.0"
    assert exc_info.value.rule == REPEAT_RULE
    assert exc_info.value.fix == REPEAT_FIX


def test_repeated_url_inside_one_segment_points_at_the_second_item():
    segments = _segments()
    segments[1]["media"] = [
        {"url": "https://example.com/a.jpg"},
        {"url": "https://example.com/a.jpg"},
    ]
    with pytest.raises(SegmentValidationError) as exc_info:
        script_segments.validate_segments(segments, video_type="full_lipsync")
    assert exc_info.value.field == "segments.1.media.1"
    assert exc_info.value.rule == REPEAT_RULE
    assert exc_info.value.fix == REPEAT_FIX


def test_trimmed_media_id_matches_the_untrimmed_copy():
    segments = _segments()
    segments[0]["media"] = [{"mediaId": "photo-1"}]
    segments[2]["media"] = [{"mediaId": "  photo-1  "}]
    with pytest.raises(SegmentValidationError) as exc_info:
        script_segments.validate_segments(segments, video_type="full_lipsync")
    assert exc_info.value.field == "segments.2.media.0"
    assert exc_info.value.rule == REPEAT_RULE
    assert exc_info.value.fix == REPEAT_FIX


def test_same_string_as_media_id_and_url_is_not_the_same_photo():
    segments = _segments()
    segments[0]["media"] = [{"mediaId": "photo-1"}]
    segments[1]["media"] = [{"url": "photo-1"}, {"url": "https://example.com/b.jpg"}]
    result = script_segments.validate_segments(segments, video_type="full_lipsync")
    assert result["media_count"] == 3


def test_images_mode_rejects_a_repeated_url_when_the_count_would_pass():
    # The hook is 24 words, so three photos meet the images density rule.
    # The third repeats the first, and that rule fires before a later
    # segment that has no media at all.
    segments = _segments()
    segments[0]["media"] = [
        {"url": "https://example.com/a.jpg"},
        {"url": "https://example.com/b.jpg"},
        {"url": "https://example.com/a.jpg"},
    ]
    with pytest.raises(SegmentValidationError) as exc_info:
        script_segments.validate_segments(segments)
    assert exc_info.value.field == "segments.0.media.2"
    assert exc_info.value.rule == REPEAT_RULE
    assert exc_info.value.fix == REPEAT_FIX
