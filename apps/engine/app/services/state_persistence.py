"""Terminal task-state writes with one retry.

Extracted from state.py so that file stays under the size ratchet.
Re-exported as ``app.services.state.persist_state_update``; tests and
callers keep importing it from there.
"""

from loguru import logger

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.services.state import BaseState


def persist_state_update(backend: "BaseState", task_id: str, **kwargs: object) -> bool:
    """Write a task-state update that must not be silently lost, retrying once.

    With the memory backend update_task() effectively cannot fail; with a
    network backend (Supabase) every write is an HTTP request that can raise
    (timeout, 5xx, rotated key). A lost terminal write leaves the row
    PROCESSING forever — the web polls with no failure recorded and no
    refund, which is exactly the failure mode persistence was added to
    eliminate. Retry once, then log loudly and report the loss. Never
    raises: a persistence failure must not mask the task outcome it was
    recording.

    Cancelled tasks (app.services.task_cancellation) are the one deliberate
    exception: update_task() no-ops for them and this helper still returns
    True. The row is gone on purpose, so the dropped write is not a
    persistence failure and is neither retried nor logged.
    """
    try:
        backend.update_task(task_id, **kwargs)
        return True
    except Exception as exc:  # noqa: BLE001 - one retry before giving up
        logger.warning(f"task state write failed for {task_id}, retrying: {exc}")
    try:
        backend.update_task(task_id, **kwargs)
        return True
    except Exception as exc:  # noqa: BLE001 - loud, then report the loss
        logger.error(
            f"task state write permanently failed for {task_id}; "
            f"the task row may be stale: {exc}"
        )
        return False
