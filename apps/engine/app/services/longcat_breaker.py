"""Persisted circuit breaker for the LongCat Modal GPU backend.

STRATEGY (Ryan, 2026-10 — LongCat→faceless fallback addenda):

- "workspace disabled" (HTTP 404 with the gateway's
  ``modal-http: workspace … is disabled`` body, production 2026-10-19) is
  NOT actionable: credits return only on the 1st of next month. Once the
  breaker trips the engine STOPS calling LongCat entirely — every faced
  post goes straight to faceless with the user warning — until the first
  day of the next month (UTC), when the next attempt is allowed. If the
  backend still answers "disabled", the breaker trips again for another
  month.
- The state PERSISTS across restarts: a small JSON marker under the
  engine's storage volume (utils.storage_dir). Memory-only state would
  re-enable the billing-dead backend after every redeploy.
- The informative PostHog event is DEDUPLICATED (max 1/day): the same file
  records the last day an event was emitted, so one outage does not spam
  one telemetry row per video.

Pure module — no Modal/network I/O; the timestamp inputs are parameters,
so the resume-on-the-1st behavior is testable without time mocking.
"""

from __future__ import annotations

import json
import os
import tempfile
import threading
from datetime import datetime, timezone
from typing import Any

from loguru import logger

_MARKER_LOCK = threading.Lock()


def _state_path(root: str | None = None) -> str:
    if root is not None:
        return os.path.join(root, "longcat-disabled-counter.json")
    from app.utils import utils

    return os.path.join(utils.storage_dir(), "longcat-disabled-counter.json")


def _read_state(path: str) -> dict[str, Any]:
    try:
        with open(path, encoding="utf-8") as handle:
            raw = json.load(handle)
        return raw if isinstance(raw, dict) else {}
    except OSError:
        return {}
    except ValueError:
        # Corrupt marker: treat as closed rather than hard-disabling the GPU
        # backend forever — the next trip rewrites it.
        return {}


def _write_state(path: str, state: dict[str, Any]) -> bool:
    """Atomic replace (temp file + rename) so a crash cannot leave a torn JSON.

    In-process concurrent batch slots share ``_MARKER_LOCK`` around
    read/mutate/write. Cross-process last-writer-wins can still emit twice.
    """
    directory = os.path.dirname(path) or "."
    try:
        os.makedirs(directory, exist_ok=True)
        fd, tmp = tempfile.mkstemp(prefix=".longcat-breaker-", suffix=".tmp", dir=directory)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                json.dump(state, handle)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(tmp, path)
        except Exception:
            try:
                os.unlink(tmp)
            except OSError:
                pass
            raise
        return True
    except OSError:
        # A read-only storage volume must never disable the pipeline's
        # delivery: log-free fallback to in-memory-only behavior (closed).
        return False


def _first_of_next_month(now: datetime) -> str:
    if now.month == 12:
        resume = datetime(now.year + 1, 1, 1, tzinfo=now.tzinfo or timezone.utc)
    else:
        resume = datetime(now.year, now.month + 1, 1, tzinfo=now.tzinfo or timezone.utc)
    return resume.isoformat()


def trip(now: datetime, reason: str, root: str | None = None) -> bool:
    """Open the breaker until the first day of the next month (UTC).

    Returns True when the marker landed on the persisted volume; a write
    failure logs nothing here (the caller already logged the outage) and
    the breaker simply behaves closed until the next trip.
    """
    until = _first_of_next_month(now)
    with _MARKER_LOCK:
        state = _read_state(_state_path(root))
        state["until"] = until
        state["reason"] = reason[:200]
        return _write_state(_state_path(root), state)


def is_open(now: datetime, root: str | None = None) -> bool:
    """True while the persisted resume date is in the future."""
    state = _read_state(_state_path(root))
    until_raw = state.get("until")
    if not isinstance(until_raw, str) or not until_raw:
        return False
    try:
        until = datetime.fromisoformat(until_raw)
    except ValueError:
        return False
    if until.tzinfo is None:
        until = until.replace(tzinfo=timezone.utc)
    return now < until


def should_emit_event(now: datetime, root: str | None = None) -> bool:
    """Dedup gate for the informative event: at most ONE per calendar day."""
    path = _state_path(root)
    today = now.date().isoformat()
    with _MARKER_LOCK:
        state = _read_state(path)
        if state.get("last_event_day") == today:
            return False
        state["last_event_day"] = today
        if not _write_state(path, state):
            logger.warning(
                "longcat breaker event marker did not persist (marker write failed)"
            )
            # Fail-closed: a lost daily marker must not spam the informative
            # event. should_alert fail-opens on the same failure (duplicates
            # beat silence). Both branches are pinned in tests.
            return False
        return True


#---------------
# TEST_ACCOUNT_USER_IDS — comma-separated user ids (engine .env). Only
# test accounts get the month-long breaker: nobody can act on their
# outage (non-actionable → quiet, deduplicated, month-long pause). REAL
# users never trip it — every release of Modal credits must reach them,
# so the backend is always attempted first and the outage stays LOUD
# ($exception via the ERROR sink + a Discord alert) for the operator.
#---------------
def test_account_user_ids() -> set[str]:
    raw = os.environ.get("TEST_ACCOUNT_USER_IDS", "")
    return {part.strip().lower() for part in raw.split(",") if part.strip()}


def is_test_account(user_id: str) -> bool:
    """True when this user's outage is non-actionable (breaker-eligible)."""
    if not user_id:
        return False
    return user_id.strip().lower() in test_account_user_ids()


#---------------

def should_alert(now: datetime, root: str | None = None) -> bool:
    """Dedup gate for the REAL-user loud alert: at most ONE per hour."""
    path = _state_path(root)
    hour_bucket = now.strftime("%Y-%m-%dT%H")
    with _MARKER_LOCK:
        state = _read_state(path)
        if state.get("last_alert_hour", "") == hour_bucket:
            return False
        state["last_alert_hour"] = hour_bucket
        if not _write_state(path, state):
            logger.warning(
                "longcat breaker alert marker did not persist (marker write failed)"
            )
            return True
        return True
