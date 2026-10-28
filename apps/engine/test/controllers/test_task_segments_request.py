"""Segments contract on TaskVideoRequest: valid segments join into video_script,
invalid segments fail at request validation, before any task row is created."""

import pytest
from pydantic import ValidationError

from app.models.schema import TaskVideoRequest

HOOK = (
    "Stop wasting your trip stuck in a ninety minute line for the original dish "
    "when a better table is waiting nearby for you today."
)
BODY = (
    "Locals skip the famous house and walk two minutes to a smaller kitchen where "
    "the sauce recipe has not changed since nineteen fifty three and the cook still "
    "greets every table by name before the first plate arrives at your table tonight."
)
CTA = "Save this video before your next trip to Porto."


def valid_segments():
    return [
        {"kind": "hook", "text": HOOK},
        {"kind": "body", "text": BODY},
        {"kind": "cta", "text": CTA},
    ]


def test_valid_segments_join_into_video_script():
    request = TaskVideoRequest(video_subject="Porto", segments=valid_segments())
    assert request.video_script == f"{HOOK}\n\n{BODY}\n\n{CTA}"


def test_segments_without_hook_first_is_rejected():
    segments = valid_segments()
    segments[0], segments[1] = segments[1], segments[0]
    with pytest.raises(ValidationError, match="segments"):
        TaskVideoRequest(video_subject="Porto", segments=segments)


def test_segments_with_short_body_is_rejected():
    segments = valid_segments()
    segments[1]["text"] = "Short body text here."
    with pytest.raises(ValidationError, match="segments"):
        TaskVideoRequest(video_subject="Porto", segments=segments)


def test_supplied_script_mismatching_segments_is_rejected():
    with pytest.raises(ValidationError, match="video_script"):
        TaskVideoRequest(
            video_subject="Porto",
            video_script="A completely different script.",
            segments=valid_segments(),
        )


def test_request_without_segments_is_unchanged():
    request = TaskVideoRequest(video_subject="Porto", video_script="script")
    assert request.video_script == "script"
    assert request.segments is None


def test_empty_segments_list_is_rejected():
    with pytest.raises(ValidationError, match="segments"):
        TaskVideoRequest(video_subject="Porto", segments=[])


def test_media_shape_only_in_phase_one():
    segments = valid_segments()
    segments[1]["media"] = {"mediaId": "abc", "url": "https://example.com/x.jpg"}
    with pytest.raises(ValidationError, match="media"):
        TaskVideoRequest(video_subject="Porto", segments=segments)
