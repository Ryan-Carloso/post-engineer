"""Per-task pipeline cancellation registry (issue #447).

The schedule cancel path (DELETE /api/schedule) removes generating slots
and refunds them without spending GPU twice, but the batch worker keeps
walking paid stages after the charge is gone. This registry lets the
engine stop that worker at the next stage boundary.

Single-process by design: the worker thread lives in this process, so an
in-memory mark is enough. A restart kills the worker with the process;
orphan reconcile handles the rows left in a non-terminal state.

`delete_task` in app/services/state.py marks the task cancelled before
removing the row, so every delete path (engine DELETE endpoint, queue
overflow, schedule cancel) detaches the worker and its later progress
writes. `update_task` in every backend no-ops for a cancelled task, so a
deleted row can never be recreated by a late progress write.

Bounded: the FIFO cap keeps cancelled ids from growing without limit,
but it bounds memory only: evicting an id ten thousand cancels later
forgets the mark, so a still-running worker resumes and its update_task
can recreate the row.
"""

import threading
from collections import deque
from collections.abc import Callable


MAX_CANCELLED_TASKS = 10000

_CANCELLED_IDS: set[str] = set()
_CANCELLED_ORDER: deque[str] = deque()
_CANCEL_LOCK = threading.Lock()


def request_cancel(task_id: str) -> None:
    """Mark ``task_id`` cancelled. Idempotent; safe from any thread."""
    with _CANCEL_LOCK:
        if task_id in _CANCELLED_IDS:
            return
        if len(_CANCELLED_ORDER) >= MAX_CANCELLED_TASKS:
            _CANCELLED_IDS.discard(_CANCELLED_ORDER.popleft())
        _CANCELLED_IDS.add(task_id)
        _CANCELLED_ORDER.append(task_id)


def is_cancelled(task_id: str) -> bool:
    """True when ``task_id`` was marked cancelled and not yet forgotten."""
    with _CANCEL_LOCK:
        return task_id in _CANCELLED_IDS


def forget(task_id: str) -> None:
    """Clear the cancel mark for ``task_id``. No-op when not marked."""
    with _CANCEL_LOCK:
        _CANCELLED_IDS.discard(task_id)


def cancel_and_delete(task_id: str, delete: Callable[[], object]) -> None:
    """Mark ``task_id`` cancelled, then run the backend ``delete``.

    The mark goes first so a running worker detaches before its next
    progress write could recreate the row. If ``delete`` raises, the row
    still exists: the mark is cleared so the live task stays updatable
    (a lingering mark would no-op every later write and strand the row in
    PROCESSING), and the error propagates to the caller.
    """
    request_cancel(task_id)
    try:
        delete()
    except Exception:
        forget(task_id)
        raise


def reset() -> None:
    """Clear every mark. Test isolation only — never call in production."""
    with _CANCEL_LOCK:
        _CANCELLED_IDS.clear()
        _CANCELLED_ORDER.clear()
