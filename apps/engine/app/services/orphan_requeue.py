"""Boot-time triage for tasks orphaned by an engine restart.

Historically ``SupabaseTaskState.reconcile_orphaned_tasks`` failed every
non-terminal orphan and refunded its token. That is correct for genuinely
dead work, but two cases can recover by themselves:

- an orphan in a generation stage that belongs to a batch slot: the slot
  goes back to ``pending`` and the next fill-schedule tick re-dispatches it.
  Batch slots are prepaid at schedule creation, so no billing change;
- an orphan in stage ``publish`` with a finished video archived in R2: the
  publish already ran (``publish_results`` present) or can run now — failing
  it would refund a video that is sitting in storage ready to be posted.

Everything else keeps the historical fail+refund. All handlers are
idempotent across boots: a crash between triage and the tick leaves the
slot ``pending`` (re-triage skips it) or the task non-terminal (re-triage
retries it).
"""

from __future__ import annotations

import os
from typing import Any

from loguru import logger

from app.models import const
from app.models.publish import PublishParams
from app.services import task_publish
from app.services.analytics import track_event
from app.services.fill_schedule.constants import SLOT_GENERATING, SLOT_PENDING

# Decisions returned by classify_orphan().
REQUEUE = "requeue"
COMPLETE_PUBLISH = "complete_publish"
MARK_COMPLETE = "mark_complete"
FAIL = "fail"

PUBLISH_STAGE = "publish"

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
_TICK_OWNED_SLOT_STATES = frozenset({SLOT_PENDING, "ready"})


def classify_orphan(data: dict[str, Any]) -> str:
    """Decide what a boot orphan needs, from its last persisted stage."""
    stage = data.get("stage")
    if stage == PUBLISH_STAGE:
        if data.get("publish_results") is not None:
            # The publish already ran; only the terminal COMPLETE write was
            # lost. Backfill completion instead of failing a delivered video.
            return MARK_COMPLETE
        if data.get("video_storage_path"):
            return COMPLETE_PUBLISH
        return FAIL
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
        slot_store.update_slot(slot_id, status=SLOT_PENDING)
        requeue_count = int(data.get("requeue_count") or 0) + 1
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


def mark_complete_orphan(state: Any, task_id: str, data: dict[str, Any]) -> None:
    """Backfill COMPLETE for an orphan whose publish already ran."""
    state.update_task(task_id, state=const.TASK_STATE_COMPLETE, progress=100)
    state._settle_orphan_completed(task_id)
    track_event(
        "orphan_marked_complete",
        {"task_id": task_id, "flow": str(data.get("flow") or "unknown")},
    )
    logger.info(f"orphan {task_id} already published pre-crash; marked complete")


def complete_publish_orphan(state: Any, task_id: str, data: dict[str, Any]) -> bool:
    """Finish the publish step for an orphan with a video archived in R2.

    Batch orphans: the in-pipeline publish is a no-op for batch (publishing
    happens from the ready slot), so marking complete lets the batch
    reconciler advance the slot and the slot publisher post it at slot time.
    Direct orphans: rebuild the publish plan persisted at dispatch and run
    the publish now — publish_videos reads the bytes from R2 itself.

    Returns True when the orphan was completed. Returns False when it cannot
    be completed here (caller falls through to fail+refund). Lets
    PublishFailedError propagate: publish_videos already marked the task
    FAILED with the real upstream error, and the caller settles billing.
    """
    object_path = data.get("video_storage_path")
    if not isinstance(object_path, str) or not object_path:
        return False
    slot_id = data.get("slot_id")
    if isinstance(slot_id, str) and slot_id:
        state.update_task(
            task_id,
            state=const.TASK_STATE_COMPLETE,
            progress=100,
            # The slot publisher only needs basenames; the bytes come from
            # R2 via video_storage_path. Local paths are gone with the old
            # process, so the R2 object path stands in (documented here so a
            # future reader does not try to open() it).
            videos=[object_path],
        )
        track_event(
            "orphan_publish_completed",
            {"task_id": task_id, "slot_id": slot_id, "flow": "batch"},
        )
        logger.info(
            f"orphan {task_id}: video archived, marked complete; "
            f"slot {slot_id} will publish at slot time"
        )
        return True
    raw_params = data.get("publish_params")
    if not isinstance(raw_params, dict):
        return False
    publish = PublishParams.model_validate(raw_params)
    task_publish.publish_videos(task_id, publish, [os.path.basename(object_path)])
    state.update_task(task_id, state=const.TASK_STATE_COMPLETE, progress=100)
    state._settle_orphan_completed(task_id)
    track_event(
        "orphan_publish_completed",
        {"task_id": task_id, "flow": str(data.get("flow") or "unknown")},
    )
    logger.info(f"orphan {task_id}: boot publish completed")
    return True
