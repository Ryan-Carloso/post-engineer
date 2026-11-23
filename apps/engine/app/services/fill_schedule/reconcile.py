"""Reconciliation: generating slots whose task finished become ready/failed."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from loguru import logger

from app.services.fill_schedule.constants import (
    CONNECTION_FAILURES,
    SLOT_FAILED,
    SLOT_READY,
)
from app.services.analytics import scrub_secret_values, subtitle_event_props, track_event
from app.services.owner_alert import notify_generation_failed, notify_owner_async
from app.services.intro_cost import cost_event_props
from app.services.fill_schedule.store import ScheduleStore
from app.services.fill_schedule.support import (
    slot_refund_amount,
    slot_user_id,
    track_refund_issued,
)


class BatchReconciler:
    """Observes dispatched generation tasks and advances their slots."""

    def __init__(self, store: ScheduleStore, task_state: Any) -> None:
        self.store = store
        self.task_state = task_state

    def run(self, now: datetime) -> int:
        """Slots whose generating tasks finished become ready/failed."""
        from app.models import const

        updated = 0
        for slot in self.store.generating_slots():
            try:
                updated += self._reconcile_slot(slot, const)
            except CONNECTION_FAILURES:
                raise
            except Exception as exc:
                logger.error(
                    f"fill_schedule: reconcile failed for slot {slot.get('id')}: "
                    f"{scrub_secret_values(str(exc))}"
                )
        return updated

    def _reconcile_slot(self, slot: dict[str, Any], const: Any) -> int:
        """Advance one generating slot; 1 when it became ready/failed, else 0."""
        task = self.task_state.get_task(str(slot["task_id"]))
        if task is None:
            return 0
        if task.get("state") == const.TASK_STATE_COMPLETE:
            self.store.update_slot(slot["id"], status=SLOT_READY)
            properties: dict[str, object] = {
                "task_id": str(slot["task_id"]),
                "flow": "batch",
                "pipeline": "video",
                "slotId": str(slot["id"]),
            }
            slot_user = slot_user_id(slot)
            if slot_user is not None:
                properties["user_id"] = slot_user
            batch_id = slot.get("batch_id")
            if isinstance(batch_id, str) and batch_id:
                properties["batch_id"] = batch_id
            properties.update(cost_event_props(task))
            properties["music_mood"] = task.get("music_mood") or "unknown"
            properties.update(subtitle_event_props(task))
            track_event("video_generated", properties)
            return 1
        elif task.get("state") == const.TASK_STATE_FAILED:
            user_id = slot_user_id(slot)
            if user_id is not None:
                cost = slot_refund_amount(slot)
                if cost is not None:
                    batch_generation_id = f"batch:{slot['schedule_id']}"
                    engine_task_id = (
                        str(slot["task_id"]) if slot.get("task_id") else None
                    )
                    refunded = self.store.refund_batch_tokens(
                        user_id,
                        batch_generation_id,
                        f"{batch_generation_id}:slot:{slot['id']}",
                        cost,
                        "Batch generation failed",
                        engine_task_id=engine_task_id,
                    )
                    if refunded:
                        track_refund_issued(
                            user_id=user_id,
                            amount=cost,
                            reason="Batch generation failed",
                            batch_generation_id=batch_generation_id,
                            slot_id=str(slot["id"]),
                            engine_task_id=engine_task_id,
                        )
            else:
                logger.error(
                    "fill_schedule: cannot refund failed batch slot without user_id",
                    slot_id=slot.get("id"),
                )
            reason = scrub_secret_values(str(task.get("error") or ""))[:500]
            self.store.update_slot(
                slot["id"],
                status=SLOT_FAILED,
                error=reason,
            )
            if user_id is not None:
                schedule_id = slot.get("schedule_id")
                notify_owner_async(
                    notify_generation_failed,
                    user_id,
                    slot_id=str(slot["id"]),
                    title=str(slot.get("title") or ""),
                    reason=reason,
                    schedule_id=schedule_id if isinstance(schedule_id, str) else None,
                )
            return 1
        return 0
