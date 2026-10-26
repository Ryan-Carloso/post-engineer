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
    # PostHog person attribution: a real user_id becomes the distinct_id so
    # the funnel breaks down per person instead of one engine pseudo-person.
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
    # Missing, sentinel ("unknown"), empty, or non-string user_id keeps the
    # engine pseudo-person as distinct_id.
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


def test_track_event_does_not_flush_by_default():
    # Hot paths stay batched: flush() blocks until the queue drains, so it
    # is opt-in via immediate=True only.
    with mock.patch.dict(os.environ, {"POSTHOG_API_KEY": "phc_test_key"}):
        with mock.patch("posthog.Posthog") as mock_cls:
            instance = mock_cls.return_value
            analytics.track_event("video_progress", {"percent": 50})
            instance.capture.assert_called_once()
            instance.flush.assert_not_called()


def test_track_event_flushes_when_immediate():
    # A lone event (e.g. a publish failure with nothing after it) would sit
    # in the client's batch queue; immediate=True flushes it right away.
    with mock.patch.dict(os.environ, {"POSTHOG_API_KEY": "phc_test_key"}):
        with mock.patch("posthog.Posthog") as mock_cls:
            instance = mock_cls.return_value
            analytics.track_event(
                "publish_provider_failed", {"provider": "youtube"}, immediate=True
            )
            instance.capture.assert_called_once()
            instance.flush.assert_called_once()


def test_track_event_flush_failure_never_raises():
    # Telemetry must never break the request path, even if flush throws.
    # The event was still captured before the flush attempt.
    with mock.patch.dict(os.environ, {"POSTHOG_API_KEY": "phc_test_key"}):
        with mock.patch("posthog.Posthog") as mock_cls:
            instance = mock_cls.return_value
            instance.flush.side_effect = RuntimeError("flush down")
            # Must not raise.
            analytics.track_event(
                "publish_provider_failed", {"provider": "youtube"}, immediate=True
            )
            instance.capture.assert_called_once()


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


def test_scrub_secret_values_redacts_a_bare_provider_key():
    # A hosted provider key is self-identifying by its prefix, so it leaks even
    # when nothing in the message names the field it belongs to -- e.g. an HTTP
    # error body echoing the rejected key back at us. The key-anchored pattern
    # above cannot see that shape, and these strings reach the task error, the
    # logs, the Discord alerts and PostHog.
    assert "abcdefghijklmnopqrstuvwxyz012345" not in analytics.scrub_secret_values(
        "rejected key sk-or-v1-abcdefghijklmnopqrstuvwxyz012345"
    )
    assert "abcdefghijklmnopqrstuvwxyz012345" not in analytics.scrub_secret_values(
        '{"error":"bad key sk-or-v1-abcdefghijklmnopqrstuvwxyz012345"}'
    )
    # The same shape for OpenAI-style keys, which the TTS path can also surface.
    assert "abcdefghijklmnopqrstuvwxyz012345" not in analytics.scrub_secret_values(
        "rejected key sk-proj-abcdefghijklmnopqrstuvwxyz012345"
    )


def test_scrub_secret_values_keeps_short_sk_words():
    # The prefix alone is not proof of a secret: "sk-" fragments inside ordinary
    # prose or a short id must survive, or the scrubber eats real diagnostics.
    assert analytics.scrub_secret_values("task sk-42 finished") == "task sk-42 finished"
    assert analytics.scrub_secret_values("sketch") == "sketch"


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
    # warm_client() exists so the on_accepted funnel callback (which runs
    # under the task-manager lock) never pays the first-call import +
    # construction cost: it must actually trigger client construction.
    with mock.patch.object(analytics, "_get_client") as get_client:
        analytics.warm_client()
    get_client.assert_called_once_with()


def test_track_event_tags_source_and_environment():
    # Every engine capture carries where it came from (source) and which
    # deployment produced it (environment) so PostHog dashboards can split
    # engine / web-server / web-client / MCP traffic and prod / dev.
    with mock.patch.dict(os.environ, {"POSTHOG_API_KEY": "phc_test_key"}):
        with mock.patch("posthog.Posthog") as mock_cls:
            instance = mock_cls.return_value
            analytics.track_event("video_generation_started", {"slotId": "s1"})
            instance.capture.assert_called_once()
            props = instance.capture.call_args.kwargs["properties"]
            assert props["source"] == "engine"
            assert props["environment"] == "development"
            # Caller properties survive alongside the tags.
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
    # track_ai_request delegates to track_event, so it inherits the tags —
    # pin it so a future bypass of track_event cannot silently drop them.
    # backend=llm also emits the AI-observability $ai_generation event,
    # which carries the same tags (covered in the AI observability tests).
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
    # The diagnostic tail survives...
    assert "Error opening output file" in result
    assert "Could not write header" in result
    # ...while the head banner noise is dropped.
    assert "banner line 20" not in result
    assert "banner line 39" not in result
    # The first line (what failed) is kept as context.
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
    # A very long first line exhausts the tail budget: the message
    # collapses to its last max_chars characters (diagnostic end).
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
        # Uniform ai_request schema the llm paths build (values here are
        # already scrubbed/truncated by the caller, like production).
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
        # A trace id and an explicit null session id (one-shot workload).
        uuid.UUID(props["$ai_trace_id"])
        assert props["$ai_session_id"] is None
        assert props["$ai_provider"] == "openrouter"
        assert props["$ai_model"] == "openrouter/free"
        assert props["$ai_latency"] == 1.5

    def test_generation_never_carries_prompt_input(self):
        # Prompts never leave the machine (module rule, 2026-10-01).
        _, generations = self._capture()
        props = generations[0].kwargs["properties"]
        assert "$ai_input" not in props

    def test_generation_tokens_and_cost_pass_through(self):
        _, generations = self._capture()
        props = generations[0].kwargs["properties"]
        assert props["$ai_input_tokens"] == 10
        assert props["$ai_output_tokens"] == 20
        # Real reported spend (OpenRouter) passes through and is marked as
        # provider-reported so PostHog keeps it instead of estimating.
        assert props["$ai_total_cost_usd"] == 0.0004
        assert props["$ai_cost_passthrough"] is True

    def test_generation_omits_unknown_counters_never_fake_zero(self):
        # A provider that reports nothing contributes no counter at all —
        # a 0 would lie in the dashboards (engine nullable-metrics rule).
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
        # Same for a provider without a resolvable model name.
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
        # response_preview is the ai_request property: scrubbed and capped
        # at the call site. $ai_output_choices (the full model output) is
        # deliberately not sent for the same reason.
        _, generations = self._capture(response_preview="script body")
        props = generations[0].kwargs["properties"]
        assert props["response_preview"] == "script body"
        assert "$ai_output_choices" not in props

    def test_generation_carries_origin_tags_and_engine_distinct_id(self):
        # LLM calls carry no user context at the llm.py call site, so the
        # generation lands on the engine pseudo-person, tagged like every
        # engine event.
        _, generations = self._capture()
        call = generations[0]
        props = call.kwargs["properties"]
        assert call.kwargs["distinct_id"] == "post-engineer-engine"
        assert props["source"] == "engine"
        assert props["environment"] == "development"

    def test_modal_backend_emits_no_generation_event(self):
        # Modal renders are not LLM generations.
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
                # Must not raise and must not construct the client.
                analytics.track_ai_request(self._llm_props())
                mock_cls.assert_not_called()

    def test_capture_failure_never_raises(self):
        with mock.patch.dict(os.environ, {"POSTHOG_API_KEY": "phc_test_key"}):
            with mock.patch("posthog.Posthog") as mock_cls:
                instance = mock_cls.return_value
                instance.capture.side_effect = RuntimeError("posthog down")
                # Must not raise: a downed PostHog must not break generation.
                analytics.track_ai_request(self._llm_props())
        events = [call.kwargs["event"] for call in instance.capture.call_args_list]
        # Both events were attempted (mocks record even a raising call);
        # the point is the side_effect propagated to nobody.
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
