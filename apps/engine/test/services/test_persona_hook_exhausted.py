"""Tests for the exhausted hook-retry decision.

Once the persona hook retries are exhausted, only a structurally broken
hook (past PERSONA_HOOK_HARD_FAIL_SECONDS) fails the task. Anything
shorter ships best-effort — a short hook is LLM variance, never the
user's fault.
"""

import pytest

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
