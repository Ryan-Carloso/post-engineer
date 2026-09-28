"""Tests for the loguru -> Bugsink (Sentry-compatible) bridge in app.asgi.

The sentry SDK's stdlib logging integration never sees loguru records, so
app.asgi installs a loguru sink that forwards ERROR+ records to Bugsink.
These tests exercise that sink directly; under pytest the real sentry init
(and therefore the sink installation) is always skipped.
"""

import unittest
from types import SimpleNamespace
from unittest.mock import patch

from app import asgi


def _message(**record_overrides):
    record = {"message": "boom", "exception": None, "level": SimpleNamespace(name="ERROR")}
    record.update(record_overrides)
    return SimpleNamespace(record=record)


class BugsinkSinkTests(unittest.TestCase):
    def test_plain_error_record_forwards_message(self):
        with (
            patch("sentry_sdk.capture_message") as capture_message,
            patch("sentry_sdk.capture_exception") as capture_exception,
        ):
            asgi._loguru_bugsink_sink(_message())
        capture_message.assert_called_once_with("boom", level="error")
        capture_exception.assert_not_called()

    def test_record_with_exception_forwards_the_exception(self):
        error = ValueError("kaput")
        with (
            patch("sentry_sdk.capture_message") as capture_message,
            patch("sentry_sdk.capture_exception") as capture_exception,
        ):
            asgi._loguru_bugsink_sink(_message(exception=(ValueError, error, None)))
        capture_exception.assert_called_once_with(error)
        capture_message.assert_not_called()

    def test_sink_never_raises(self):
        class BadMessage:
            @property
            def record(self):  # noqa: D102 - test double
                raise RuntimeError("nope")

        # A throwing sentry client and a broken record must both be swallowed:
        # telemetry must never break the app.
        with patch("sentry_sdk.capture_message", side_effect=RuntimeError("sentry down")):
            asgi._loguru_bugsink_sink(BadMessage())
            asgi._loguru_bugsink_sink(_message())
