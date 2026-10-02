"""Reconciliation: generating slots whose task finished become ready/failed."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from loguru import logger

from app.services.fill_schedule.constants import (
    SLOT_FAILED,
    SLOT_READY,
)
from app.services.analytics import track_event
from app.services.fill_schedule.store import ScheduleStore
from app.services.fill_schedule.support import (
    persona_for,
    slot_user_id,
    token_cost,
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
            schedule = slot.get("schedules") or {}
            task = self.task_state.get_task(str(slot["task_id"]))
            if task is None:
                continue
            if task.get("state") == const.TASK_STATE_COMPLETE:
                self.store.update_slot(slot["id"], status=SLOT_READY)
                updated += 1
                # GPU cost (USD) is calculated by the Modal app and returned
                # in the task result. Include it for unit-economics tracking.
                # Never in API responses — PostHog dashboard only.
                properties: dict[str, object] = {"slotId": str(slot["id"])}
                result = task.get("result")
                if isinstance(result, dict):
                    cost = result.get("cost_usd")
                    if isinstance(cost, (int, float)):
                        properties["cost_usd"] = cost
                track_event("video_generated", properties)
            elif task.get("state") == const.TASK_STATE_FAILED:
                user_id = slot_user_id(slot)
                # The batch was prepaid under `batch:{scheduleId}` — refund
                # just this video's cost; the batch id keeps the other
                # videos' charges intact.
                if user_id is not None:
                    try:
                        persona = persona_for(schedule)
                    except RuntimeError:
                        # The persona was deleted after the schedule was
                        # created: no embed to compute the refund cost from.
                        # Mark the slot failed and move on — throwing here
                        # would kill the whole reconcile stage every tick.
                        # NOTE: the prepaid tokens for this slot are
                        # permanently burned (the cost is unrecoverable
                        # without the persona embed). Follow-up: persist the
                        # per-slot cost on the slot row at schedule creation
                        # so refunds never depend on a joinable persona.
                        logger.warning(
                            "fill_schedule: skipping refund for failed slot "
                            "without persona embed",
                            slot_id=slot.get("id"),
                            schedule_id=schedule.get("id"),
                        )
                    else:
                        cost = token_cost(
                            float(persona.get("face_mix_percent") or 0),
                            str(persona.get("face_quality") or "ok"),
                        )
                        batch_generation_id = f"batch:{schedule['id']}"
                        self.store.refund_batch_tokens(
                            user_id,
                            batch_generation_id,
                            f"{batch_generation_id}:slot:{slot['id']}",
                            cost,
                            "Batch generation failed",
                        )
                else:
                    logger.error(
                        "fill_schedule: cannot refund failed batch slot without user_id",
                        slot_id=slot.get("id"),
                    )
                self.store.update_slot(
                    slot["id"], status=SLOT_FAILED, error=str(task.get("error", ""))[:500]
                )
                updated += 1
        return updated
