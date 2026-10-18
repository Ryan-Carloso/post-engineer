"""Tests for the exhausted hook-retry decision.

Once the persona hook retries are exhausted, only a structurally broken
hook (past PERSONA_HOOK_HARD_FAIL_SECONDS) fails the task. Anything
shorter ships best-effort — a short hook is LLM variance, never the
user's fault.
"""

import pytest

from app.models.schema import PersonaParams, VideoParams
from app.services import task as task_service
from app.services.persona_hook import (
    PERSONA_HOOK_HARD_FAIL_SECONDS,
    resolve_exhausted_hook,
)


def test_hard_fail_threshold_is_fifteen_seconds():
    assert PERSONA_HOOK_HARD_FAIL_SECONDS == 15.0


def test_hook_past_the_hard_fail_threshold_raises():
    with pytest.raises(ValueError, match="must end between 8 and 12 seconds"):
        resolve_exhausted_hook(
            end_seconds=PERSONA_HOOK_HARD_FAIL_SECONDS + 0.01,
            window_min=8.0,
            window_max=12.0,
            attempts=3,
        )


def test_short_hook_ships_best_effort():
    from loguru import logger

    messages = []
    handler_id = logger.add(lambda message: messages.append(message), level="WARNING")
    try:
        assert (
            resolve_exhausted_hook(
                end_seconds=4.74,
                window_min=8.0,
                window_max=12.0,
                attempts=3,
            )
            is None
        )
    finally:
        logger.remove(handler_id)
    assert any("shipping best effort" in message for message in messages)
    assert any("4.74" in message for message in messages)


def test_hook_between_window_max_and_hard_fail_ships_best_effort():
    assert (
        resolve_exhausted_hook(
            end_seconds=13.5,
            window_min=8.0,
            window_max=12.0,
            attempts=3,
        )
        is None
    )


def test_hook_exactly_at_the_hard_fail_threshold_ships():
    # The threshold itself is not "past" it.
    assert (
        resolve_exhausted_hook(
            end_seconds=PERSONA_HOOK_HARD_FAIL_SECONDS,
            window_min=8.0,
            window_max=12.0,
            attempts=3,
        )
        is None
    )


def test_hard_fail_threshold_stays_above_the_quality_window():
    # If the quality window ever grows past the hard-fail threshold, the
    # "ship best effort" band disappears and every mistimed hook fails.
    assert task_service.PERSONA_HOOK_MAX_SECONDS <= PERSONA_HOOK_HARD_FAIL_SECONDS


def _persona_params() -> VideoParams:
    return VideoParams(
        video_subject="viagem",
        video_aspect="9:16",
        persona=PersonaParams(name="Ana", voice_id="calm", photo_url="https://x.test/foto.png"),
    )


def test_regenerate_fitting_hook_emits_retry_event():
    """Each retry attempt reports measurements to PostHog.

    measured_seconds/hook_words/word_cap per attempt is what lets us see
    whether the LLM honors the word cap — no VPS logs needed.
    """
    from unittest.mock import patch

    from app.services import persona_hook

    params = _persona_params()
    long_hook = " ".join(["word"] * 60) + "."
    script = f"{long_hook}\n\nBody paragraph here."

    with (
        patch.object(persona_hook, "track_event") as track,
        patch.object(persona_hook.llm, "generate_script", return_value="Short hook."),
    ):
        result = persona_hook._regenerate_fitting_hook("task-1", params, script, 24.94)

    assert "Short hook." in result
    assert track.call_count == 1
    event_name, props = track.call_args[0]
    assert event_name == "persona_hook_retry"
    assert props["task_id"] == "task-1"
    assert props["measured_seconds"] == 24.94
    assert props["hook_words"] == 60
    # 60 words * 10s target / 24.94s measured -> ~24 word cap
    assert props["word_cap"] == 24
    # Only ids and numbers travel — no script text (user content).
    assert all(not isinstance(v, str) or len(v) < 20 for v in props.values())


def test_best_effort_ship_emits_posthog_event():
    """Shipping a mistimed hook reports persona_hook_best_effort."""
    from unittest.mock import patch

    from app.services import task as task_service
    from app.services.task import _ensure_persona_hook_fits

    params = _persona_params()
    script = "Short hook.\n\nBody paragraph here."
    subs = [(1, "00:00:00,000 --> 00:00:04,740", "Short hook.")]

    with (
        patch.object(task_service.subtitle, "file_to_subtitles", return_value=subs),
        patch.object(task_service.llm, "generate_script", return_value="Short hook."),
        patch.object(task_service, "generate_audio", return_value=("a.mp3", 30, object())),
        patch.object(task_service, "generate_subtitle", return_value="s.srt"),
        patch.object(task_service, "track_event") as track,
        patch("app.services.persona_hook.track_event"),
    ):
        result = _ensure_persona_hook_fits(
            "task-1", params, script, "audio.mp3", 40, object(), "subtitle.srt"
        )

    assert result[0] == script  # shipped, not failed
    best_effort = [c for c in track.call_args_list if c[0][0] == "persona_hook_best_effort"]
    assert len(best_effort) == 1
    assert best_effort[0][0][1]["task_id"] == "task-1"
    assert best_effort[0][0][1]["hook_end_seconds"] == 4.74
