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


def test_scrub_secret_values_redacts_key_value_pairs():
    assert analytics.scrub_secret_values("api_key=sk-12345") == "api_key=[redacted]"
    assert analytics.scrub_secret_values("token: abc123") == "token=[redacted]"
    assert analytics.scrub_secret_values("Bearer xyz789") == "Bearer [redacted]"


def test_scrub_secret_values_redacts_quoted_shapes():
    # Model output and SDK errors echo config blobs as JSON or Python dict
    # reprs — the scrubber must catch those shapes too, not just bare
    # key=value pairs.
    assert "sk-secret-123" not in analytics.scrub_secret_values(
        '{"api_key": "sk-secret-123"}'
    )
    assert "sk-secret-123" not in analytics.scrub_secret_values(
        "{'api_key': 'sk-secret-123'}"
    )
    assert "abc123" not in analytics.scrub_secret_values('{"token": "abc123"}')
    assert "hunter2" not in analytics.scrub_secret_values(
        "{'password': 'hunter2'}"
    )
    # Bearer inside a JSON body was already caught; pin it.
    assert "sk-abc" not in analytics.scrub_secret_values(
        '{"authorization": "Bearer sk-abc"}'
    )


def test_scrub_secret_values_leaves_clean_text():
    text = "Connection failed: timeout after 30s"
    assert analytics.scrub_secret_values(text) == text


def test_default_posthog_host_const_is_https_url():
    # Self-host seam: the constant is the single fallback every engine
    # telemetry path uses when POSTHOG_HOST is not set.
    assert analytics.DEFAULT_POSTHOG_HOST.startswith("https://")


def test_get_client_uses_default_host_when_env_unset():
    with mock.patch.dict(os.environ, {"POSTHOG_API_KEY": "phc_test_key"}, clear=True):
        with mock.patch("posthog.Posthog") as mock_cls:
            analytics.track_event("video_generated", {"slotId": "s1"})
            _, kwargs = mock_cls.call_args
            assert kwargs["host"] == analytics.DEFAULT_POSTHOG_HOST


def test_get_client_prefers_posthog_host_env():
    with mock.patch.dict(
        os.environ,
        {"POSTHOG_API_KEY": "phc_test_key", "POSTHOG_HOST": "https://eu.i.posthog.com"},
        clear=True,
    ):
        with mock.patch("posthog.Posthog") as mock_cls:
            analytics.track_event("video_generated", {"slotId": "s1"})
            _, kwargs = mock_cls.call_args
            assert kwargs["host"] == "https://eu.i.posthog.com"


def test_track_event_keeps_token_usage_counters_intact():
    # prompt_tokens/completion_tokens/total_tokens are legitimate analytics
    # counters — the "token" secret-key substring must not redact them,
    # while a real secret-bearing key still is.
    with mock.patch.dict(os.environ, {"POSTHOG_API_KEY": "phc_test_key"}):
        with mock.patch("posthog.Posthog") as mock_cls:
            instance = mock_cls.return_value
            analytics.track_event(
                "ai_request",
                {
                    "prompt_tokens": 12,
                    "completion_tokens": 34,
                    "total_tokens": 46,
                    "api_key": "sk-should-be-redacted",
                },
            )
            props = instance.capture.call_args.kwargs["properties"]
            assert props["prompt_tokens"] == 12
            assert props["completion_tokens"] == 34
            assert props["total_tokens"] == 46
            assert props["api_key"] == "[redacted]"


def test_track_event_exemption_only_applies_to_numeric_values():
    # The token-counter exemption is scoped to actual numbers: a secret is
    # never an int, so a non-numeric value under an exempt name is still
    # redacted.
    with mock.patch.dict(os.environ, {"POSTHOG_API_KEY": "phc_test_key"}):
        with mock.patch("posthog.Posthog") as mock_cls:
            instance = mock_cls.return_value
            analytics.track_event(
                "ai_request",
                {
                    "prompt_tokens": 12,
                    "total_tokens": "sk-should-be-redacted",
                },
            )
            props = instance.capture.call_args.kwargs["properties"]
            assert props["prompt_tokens"] == 12
            assert props["total_tokens"] == "[redacted]"


def test_warm_client_invokes_get_client():
    # The FastAPI startup hook warms the PostHog client so the on_accepted
    # funnel callback (running under the task-manager lock) never pays the
    # posthog import + client construction on its first track_event.
    with mock.patch.object(analytics, "_get_client") as get_client:
        analytics.warm_client()
    get_client.assert_called_once_with()
