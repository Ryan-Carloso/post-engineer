"""Video generation dispatch: pending batch slots (parallel) and one-off
schedule slots (sequential per schedule) to the video pipeline."""

from __future__ import annotations

import threading
import uuid
from datetime import datetime
from typing import Any

from loguru import logger

from app.models.schema import TaskVideoRequest
from app.services import notify as notify_module
from app.services.fill_schedule.constants import (
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


def is_oneoff_slot(slot: dict[str, Any]) -> bool:
    """One-off discriminator (no schema change): the joined schedule carries
    ``scheduled_at``. Batch schedules (from POST /api/schedule/batch) leave
    it NULL."""
    schedule = slot.get("schedules")
    return isinstance(schedule, dict) and schedule.get("scheduled_at") is not None


class BatchGenerator:
    """Starts video generation for pending batch slots.

    Batch slots are user-requested and prepaid at request time
    (``batch:{scheduleId}``): they always generate, using the slot's
    stored topic with no LLM call and no token spend.

    One-off schedules (``schedules.scheduled_at`` set, created by POST
    /api/schedule) generate SEQUENTIALLY: slot N+1 dispatches only after
    slot N leaves generating, so the user watches one video complete
    before the next starts. They bypass the generation horizon — dispatch
    happens at the first tick after creation — while publishing still
    waits for ``slot_at``.
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
        """Dispatch generation for pending slots. Returns enqueued count."""
        enqueued = 0
        enqueued_topics: list[str] = []
        seen: set[str] = set()

        # One-off schedules first: sequential, horizon-bypassed.
        generating_schedule_ids = {
            str((slot.get("schedules") or {}).get("id"))
            for slot in self.store.generating_slots()
        }
        oneoff_by_schedule: dict[str, list[dict[str, Any]]] = {}
        for slot in self.store.pending_oneoff_slots():
            seen.add(str(slot.get("id")))
            schedule_id = str((slot.get("schedules") or {}).get("id"))
            oneoff_by_schedule.setdefault(schedule_id, []).append(slot)
        for schedule_id, slots in oneoff_by_schedule.items():
            if schedule_id in generating_schedule_ids:
                # Slot N still generating — slot N+1 waits for the next tick.
                continue
            slots.sort(key=lambda s: str(s.get("slot_at") or ""))
            label = self._generate_slot(slots[0])
            if label is not None:
                enqueued += 1
                enqueued_topics.append(label)

        # Batch slots: parallel dispatch within the generation horizon.
        # One-off slots are never dispatched here (already handled above,
        # even when inside the horizon) — the `seen` guard is belt and
        # braces for that.
        for slot in self.store.pending_slots(now):
            if str(slot.get("id")) in seen or is_oneoff_slot(slot):
                continue
            label = self._generate_slot(slot)
            if label is not None:
                enqueued += 1
                enqueued_topics.append(label)

        if enqueued:
            notify_safe(self.notify, notify_module.generation_batch_msg(enqueued, enqueued_topics))
        return enqueued

    def _generate_slot(self, slot: dict[str, Any]) -> str | None:
        """Process one pending slot. Returns the notify label on success,
        None when the slot failed (already recorded + notified)."""
        schedule = slot.get("schedules") or {}
        persona = persona_for(schedule)
        try:
            # Topics are stored at creation (batch and one-off alike); there
            # is no LLM fallback, so an empty topic fails the slot loudly.
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
            # Prepaid at request time under this id: no spend here, only a
            # refund if dispatch itself fails.
            generation_id = f"batch:{schedule['id']}"
            task_id = new_task_id(slot)
            try:
                self._dispatch_generation(task_id, request, user_id)
            except Exception:
                # Refund just this video's prepaid cost; the id keeps the
                # other videos' charges intact.
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
            return f"{persona.get('name', 'Persona')}: {topic}"
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
            return None

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
