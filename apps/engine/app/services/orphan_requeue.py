"""Boot-time triage for tasks orphaned by an engine restart.

Historically ``SupabaseTaskState.reconcile_orphaned_tasks`` failed every
non-terminal orphan and refunded its token. That is correct for genuinely
dead work, but two cases can recover by themselves:

- an orphan in a generation stage that belongs to a batch slot: the slot
  goes back to ``pending`` and the next fill-schedule tick re-dispatches it.
  Batch slots are prepaid at schedule creation, so no billing change;
- an orphan in a generation stage with no slot whose full job payload was
  persisted on the video_generations row (issue #205): direct_redispatch
  marks the task during this review and restarts the pipeline after boot
  has published ``app.services.state.state``, through the shared task
  manager — also prepaid, no billing change;
Everything else keeps the historical fail+refund. Batch requeue is
idempotent across boots: a crash between triage and the tick leaves the
slot ``pending`` (re-triage skips it) or the task non-terminal in a
generation stage (re-triage retries it, bounded by MAX_AUTO_REQUEUES).
A direct redispatch clears ``stage``, so a crash before the pipeline
writes a new generation stage is fail+refunded instead of retried.
"""

from __future__ import annotations

from typing import Any

from loguru import logger

from app.services.analytics import track_event
from app.services.fill_schedule.constants import (
    SLOT_GENERATING,
    SLOT_PENDING,
    SLOT_READY,
)

# Decisions returned by classify_orphan().
REQUEUE = "requeue"
FAIL = "fail"

# Pipeline phases (task.py _mark) whose GPU work can simply restart from
# zero. ``custom_audio``/``download`` never come from _mark (they are
# failure-only stages) but are pre-publish phases all the same.
GENERATION_STAGES = frozenset(
    {
        "script",
        "terms",
        "audio",
        "custom_audio",
        "subtitle",
        "materials",
        "download",
        "music_mood",
        "render",
    }
)

# Slot states whose ownership belongs to the tick, never to the triage:
# failing+refunding one of these would race the scheduler.
_TICK_OWNED_SLOT_STATES = frozenset({SLOT_PENDING, SLOT_READY})

# After this many boot requeues, a task is assumed to deterministically
# crash the process (e.g. OOM at render): stop regenerating it on every
# boot and let the fail+refund path settle it (the batch reconciler fails
# the slot and refunds the prepaid cost).
MAX_AUTO_REQUEUES = 3


def slot_store_or_none() -> Any | None:
    """Build the fill-schedule slot store for orphan triage, if configured.

    The engine runs without fill-schedule when the Supabase env is absent;
    triage then degrades to the historical fail+refund for every orphan.
    Imported lazily: ScheduleStore never imports app.services.state, but
    keeping the import here (instead of module top-level) keeps state.py
    importable in the smallest entry points.
    """
    try:
        from app.services.fill_schedule.store import ScheduleStore

        return ScheduleStore()
    except RuntimeError as exc:
        logger.debug(
            f"orphan triage: slot store unavailable ({exc}); requeue disabled"
        )
        return None


def classify_orphan(data: dict[str, Any]) -> str:
    """Decide what a boot orphan needs, from its last persisted stage."""
    stage = data.get("stage")
    if stage in GENERATION_STAGES and data.get("slot_id"):
        return REQUEUE
    return FAIL


def triage_requeue(state: Any, slot_store: Any, task_id: str, data: dict[str, Any]) -> bool:
    """Claim a requeueable orphan for the fill-schedule tick.

    Returns True when the orphan was claimed (the caller must NOT
    fail+refund it): either the generating slot was reset to pending, or
    the slot is already tick-owned (pending/ready). Returns False when
    there is no usable slot, so the caller falls through to fail+refund.
    """
    if slot_store is None:
        return False
    slot_id = data.get("slot_id")
    if not isinstance(slot_id, str) or not slot_id:
        return False
    slot = slot_store.get_slot(slot_id)
    if not isinstance(slot, dict):
        return False
    status = slot.get("status")
    if status == SLOT_GENERATING:
        # Only generation-stage orphans restart from zero.
        if data.get("stage") not in GENERATION_STAGES:
            return False
        requeue_count = int(data.get("requeue_count") or 0) + 1
        if requeue_count > MAX_AUTO_REQUEUES:
            return False
        slot_store.update_slot(slot_id, status=SLOT_PENDING)
        state.update_task(task_id, auto_requeued=True, requeue_count=requeue_count)
        track_event(
            "task_auto_requeued",
            {
                "task_id": task_id,
                "slot_id": slot_id,
                "stage": str(data.get("stage") or "unknown"),
                "requeue_count": requeue_count,
            },
        )
        logger.info(
            f"orphan {task_id} requeued: slot {slot_id} back to pending (attempt {requeue_count})"
        )
        return True
    if status in _TICK_OWNED_SLOT_STATES:
        # Already pending/ready: the tick owns it now; never fail+refund.
        return True
    return False


def triage_orphan(
    state: Any, task_id: str, data: dict[str, Any], slot_store: Any
) -> bool:
    """Run the boot triage for one orphaned task.

    Returns True when the orphan was claimed and the caller must NOT
    fail+refund it: the slot was requeued for the tick or a direct
    generation was marked for restart. Returns False when the caller
    falls through to the historical fail+refund.
    """
    if triage_requeue(state, slot_store, task_id, data):
        return True
    # Lazy on purpose: direct_redispatch imports this module's stage
    # constants, so a top-level import would cycle while this module
    # is still loading. The import does not pull in the pipeline.
    from app.services.direct_redispatch import triage_redispatch_direct

    if triage_redispatch_direct(state, task_id, data):
        return True
    return False
