"""Regression tests for issue #638: a request failing segment validation
must get a 4xx naming the field and the fix, never a 500.

The model validator raises SegmentValidationError (a ValueError subclass
carrying field/rule/fix); Pydantic v2 puts the exception object in the
error dict's ctx, so e.errors() is not JSON-serializable and the old
validation_exception_handler threw while rendering the 400, surfacing
as a 500 instead. The same failure hit any ValueError raised by a model
validator (e.g. a lip-sync video without a persona).
"""

from fastapi.testclient import TestClient

from app import asgi
from test.controllers.test_task_segments_request import valid_segments


def _post(payload: dict, auth_headers: dict) -> object:
    client = TestClient(asgi.app, raise_server_exceptions=False)
    return client.post("/api/v1/videos", json=payload, headers=auth_headers)


def test_repeated_photo_returns_400_with_field_rule_and_fix(auth_headers):
    segments = valid_segments()
    segments[1]["media"] = segments[0]["media"]
    response = _post(
        {
            "video_title": "Porto",
            "video_description": "Test description.",
            "video_type": "faceless",
            "segments": segments,
        },
        auth_headers,
    )
    assert response.status_code == 400
    errors = response.json()["body"]
    assert len(errors) == 1
    error = errors[0]["ctx"]["error"]
    assert error["field"] == "segments.1.media.0"
    assert error["rule"] == "the same photo must not repeat"
    assert error["fix"] == "Use a different photo for each media item."


def test_model_validator_value_error_returns_400_not_500(auth_headers):
    response = _post(
        {
            "video_title": "Porto",
            "video_description": "Test description.",
            "video_type": "full_lipsync",
            "video_script": "A script that is long enough to pass every other check.",
        },
        auth_headers,
    )
    assert response.status_code == 400
    assert "requires a persona" in response.text


def test_plain_field_error_still_returns_400(auth_headers):
    response = _post({"video_description": "Test description."}, auth_headers)
    assert response.status_code == 400
    assert response.json()["message"] == "field required"
