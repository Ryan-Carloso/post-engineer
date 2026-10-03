"""Guard: no test may ever emit real PostHog events.

Regression test for the 2026-10-03 incident: the engine suite ran on a dev
machine with the production POSTHOG_API_KEY set, and tests that did not mock
telemetry captured thousands of real events (fake user_ids like "user-1").

The autouse fixture in test/conftest.py replaces posthog.Posthog with a mock
for every test. These tests pin that the interception holds even with a key
in the environment.
"""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from app.services import analytics


def test_track_event_with_api_key_set_never_builds_real_client(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Even with a production-looking key in the environment, the client
    # track_event captures through must be the fixture's mock — never a
    # real SDK instance that would hit the network.
    monkeypatch.setenv("POSTHOG_API_KEY", "phc_guard_probe_key")
    analytics.reset_for_testing()
    analytics.track_event("guard_probe", {"user_id": "u1"})
    client = analytics._get_client()
    assert isinstance(client, MagicMock)
    client.capture.assert_called_once()
    assert client.capture.call_args.kwargs["event"] == "guard_probe"


def test_track_ai_request_with_api_key_set_never_builds_real_client(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # track_ai_request delegates to track_event — same guard must apply.
    monkeypatch.setenv("POSTHOG_API_KEY", "phc_guard_probe_key")
    analytics.reset_for_testing()
    analytics.track_ai_request({"backend": "llm", "success": True})
    client = analytics._get_client()
    assert isinstance(client, MagicMock)
    client.capture.assert_called_once()
    assert client.capture.call_args.kwargs["event"] == "ai_request"
