"""Admit batch slot generation through the shared task manager.

Direct video creation and direct orphan redispatch already call
``TaskManager.add_task``, so ``max_concurrent_tasks`` counts them.
Batch slots use that same counter. A slot the manager cannot accept
on this tick stays pending for a later tick: it is not failed and it
is not refunded. A slot the manager accepts — started now, or queued
because a concurrent caller took the last running slot — is claimed
by the caller, so the next tick does not dispatch it again.

One tick admits only the free running slots. Overflow stays pending
instead of filling ``max_queued_tasks``. Those rows are retried on a
later tick, when a completion has freed a running slot.
"""

from __future__ import annotations

import inspect
from typing import Any

from app.controllers.manager.base_manager import TaskQueueFullError


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


def pending_read_limit(manager: Any | None = None) -> int:
    """Page size for one pending-slot read: the free running slots."""
    if manager is None:
        # Lazy: the controller builds the process-wide manager at import,
        # which must not run while this module is imported.
        from app.controllers.v1.video import task_manager

        manager = task_manager
    return free_running_slots(manager)


def pending_page_limit(limit: int | None, manager: Any | None = None) -> int:
    """Non-negative page size. ``None`` reads the live free capacity.

    A bool is not a limit (``bool`` is an ``int`` subclass). A full
    manager pages zero rows.
    """
    if limit is None:
        limit = pending_read_limit(manager)
    if isinstance(limit, bool) or not isinstance(limit, int) or limit < 0:
        return 0
    return limit


def _accepts_limit(pending: Any) -> bool:
    """True when ``pending(now, limit=...)`` is a real parameter.

    Test doubles written as ``pending_slots(self, now)`` predate the
    page argument. A ``**kwargs`` parameter counts as accepting it.
    """
    try:
        signature = inspect.signature(pending)
    except (TypeError, ValueError):
        return False
    if "limit" in signature.parameters:
        return True
    return any(
        parameter.kind == inspect.Parameter.VAR_KEYWORD
        for parameter in signature.parameters.values()
    )


def read_pending_slots(store: Any, now: Any, limit: int) -> list[dict[str, Any]]:
    """Pending rows for this tick, never more than ``limit``.

    ``limit <= 0`` does not touch the store: the manager is full and
    the rows stay pending. The result is sliced even when the store
    ignores ``limit``, so a double that returns every row cannot
    admit more than the free running slots.
    """
    if limit <= 0:
        return []
    pending = store.pending_slots
    if _accepts_limit(pending):
        rows = pending(now, limit=limit)
    else:
        rows = pending(now)
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
) -> None:
    """Hand one batch pipeline to the shared manager.

    Raises ``SlotDeferred`` when the manager rejects the task. Returning
    means the task is running or queued; the caller claims the slot.
    """
    try:
        manager.add_task(
            start,
            task_id=task_id,
            params=params,
            stop_at="video",
            on_accepted=on_accepted,
        )
    except TaskQueueFullError as exc:
        raise SlotDeferred(str(exc)) from exc
