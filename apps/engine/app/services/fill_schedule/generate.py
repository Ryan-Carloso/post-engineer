"""Batch video generation: dispatch pending batch slots to the video pipeline."""

from __future__ import annotations

import threading
import uuid
from datetime import datetime
from typing import Any

from loguru import logger

from app.models.schema import TaskVideoRequest
from app.services import notify as notify_module
from app.services.fill_schedule.constants import (
    SCHEDULE_KIND_BATCH,
    SLOT_FAILED,
    SLOT_GENERATING,
)
from app.services.fill_schedule.metadata import validate_publish_plan
from app.services.fill_schedule.store import ScheduleStore
from app.services.fill_schedule.support import (
    build_persona_params,
    notify_safe,
    persona_for,
    slot_user_id,
    token_cost,
)


def new_task_id(slot: dict[str, Any]) -> str:
    """Deterministic task id per slot (uuid5) — M4: if the engine crashes
    between dispatch and update_slot(generating), the next tick's
    re-dispatch generates the SAME id instead of creating a second
    orphan task (duplicate GPU cost)."""
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"fill-schedule:{slot['id']}"))


class BatchGenerator:
    """Starts video generation for pending batch slots.

    Batch slots are user-requested and prepaid at request time
    (``batch:{scheduleId}``): they always generate, using the slot's
    stored topic with no LLM call and no token spend.
    """

    def __init__(
        self,
        store: ScheduleStore,
        task_state: Any,
        notify: Any = notify_module.send_discord,
    ) -> None:
        self.store = store
        self.task_state = task_state
        self.notify = notify

    def run(self, now: datetime) -> int:
        """Dispatch generation for pending batch slots. Returns enqueued count."""
        enqueued = 0
        enqueued_topics: list[str] = []
        for slot in self.store.pending_slots(now):
            schedule = slot.get("schedules") or {}
            if schedule.get("kind") != SCHEDULE_KIND_BATCH:
                continue
            persona = persona_for(schedule)
            try:
                # Prepaid at request time: the topic was chosen by the user
                # and stored on the slot by POST /api/schedule/batch.
                topic = str(slot.get("topic") or "").strip()
                if not topic:
                    raise RuntimeError("Batch slot has no topic")
                validate_publish_plan(schedule, topic)
                request = TaskVideoRequest(
                    video_subject=topic,
                    persona=build_persona_params(persona, self.store),
                    video_aspect=persona.get("video_aspect") or "9:16",
                    video_script_prompt=persona.get("script_prompt") or "",
                    paragraph_number=(
                        int(persona["paragraph_number"])
                        if persona.get("paragraph_number") is not None
                        else None
                    ),
                )
                user_id = slot_user_id(slot)
                if user_id is None:
                    raise RuntimeError("Scheduled slot has no user_id")
                face_mix_percent = float(persona.get("face_mix_percent") or 0)
                face_quality = str(persona.get("face_quality") or "ok")
                cost = token_cost(face_mix_percent, face_quality)
                # Prepaid by POST /api/schedule/batch under this id: no spend
                # here, only a refund if dispatch itself fails.
                generation_id = f"batch:{schedule['id']}"
                task_id = new_task_id(slot)
                try:
                    self._dispatch_generation(task_id, request, user_id)
                except Exception:
                    # Refund just this video's prepaid cost; the batch id
                    # keeps the other videos' charges intact.
                    self.store.refund_batch_tokens(
                        user_id,
                        generation_id,
                        f"{generation_id}:slot:{slot['id']}",
                        cost,
                        "Batch generation could not be dispatched",
                    )
                    raise
                self.store.update_slot(
                    slot["id"], status=SLOT_GENERATING, topic=topic, task_id=task_id
                )
                enqueued += 1
                enqueued_topics.append(f"{persona.get('name', 'Persona')}: {topic}")
            except Exception as exc:
                # A failed slot is a real recurring error: log at ERROR so the
                # Bugsink bridge (loguru sink, ERROR+) forwards it.
                logger.error(f"fill_schedule: slot {slot['id']} generation failed: {exc}")
                self.store.update_slot(slot["id"], status=SLOT_FAILED, error=str(exc)[:500])
                notify_safe(
                    self.notify,
                    notify_module.slot_failed_msg(
                        persona.get("name", "Persona"), "", notify_module.safe_reason(exc)
                    ),
                )
        if enqueued:
            notify_safe(self.notify, notify_module.generation_batch_msg(enqueued, enqueued_topics))
        return enqueued

    def _dispatch_generation(
        self, task_id: str, request: TaskVideoRequest, user_id: str
    ) -> None:
        """Start the video pipeline immediately for a due slot.

        This is the same immediate path the /persona-videos route uses:
        create the task state first (so the reconciler can observe it),
        then run the pipeline in a daemon thread so the tick never blocks
        on a long generation.
        """
        from app.services import task as tm

        self.task_state.update_task(task_id, user_id=user_id)
        thread = threading.Thread(
            target=tm.start,
            kwargs={"task_id": task_id, "params": request, "stop_at": "video"},
            name=f"fill-schedule-generate-{task_id}",
            daemon=True,
        )
        thread.start()
