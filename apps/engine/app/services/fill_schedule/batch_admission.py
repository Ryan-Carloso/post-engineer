"""Admit batch slot generation through the shared task manager.

Direct video creation and direct orphan redispatch already call
``TaskManager.add_task``, so ``max_concurrent_tasks`` counts them.
Batch slots take a running slot on that same counter, or they wait.
A slot that cannot start on this tick stays pending: it is not queued,
not failed, and not refunded. The caller claims a slot only after the
worker has been started, so the next tick does not dispatch it again.

One tick admits the free running slots, plus voiceover slots bound for
the Modal CPU worker. Batch dispatch never fills
``max_queued_tasks``. Those rows are retried on a later tick, when a
completion has freed a running slot. Direct ``add_task`` still queues.
"""

from __future__ import annotations

from typing import Any


class SlotDeferred(Exception):
    """The shared task manager cannot accept this slot on this tick."""


def free_running_slots(manager: Any) -> int:
    """How many tasks ``manager`` can start immediately.

    Zero when the running cap is already met. Never negative.
    """
    free = int(manager.max_concurrent_tasks) - int(manager.current_tasks)
    if free < 1:
        return 0
    return free


def pending_page_limit(limit: int) -> int:
    """Non-negative page size chosen by the caller.

    A bool is not a limit (``bool`` is an ``int`` subclass); anything that
    is not a non-negative int pages zero rows. Never reads the task manager.
    """
    if isinstance(limit, bool) or not isinstance(limit, int) or limit < 0:
        return 0
    return limit


def read_pending_slots(store: Any, now: Any, limit: int) -> list[dict[str, Any]]:
    """Pending rows for this tick, never more than ``limit``.

    ``limit <= 0`` does not touch the store: the manager is full and
    the rows stay pending. The result is sliced even when the store
    ignores ``limit``, so a double that returns every row cannot
    admit more than the free running slots.
    """
    if limit <= 0:
        return []
    rows = store.pending_slots(now, limit=limit)
    if not isinstance(rows, list):
        return []
    return [row for row in rows if isinstance(row, dict)][:limit]


def submit_batch_start(
    manager: Any,
    start: Any,
    *,
    task_id: str,
    params: Any,
    on_accepted: Any | None = None,
    before_start: Any | None = None,
) -> None:
    """Start one batch pipeline on a free running slot.

    Reserves the slot first. ``before_start`` then runs outside the
    manager lock (the task-row write). If that call raises, the
    reservation is released and the exception propagates: no worker,
    and the running cap is not held. ``on_accepted`` runs after the
    write and before the worker, also outside the lock.

    Raises ``SlotDeferred`` when no running slot is free. Batch dispatch
    does not queue. Returning means the worker was started; the caller
    claims the slot.
    """
    reservation = manager.try_reserve_running()
    if reservation is None:
        raise SlotDeferred("the task manager has no free running slot")
    try:
        if before_start is not None:
            before_start()
        if on_accepted is not None:
            on_accepted()
    except Exception:
        reservation.release()
        raise
    reservation.start(start, task_id=task_id, params=params, stop_at="video")
