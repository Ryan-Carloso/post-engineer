"""Tests for the PostHog analytics helper.

- track_event() never raises; telemetry must never break the engine.
- No-op when POSTHOG_API_KEY is missing.
- Secret-bearing property keys are redacted before capture.
- Never logs PII, credentials, or raw request bodies.
"""

from __future__ import annotations

import os
import uuid
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


def test_track_event_uses_user_id_as_distinct_id():
    with mock.patch.dict(os.environ, {"POSTHOG_API_KEY": "phc_test_key"}):
        with mock.patch("posthog.Posthog") as mock_cls:
            instance = mock_cls.return_value
            analytics.track_event(
                "video_generation_started",
                {"user_id": "user-123", "task_id": "t1"},
            )
            call = instance.capture.call_args
            assert call.kwargs["distinct_id"] == "user-123"


@pytest.mark.parametrize("user_id", ["unknown", "", None, 12345])
def test_track_event_falls_back_to_engine_distinct_id(user_id):
    with mock.patch.dict(os.environ, {"POSTHOG_API_KEY": "phc_test_key"}):
        with mock.patch("posthog.Posthog") as mock_cls:
            instance = mock_cls.return_value
            analytics.track_event(
                "video_generation_started",
                {"user_id": user_id, "task_id": "t1"},
            )
            call = instance.capture.call_args
            assert call.kwargs["distinct_id"] == "post-engineer-engine"


def test_track_event_noop_when_key_missing():
    with mock.patch.dict(os.environ, {}, clear=True):
        with mock.patch("posthog.Posthog") as mock_cls:
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


def test_track_event_does_not_flush_by_default():
    with mock.patch.dict(os.environ, {"POSTHOG_API_KEY": "phc_test_key"}):
        with mock.patch("posthog.Posthog") as mock_cls:
            instance = mock_cls.return_value
            analytics.track_event("video_progress", {"percent": 50})
            instance.capture.assert_called_once()
            instance.flush.assert_not_called()


def test_track_event_flushes_when_immediate():
    with mock.patch.dict(os.environ, {"POSTHOG_API_KEY": "phc_test_key"}):
        with mock.patch("posthog.Posthog") as mock_cls:
            instance = mock_cls.return_value
            analytics.track_event(
                "publish_provider_failed", {"provider": "youtube"}, immediate=True
            )
            instance.capture.assert_called_once()
            instance.flush.assert_called_once()


def test_track_event_flush_failure_never_raises():
    with mock.patch.dict(os.environ, {"POSTHOG_API_KEY": "phc_test_key"}):
        with mock.patch("posthog.Posthog") as mock_cls:
            instance = mock_cls.return_value
            instance.flush.side_effect = RuntimeError("flush down")
            analytics.track_event(
                "publish_provider_failed", {"provider": "youtube"}, immediate=True
            )
            instance.capture.assert_called_once()


def test_track_event_never_raises_on_capture_failure():
    with mock.patch.dict(os.environ, {"POSTHOG_API_KEY": "phc_test_key"}):
        with mock.patch("posthog.Posthog") as mock_cls:
            instance = mock_cls.return_value
            instance.capture.side_effect = RuntimeError("posthog down")
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


def test_scrub_secret_values_redacts_a_bare_provider_key():
    assert "abcdefghijklmnopqrstuvwxyz012345" not in analytics.scrub_secret_values(
        "rejected key sk-or-v1-abcdefghijklmnopqrstuvwxyz012345"
    )
    assert "abcdefghijklmnopqrstuvwxyz012345" not in analytics.scrub_secret_values(
        '{"error":"bad key sk-or-v1-abcdefghijklmnopqrstuvwxyz012345"}'
    )
    assert "abcdefghijklmnopqrstuvwxyz012345" not in analytics.scrub_secret_values(
        "rejected key sk-proj-abcdefghijklmnopqrstuvwxyz012345"
    )


def test_scrub_secret_values_keeps_short_sk_words():
    assert analytics.scrub_secret_values("task sk-42 finished") == "task sk-42 finished"
    assert analytics.scrub_secret_values("sketch") == "sketch"


def test_scrub_secret_values_redacts_quoted_shapes():
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
    assert "sk-abc" not in analytics.scrub_secret_values(
        '{"authorization": "Bearer sk-abc"}'
    )


def test_scrub_secret_values_leaves_clean_text():
    text = "Connection failed: timeout after 30s"
    assert analytics.scrub_secret_values(text) == text


def test_default_posthog_host_const_is_https_url():
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
    with mock.patch.object(analytics, "_get_client") as get_client:
        analytics.warm_client()
    get_client.assert_called_once_with()


def test_track_event_tags_source_and_environment():
    with mock.patch.dict(os.environ, {"POSTHOG_API_KEY": "phc_test_key"}):
        with mock.patch("posthog.Posthog") as mock_cls:
            instance = mock_cls.return_value
            analytics.track_event("video_generation_started", {"slotId": "s1"})
            instance.capture.assert_called_once()
            props = instance.capture.call_args.kwargs["properties"]
            assert props["source"] == "engine"
            assert props["environment"] == "development"
            assert props["slotId"] == "s1"


def test_track_event_tags_environment_production_when_app_env_production():
    with mock.patch.dict(
        os.environ, {"POSTHOG_API_KEY": "phc_test_key", "APP_ENV": "production"}
    ):
        with mock.patch("posthog.Posthog") as mock_cls:
            instance = mock_cls.return_value
            analytics.track_event("video_generated", {})
            props = instance.capture.call_args.kwargs["properties"]
            assert props["source"] == "engine"
            assert props["environment"] == "production"


def test_track_ai_request_carries_origin_tags():
    with mock.patch.dict(os.environ, {"POSTHOG_API_KEY": "phc_test_key"}):
        with mock.patch("posthog.Posthog") as mock_cls:
            instance = mock_cls.return_value
            analytics.track_ai_request({"backend": "llm", "success": True})
            captures = instance.capture.call_args_list
            assert [call.kwargs["event"] for call in captures] == [
                "ai_request",
                "$ai_generation",
            ]
            props = captures[0].kwargs["properties"]
            assert props["source"] == "engine"
            assert props["environment"] == "development"


def test_track_event_caller_properties_cannot_override_origin_tags():
    with mock.patch.dict(os.environ, {"POSTHOG_API_KEY": "phc_test_key"}):
        with mock.patch("posthog.Posthog") as mock_cls:
            instance = mock_cls.return_value
            analytics.track_event(
                "video_generated", {"source": "spoofed", "environment": "production"}
            )
            props = instance.capture.call_args.kwargs["properties"]
            assert props["source"] == "engine"
            assert props["environment"] == "development"


def _ffmpeg_style_error(home: str) -> str:
    banner = "\n".join(
        f"ffmpeg version 6.1 Copyright (c) 2000-2023 banner line {i}"
        for i in range(40)
    )
    return (
        banner
        + f"\nInput #0, mov,mp4,m4a,3gp,3g2,mj2, from '{home}/videos/input.mp4':"
        + "\n[mp4 @ 0x7f8b1c00] Could not write header: Permission denied"
        + f"\nError opening output file {home}/videos/output.mp4."
    )


def test_scrub_error_text_keeps_diagnostic_tail_of_multiline_tool_error():
    home = os.path.expanduser("~")
    result = analytics.scrub_error_text(_ffmpeg_style_error(home), max_chars=200)
    assert "Error opening output file" in result
    assert "Could not write header" in result
    assert "banner line 20" not in result
    assert "banner line 39" not in result
    assert result.startswith("ffmpeg version 6.1")


def test_scrub_error_text_removes_home_directory_paths():
    home = os.path.expanduser("~")
    result = analytics.scrub_error_text(
        f"failed to generate audio: file not found: {home}/voices/clone.wav"
    )
    assert home not in result
    assert "<home>/clone.wav" in result


def test_scrub_error_text_collapses_unknown_absolute_paths():
    result = analytics.scrub_error_text(
        "boom: /var/lib/modal/output.mp4 missing"
    )
    assert "/var/lib/modal" not in result
    assert "<path>/output.mp4" in result


def test_scrub_error_text_still_redacts_secrets():
    result = analytics.scrub_error_text('request failed {"api_key": "sk-secret-123"}')
    assert "sk-secret-123" not in result
    assert "api_key" in result


def test_scrub_error_text_leaves_short_single_line_unchanged():
    text = "Connection failed: timeout after 30s"
    assert analytics.scrub_error_text(text) == text


def test_scrub_error_text_keeps_tail_of_long_single_line():
    text = "x" * 600 + "final diagnostic detail"
    result = analytics.scrub_error_text(text, max_chars=100)
    assert result.endswith("final diagnostic detail")
    assert len(result) <= 100


def test_scrub_error_text_long_first_line_keeps_tail():
    text = "B" * 600 + "\nfinal diagnostic detail"
    result = analytics.scrub_error_text(text, max_chars=100)
    assert result.endswith("final diagnostic detail")
    assert len(result) <= 100
    assert "B" * 100 not in result


class TestAIObservabilityGeneration:
    """The $ai_generation event derived from ai_request (backend=llm).

    Pins the standard AI-observability shape (trace id, latency, tokens,
    cost) and the two deliberate deviations: prompts are never sent and
    the session id is explicitly null.
    """

    def _llm_props(self, **overrides):
        props = {
            "backend": "llm",
            "provider": "openrouter",
            "model": "openrouter/free",
            "primary_provider": "groq",
            "fallback_used": True,
            "duration_ms": 1500,
            "success": True,
            "error": "",
            "response_chars": 300,
            "response_preview": "script body",
            "prompt_tokens": 10,
            "completion_tokens": 20,
            "total_tokens": 30,
            "cost_usd": 0.0004,
        }
        props.update(overrides)
        return props

    def _capture(self, **props_overrides):
        with mock.patch.dict(os.environ, {"POSTHOG_API_KEY": "phc_test_key"}):
            with mock.patch("posthog.Posthog") as mock_cls:
                instance = mock_cls.return_value
                analytics.track_ai_request(self._llm_props(**props_overrides))
                events = [call.kwargs["event"] for call in instance.capture.call_args_list]
                generation_calls = [
                    call
                    for call in instance.capture.call_args_list
                    if call.kwargs["event"] == "$ai_generation"
                ]
        return events, generation_calls

    def test_llm_call_emits_standard_generation_event(self):
        events, generations = self._capture()
        assert events == ["ai_request", "$ai_generation"]
        assert len(generations) == 1
        props = generations[0].kwargs["properties"]
        uuid.UUID(props["$ai_trace_id"])
        assert props["$ai_session_id"] is None
        assert props["$ai_provider"] == "openrouter"
        assert props["$ai_model"] == "openrouter/free"
        assert props["$ai_latency"] == 1.5

    def test_generation_never_carries_prompt_input(self):
        _, generations = self._capture()
        props = generations[0].kwargs["properties"]
        assert "$ai_input" not in props

    def test_generation_tokens_and_cost_pass_through(self):
        _, generations = self._capture()
        props = generations[0].kwargs["properties"]
        assert props["$ai_input_tokens"] == 10
        assert props["$ai_output_tokens"] == 20
        assert props["$ai_total_cost_usd"] == 0.0004
        assert props["$ai_cost_passthrough"] is True

    def test_generation_omits_unknown_counters_never_fake_zero(self):
        _, generations = self._capture(
            prompt_tokens=0,
            completion_tokens=0,
            total_tokens=0,
            cost_usd=None,
            model="",
        )
        props = generations[0].kwargs["properties"]
        assert "$ai_input_tokens" not in props
        assert "$ai_output_tokens" not in props
        assert "$ai_total_cost_usd" not in props
        assert "$ai_cost_passthrough" not in props
        assert "$ai_model" not in props

    def test_failed_generation_carries_scrubbed_error_not_preview(self):
        _, generations = self._capture(
            success=False,
            error="call failed: token=[redacted]",
            response_preview="",
            response_chars=0,
            prompt_tokens=0,
            completion_tokens=0,
            total_tokens=0,
            cost_usd=None,
        )
        props = generations[0].kwargs["properties"]
        assert props["$ai_is_error"] is True
        assert props["$ai_error"] == "call failed: token=[redacted]"
        assert "response_preview" not in props

    def test_successful_generation_carries_response_preview_not_full_text(self):
        _, generations = self._capture(response_preview="script body")
        props = generations[0].kwargs["properties"]
        assert props["response_preview"] == "script body"
        assert "$ai_output_choices" not in props

    def test_generation_carries_origin_tags_and_engine_distinct_id(self):
        _, generations = self._capture()
        call = generations[0]
        props = call.kwargs["properties"]
        assert call.kwargs["distinct_id"] == "post-engineer-engine"
        assert props["source"] == "engine"
        assert props["environment"] == "development"

    def test_modal_backend_emits_no_generation_event(self):
        with mock.patch.dict(os.environ, {"POSTHOG_API_KEY": "phc_test_key"}):
            with mock.patch("posthog.Posthog") as mock_cls:
                instance = mock_cls.return_value
                analytics.track_ai_request(
                    {"backend": "modal", "operation": "lipsync", "success": True}
                )
        events = [call.kwargs["event"] for call in instance.capture.call_args_list]
        assert events == ["ai_request"]

    def test_noop_without_api_key(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            with mock.patch("posthog.Posthog") as mock_cls:
                analytics.track_ai_request(self._llm_props())
                mock_cls.assert_not_called()

    def test_capture_failure_never_raises(self):
        with mock.patch.dict(os.environ, {"POSTHOG_API_KEY": "phc_test_key"}):
            with mock.patch("posthog.Posthog") as mock_cls:
                instance = mock_cls.return_value
                instance.capture.side_effect = RuntimeError("posthog down")
                analytics.track_ai_request(self._llm_props())
        events = [call.kwargs["event"] for call in instance.capture.call_args_list]
        assert events == ["ai_request", "$ai_generation"]


def test_nonempty_error_reason_falls_back_to_type_name():
    assert analytics.nonempty_error_reason("", "OSError") == "OSError"
    assert analytics.nonempty_error_reason("   ", "ValueError") == "ValueError"
    assert analytics.nonempty_error_reason("disk gone", "OSError") == "disk gone"


def test_track_ai_request_failure_error_never_empty():
    with mock.patch.dict(os.environ, {"POSTHOG_API_KEY": "phc_test_key"}):
        with mock.patch("posthog.Posthog") as mock_cls:
            instance = mock_cls.return_value
            analytics.track_ai_request(
                {
                    "backend": "llm",
                    "success": False,
                    "error": "",
                    "provider": "groq",
                    "model": "x",
                    "primary_provider": "groq",
                    "fallback_used": False,
                    "duration_ms": 1,
                    "response_chars": 0,
                    "response_preview": "",
                    "prompt_tokens": 0,
                    "completion_tokens": 0,
                    "total_tokens": 0,
                }
            )
            props = instance.capture.call_args_list[0].kwargs["properties"]
            assert props["error"]
            assert props["success"] is False


def test_subtitle_event_props_carries_default_position_from_params():
    from types import SimpleNamespace

    assert analytics.subtitle_event_props(SimpleNamespace(subtitle_position="center", custom_position=50.0)) == {
        "subtitle_position": "center",
    }


def test_subtitle_event_props_carries_custom_height_only_with_custom():
    from types import SimpleNamespace

    assert analytics.subtitle_event_props(SimpleNamespace(subtitle_position="custom", custom_position=20)) == {
        "subtitle_position": "custom",
        "subtitle_custom_position": 20,
    }
    assert analytics.subtitle_event_props(SimpleNamespace(subtitle_position="top", custom_position=20)) == {
        "subtitle_position": "top",
    }


def test_subtitle_event_props_reads_task_row_keys():
    assert analytics.subtitle_event_props({"subtitle_position": "custom", "subtitle_custom_position": 20}) == {
        "subtitle_position": "custom",
        "subtitle_custom_position": 20,
    }
    assert analytics.subtitle_event_props({"subtitle_position": "bottom"}) == {"subtitle_position": "bottom"}


def test_subtitle_event_props_omits_blank_or_missing_position():
    from types import SimpleNamespace

    assert analytics.subtitle_event_props(SimpleNamespace(subtitle_position="", custom_position=20)) == {}
    assert analytics.subtitle_event_props(SimpleNamespace()) == {}
    assert analytics.subtitle_event_props({}) == {}
