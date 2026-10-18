"""Boot-time triage for tasks orphaned by an engine restart.

Historically ``SupabaseTaskState.reconcile_orphaned_tasks`` failed every
non-terminal orphan and refunded its token. That is correct for genuinely
dead work, but three cases can recover by themselves:

- an orphan in a generation stage that belongs to a batch slot: the slot
  goes back to ``pending`` and the next fill-schedule tick re-dispatches it.
  Batch slots are prepaid at schedule creation, so no billing change;
- an orphan in a generation stage with no slot whose full job payload was
  persisted on the video_generations row (issue #205): direct_redispatch
  marks the task during this review and restarts the pipeline after boot
  has published ``app.services.state.state``, through the shared task
  manager — also prepaid, no billing change;
- an orphan in stage ``publish`` with a finished video archived in R2: the
  publish already ran (``publish_results`` present) or can run now — failing
  it would refund a video that is sitting in storage ready to be posted.

Everything else keeps the historical fail+refund. Batch requeue is
idempotent across boots: a crash between triage and the tick leaves the
slot ``pending`` (re-triage skips it) or the task non-terminal in a
generation stage (re-triage retries it, bounded by MAX_AUTO_REQUEUES).
A direct redispatch clears ``stage``, so a crash before the pipeline
writes a new generation stage is fail+refunded instead of retried.
"""

from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any

from loguru import logger
from pydantic import ValidationError

from app.models import const
from app.models.publish import PublishParams
from app.services import task_publish
from app.services.analytics import track_event
from app.services.fill_schedule.constants import (
    SLOT_GENERATING,
    SLOT_PENDING,
    SLOT_READY,
)

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
        # Only generation-stage orphans restart from zero. A publish-stage
        # orphan with a finished video must complete the publish via
        # classify_orphan below — resetting its slot would discard the
        # archived video and re-spend the GPU on a full regeneration.
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


def settle_orphan_completed(state: Any, task_id: str) -> None:
    """Mark the video_generations row completed for a finished orphan.

    Used when the triage has proof of delivery (publish_results): the
    video shipped, so the generation is completed — never failed, and
    never refunded. Rows that are already terminal are left alone.
    """
    response = state._request(
        "GET",
        f"engine_task_id=eq.{state._eq(task_id)}"
        "&select=generation_id,status"
        "&order=created_at.asc",
        table="video_generations",
    )
    rows = response.json()
    if not rows:
        # Normal for fill_schedule batch tasks (no video_generations row).
        return
    gen = rows[0]
    if gen.get("status") in ("failed", "completed"):
        return
    now = datetime.now(timezone.utc).isoformat()
    state._request(
        "PATCH",
        f"generation_id=eq.{state._eq(gen['generation_id'])}",
        table="video_generations",
        json={"status": "completed", "completed_at": now, "updated_at": now},
    )


def mark_complete_orphan(state: Any, task_id: str, data: dict[str, Any]) -> None:
    """Backfill COMPLETE for an orphan whose publish already ran."""
    # Billing first: if the process dies after the settle but before the
    # terminal write, the next boot re-selects the still-non-terminal task
    # and the idempotent settle skips the already-completed row. The
    # reverse order would strand the generation row in processing forever
    # (the boot SELECT excludes terminal rows).
    settle_orphan_completed(state, task_id)
    state.update_task(task_id, state=const.TASK_STATE_COMPLETE, progress=100)
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
    try:
        publish = PublishParams.model_validate(raw_params)
    except ValidationError as exc:
        # Deterministic: the persisted plan can never validate (schema
        # drift or a corrupt row). Fail+refund instead of retrying it on
        # every boot forever.
        logger.error(f"orphan {task_id}: persisted publish_params invalid: {exc}")
        return False
    task_publish.publish_videos(task_id, publish, [os.path.basename(object_path)])
    # Settle before the terminal write (see mark_complete_orphan).
    settle_orphan_completed(state, task_id)
    state.update_task(task_id, state=const.TASK_STATE_COMPLETE, progress=100)
    track_event(
        "orphan_publish_completed",
        {"task_id": task_id, "flow": str(data.get("flow") or "unknown")},
    )
    logger.info(f"orphan {task_id}: boot publish completed")
    return True


def triage_orphan(
    state: Any, task_id: str, data: dict[str, Any], slot_store: Any
) -> bool:
    """Run the boot triage for one orphaned task.

    Returns True when the orphan was claimed and the caller must NOT
    fail+refund it: the slot was requeued for the tick, a direct
    generation was marked for restart, the publish was already complete,
    the publish finished now, or the publish attempt failed and billing
    was already settled. Returns False when the caller falls through to
    the historical fail+refund.
    """
    if triage_requeue(state, slot_store, task_id, data):
        return True
    # Lazy on purpose: direct_redispatch imports this module's stage
    # constants, so a top-level import would cycle while this module
    # is still loading. The import does not pull in the pipeline.
    from app.services.direct_redispatch import triage_redispatch_direct

    if triage_redispatch_direct(state, task_id, data):
        return True
    decision = classify_orphan(data)
    if decision == MARK_COMPLETE:
        mark_complete_orphan(state, task_id, data)
        return True
    if decision == COMPLETE_PUBLISH:
        try:
            if complete_publish_orphan(state, task_id, data):
                return True
        except task_publish.PublishFailedError as exc:
            # publish_videos already marked the task FAILED with the
            # real upstream error; settle billing (refund) and report
            # claimed without overwriting that error.
            logger.error(f"boot publish failed for orphaned task {task_id}: {exc}")
            try:
                state._settle_orphan_billing(task_id)
            except Exception as settle_exc:  # noqa: BLE001 - loud; next boot retries
                logger.error(f"failed to settle billing for {task_id}: {settle_exc}")
            return True
    return False
