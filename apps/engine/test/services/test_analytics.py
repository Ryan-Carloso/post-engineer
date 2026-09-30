"""Tests for the PostHog analytics helper.

- track_event() never raises; telemetry must never break the engine.
- No-op when POSTHOG_API_KEY is missing.
- Secret-bearing property keys are redacted before capture.
- Never logs PII, credentials, or raw request bodies.
"""

from __future__ import annotations

import os
from unittest import mock

import pytest

from app.services import analytics


@pytest.fixture(autouse=True)
def _reset():
    analytics.reset_for_testing()
    yield
    analytics.reset_for_testing()


def test_track_event_captures_with_properties():
    with mock.patch.dict(os.environ, {"POSTHOG_API_KEY": "phc_test_key"}):
        with mock.patch("posthog.Posthog") as mock_cls:
            instance = mock_cls.return_value
            analytics.track_event("video_generation_started", {"slotId": "s1"})
            instance.capture.assert_called_once()
            call = instance.capture.call_args
            assert call.kwargs["event"] == "video_generation_started"
            assert call.kwargs["properties"]["slotId"] == "s1"


def test_track_event_noop_when_key_missing():
    with mock.patch.dict(os.environ, {}, clear=True):
        with mock.patch("posthog.Posthog") as mock_cls:
            # Should not raise and should not construct the client.
            analytics.track_event("video_generation_started", {"slotId": "s1"})
            mock_cls.assert_not_called()


def test_track_event_redacts_secrets():
    with mock.patch.dict(os.environ, {"POSTHOG_API_KEY": "phc_test_key"}):
        with mock.patch("posthog.Posthog") as mock_cls:
            instance = mock_cls.return_value
            analytics.track_event(
                "video_generated",
                {"slotId": "s1", "password": "secret123", "apiKey": "sk-x"},
            )
            props = instance.capture.call_args.kwargs["properties"]
            assert props["password"] == "[redacted]"
            assert props["apiKey"] == "[redacted]"
            assert "secret123" not in str(props)
            assert "sk-x" not in str(props)


def test_track_event_never_raises_on_capture_failure():
    with mock.patch.dict(os.environ, {"POSTHOG_API_KEY": "phc_test_key"}):
        with mock.patch("posthog.Posthog") as mock_cls:
            instance = mock_cls.return_value
            instance.capture.side_effect = RuntimeError("posthog down")
            # Must not raise.
            analytics.track_event("video_generated", {"slotId": "s1"})


def test_track_event_never_raises_on_init_failure():
    with mock.patch.dict(os.environ, {"POSTHOG_API_KEY": "phc_test_key"}):
        with mock.patch(
            "posthog.Posthog",
            side_effect=RuntimeError("init failed"),
        ):
            analytics.track_event("video_generated", {"slotId": "s1"})
