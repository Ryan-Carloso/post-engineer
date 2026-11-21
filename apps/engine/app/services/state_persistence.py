"""Terminal task-state writes retried with backoff inside a fixed window.

Extracted from state.py so that file stays under the size ratchet.
Re-exported as ``app.services.state.persist_state_update``; tests and
callers keep importing it from there.
"""

import time

from loguru import logger

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.services.state import BaseState

RETRY_DELAYS_SECONDS = (1.0, 2.0, 4.0, 8.0)
RETRY_WINDOW_SECONDS = 20.0


def persist_state_update(backend: "BaseState", task_id: str, **kwargs: object) -> bool:
    """Write a task-state update that must not be silently lost, retrying with backoff.

    With the memory backend update_task() effectively cannot fail; with a
    network backend (Supabase) every write is an HTTP request that can raise
    (timeout, 5xx, TLS EOF, rotated key). A lost terminal write leaves the row
    PROCESSING until the stuck-job auto-refund — the web polls with no
    failure recorded. The session's connect retries cover about one second,
    so this helper waits RETRY_DELAYS_SECONDS between attempts to outlast a
    short Supabase outage. It starts no new wait that would end after
    RETRY_WINDOW_SECONDS. The waits happen between update_task() calls, so
    the backend lock is never held while sleeping and each call keeps the
    lock-hold bound of ``worst_case_seconds``. After the last attempt it logs
    loudly and reports the loss. Never raises: a persistence failure must not
    mask the task outcome it was recording.

    Cancelled tasks (app.services.task_cancellation) are the one deliberate
    exception: update_task() no-ops for them and this helper still returns
    True. The row is gone on purpose, so the dropped write is not a
    persistence failure and is neither retried nor logged.
    """
    deadline = time.monotonic() + RETRY_WINDOW_SECONDS
    attempts = 0
    last_error: Exception | None = None
    for delay in (0.0, *RETRY_DELAYS_SECONDS):
        if delay > 0:
            if time.monotonic() + delay > deadline:
                break
            time.sleep(delay)
        attempts += 1
        try:
            backend.update_task(task_id, **kwargs)
            return True
        except Exception as exc:
            last_error = exc
            logger.warning(f"task state write failed for {task_id} (attempt {attempts}): {exc}")
    logger.error(
        f"task state write permanently failed for {task_id} after {attempts} "
        f"attempts; the task row may be stale: {last_error}"
    )
    return False
