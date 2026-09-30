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
    record = {"message": "boom", "exception": None, "level": SimpleNamespace(name="ERROR")}
    record.update(record_overrides)
    return SimpleNamespace(record=record)


class PostHogSinkTests(unittest.TestCase):
    def test_plain_error_record_forwards_message(self):
        with patch("app.asgi.track_event") as track_event:
            asgi._loguru_posthog_sink(_message())
        track_event.assert_called_once()
        event_name, properties = track_event.call_args[0]
        assert event_name == "$exception"
        assert properties["message"] == "boom"
        assert "exception_type" not in properties

    def test_record_with_exception_forwards_exception_details(self):
        error = ValueError("kaput")
        with patch("app.asgi.track_event") as track_event:
            asgi._loguru_posthog_sink(_message(exception=(ValueError, error, None)))
        track_event.assert_called_once()
        event_name, properties = track_event.call_args[0]
        assert event_name == "$exception"
        assert properties["exception_type"] == "ValueError"
        assert properties["exception_message"] == "kaput"

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
