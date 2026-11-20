"""Direct tests for the extracted persist_state_update helper.

The helper moved into its own module so state.py stays under the size
ratchet; these tests import it from its new home so mutation coverage
follows the code (mutmut rule in AGENTS.md).
"""

from unittest.mock import Mock, patch

import pytest
from loguru import logger

from app.services import state_persistence
from app.services.state_persistence import (
    RETRY_DELAYS_SECONDS,
    RETRY_WINDOW_SECONDS,
    persist_state_update,
)


class FakeClock:
    def __init__(self, attempt_seconds: float = 0.0) -> None:
        self.now = 1000.0
        self.sleeps: list[float] = []
        self.attempt_seconds = attempt_seconds

    def monotonic(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.sleeps.append(seconds)
        self.now += seconds


class FlakyBackend:
    """Fails the first *failures* writes, then succeeds; tracks lock hold."""

    def __init__(self, clock: FakeClock, failures: int) -> None:
        self.clock = clock
        self.failures = failures
        self.calls: list[tuple[str, dict[str, object]]] = []
        self.in_write = False

    def update_task(self, task_id: str, **kwargs: object) -> None:
        self.in_write = True
        try:
            self.calls.append((task_id, kwargs))
            self.clock.now += self.clock.attempt_seconds
            if len(self.calls) <= self.failures:
                raise ConnectionError(f"SSL EOF #{len(self.calls)}")
        finally:
            self.in_write = False


@pytest.fixture
def clock():
    fake = FakeClock()
    with patch.object(state_persistence, "time", fake):
        yield fake


@pytest.fixture
def records():
    captured: list[dict] = []
    handler = logger.add(lambda m: captured.append(m.record))
    yield captured
    logger.remove(handler)


def test_persist_success_returns_true_without_waiting(clock):
    backend = Mock()
    assert persist_state_update(backend, "t-1", progress=5) is True
    backend.update_task.assert_called_once_with("t-1", progress=5)
    assert clock.sleeps == []


@pytest.mark.parametrize("failures", [1, 2, 3, 4])
def test_persist_backs_off_until_the_backend_recovers(clock, failures):
    backend = FlakyBackend(clock, failures)
    assert persist_state_update(backend, "t-1", state=1, progress=100) is True
    assert len(backend.calls) == failures + 1
    assert all(call == ("t-1", {"state": 1, "progress": 100}) for call in backend.calls)
    assert clock.sleeps == list(RETRY_DELAYS_SECONDS[:failures])


def test_persist_retry_window_outlasts_a_multi_second_outage(clock):
    outage_ends_at = clock.now + 10.0

    class OutageBackend:
        def update_task(self, task_id: str, **kwargs: object) -> None:
            if clock.now < outage_ends_at:
                raise ConnectionError("SSL EOF")

    assert persist_state_update(OutageBackend(), "t-1", progress=5) is True
    assert sum(clock.sleeps) >= 10.0


def test_persist_never_sleeps_inside_update_task(clock):
    backend = FlakyBackend(clock, failures=3)
    original_sleep = clock.sleep

    def sleep_outside_write(seconds: float) -> None:
        assert backend.in_write is False
        original_sleep(seconds)

    clock.sleep = sleep_outside_write
    assert persist_state_update(backend, "t-1", progress=5) is True
    assert len(clock.sleeps) == 3


def test_persist_gives_up_after_every_delay_and_logs_loudly(clock, records):
    backend = FlakyBackend(clock, failures=100)
    assert persist_state_update(backend, "t-1", progress=5) is False
    assert len(backend.calls) == len(RETRY_DELAYS_SECONDS) + 1
    assert clock.sleeps == list(RETRY_DELAYS_SECONDS)
    assert sum(clock.sleeps) <= RETRY_WINDOW_SECONDS
    warnings = [r for r in records if r["level"].name == "WARNING"]
    errors = [r for r in records if r["level"].name == "ERROR"]
    assert len(warnings) == len(RETRY_DELAYS_SECONDS) + 1
    assert len(errors) == 1
    assert "t-1" in errors[0]["message"]
    assert f"after {len(RETRY_DELAYS_SECONDS) + 1} attempts" in errors[0]["message"]
    assert f"SSL EOF #{len(RETRY_DELAYS_SECONDS) + 1}" in errors[0]["message"]


def test_persist_stops_retrying_when_the_next_wait_passes_the_window(clock, records):
    clock.attempt_seconds = 6.0
    backend = FlakyBackend(clock, failures=100)
    assert persist_state_update(backend, "t-1", progress=5) is False
    assert clock.sleeps == [1.0, 2.0]
    assert len(backend.calls) == 3
    elapsed_before_last_attempt = sum(clock.sleeps) + 2 * clock.attempt_seconds
    assert elapsed_before_last_attempt <= RETRY_WINDOW_SECONDS
    errors = [r for r in records if r["level"].name == "ERROR"]
    assert "after 3 attempts" in errors[0]["message"]


def test_persist_starts_a_wait_that_ends_exactly_at_the_window(clock):
    clock.attempt_seconds = 0.0
    backend = FlakyBackend(clock, failures=100)
    with patch.object(state_persistence, "RETRY_WINDOW_SECONDS", 3.0):
        assert persist_state_update(backend, "t-1", progress=5) is False
    assert clock.sleeps == [1.0, 2.0]


def test_persist_never_raises(clock):
    backend = Mock()
    backend.update_task.side_effect = RuntimeError("down")
    assert persist_state_update(backend, "t-1", progress=1) is False
