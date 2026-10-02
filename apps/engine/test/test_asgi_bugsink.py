"""Tests for the loguru -> PostHog bridge in app.asgi.

app.asgi installs a loguru sink that forwards ERROR+ records to PostHog
as $exception events. These tests exercise that sink directly; under pytest
the real PostHog init (and therefore the sink installation) is always skipped.
"""

import unittest
from types import SimpleNamespace
from unittest.mock import patch

from app import asgi


def _message(**record_overrides):
    record = {
        "message": "boom",
        "exception": None,
        "extra": {},
        "level": SimpleNamespace(name="ERROR"),
    }
    record.update(record_overrides)
    return SimpleNamespace(record=record)


class PostHogSinkTests(unittest.TestCase):
    def test_plain_error_record_forwards_message(self):
        with patch("app.asgi.track_event") as track_event:
            asgi._loguru_posthog_sink(_message())
        track_event.assert_called_once()
        event_name, properties = track_event.call_args[0]
        assert event_name == "$exception"
        assert properties["$exception_message"] == "boom"
        assert "$exception_type" not in properties

    def test_plain_error_record_includes_exception_list(self):
        # PostHog error tracking requires $exception_list on every $exception
        # event; without it ingestion flags $cymbal_errors ("missing field
        # $exception_list") and the event never groups in Error Tracking.
        with patch("app.asgi.track_event") as track_event:
            asgi._loguru_posthog_sink(_message())
        _, properties = track_event.call_args[0]
        exc_list = properties["$exception_list"]
        assert isinstance(exc_list, list) and len(exc_list) == 1
        assert exc_list[0]["value"] == "boom"

    def test_record_with_exception_forwards_exception_details(self):
        error = ValueError("kaput")
        with patch("app.asgi.track_event") as track_event:
            asgi._loguru_posthog_sink(_message(exception=(ValueError, error, None)))
        track_event.assert_called_once()
        event_name, properties = track_event.call_args[0]
        assert event_name == "$exception"
        assert properties["$exception_type"] == "ValueError"
        assert properties["$exception_message"] == "kaput"

    def test_record_with_exception_builds_exception_list_from_tuple(self):
        error = ValueError("kaput")
        with patch("app.asgi.track_event") as track_event:
            asgi._loguru_posthog_sink(_message(exception=(ValueError, error, None)))
        _, properties = track_event.call_args[0]
        exc_list = properties["$exception_list"]
        assert len(exc_list) == 1
        assert exc_list[0]["type"] == "ValueError"
        assert exc_list[0]["value"] == "kaput"

    def test_bound_task_context_forwarded_as_properties(self):
        # HttpException logs via logger.bind(task_id=..., http_status_code=...):
        # the sink must surface them as filterable properties so the reason
        # is visible without parsing the flat message.
        with patch("app.asgi.track_event") as track_event:
            asgi._loguru_posthog_sink(
                _message(
                    message="HttpException: 404, task-1, req-9: task not found",
                    extra={"task_id": "task-1", "http_status_code": 404},
                )
            )
        _, properties = track_event.call_args[0]
        assert properties["task_id"] == "task-1"
        assert properties["http_status_code"] == "404"
        assert properties["$exception_list"][0]["type"] == "HttpException"

    def test_unlisted_extras_are_not_forwarded(self):
        with patch("app.asgi.track_event") as track_event:
            asgi._loguru_posthog_sink(
                _message(extra={"task_id": "task-1", "secret_blob": "x"})
            )
        _, properties = track_event.call_args[0]
        assert properties["task_id"] == "task-1"
        assert "secret_blob" not in properties

    def test_sink_never_raises(self):
        class BadMessage:
            @property
            def record(self):  # noqa: D102 - test double
                raise RuntimeError("nope")

        # A throwing PostHog client and a broken record must both be swallowed:
        # telemetry must never break the app.
        with patch("app.asgi.track_event", side_effect=RuntimeError("posthog down")):
            asgi._loguru_posthog_sink(BadMessage())
            asgi._loguru_posthog_sink(_message())
