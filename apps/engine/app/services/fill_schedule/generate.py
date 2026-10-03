"""Video generation dispatch: pending batch slots (parallel) to the video pipeline."""

from __future__ import annotations

import threading
import uuid
from datetime import datetime
from typing import Any

from loguru import logger

from app.models.schema import TaskVideoRequest
from app.services import notify as notify_module
from app.services import task as tm
from app.services.analytics import scrub_secret_values, track_event
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
        """Dispatch generation for pending slots. Returns enqueued count."""
        enqueued = 0
        enqueued_topics: list[str] = []

        # Batch slots: parallel dispatch within the generation horizon.
        for slot in self.store.pending_slots(now):
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
        persona: dict[str, Any] = {}
        task_id: str | None = None
        user_id: str | None = None
        try:
            # The persona may have been deleted after the schedule was
            # created: fail the slot instead of killing the whole generate
            # stage every tick.
            persona = persona_for(schedule)
            # Topics are stored at creation; there is no LLM fallback,
            # so an empty topic fails the slot loudly.
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
            # Funnel entry: requested BEFORE dispatch, so a dispatch failure
            # still counts as requested -> failed in the failure % funnel.
            tm.track_generation_requested(
                task_id,
                user_id=user_id,
                flow="batch",
                pipeline="video",
                slot_id=slot["id"],
                persona_id=persona.get("id"),
            )
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
            # PostHog bridge (loguru sink, ERROR+) forwards it, scrubbed.
            logger.error(
                f"fill_schedule: slot {slot['id']} generation failed: "
                f"{scrub_secret_values(str(exc))}"
            )
            # The error column is client-visible (/api/schedule/status spreads
            # the row into the response): scrub the full message before
            # truncating, like the telemetry reason below — a raw str(exc)
            # could echo bearer tokens or DSNs to clients.
            self.store.update_slot(
                slot["id"], status=SLOT_FAILED, error=scrub_secret_values(str(exc))[:500]
            )
            # Funnel note: slot failures raised before task creation (deleted
            # persona, empty topic, missing user_id) intentionally have no
            # matching video_generation_requested — they are scheduling/data
            # errors, not generation failures, so they sit outside the
            # requested -> failed task funnel by design.
            failed_props: dict[str, object] = {
                "flow": "batch",
                "pipeline": "video",
                "slotId": slot["id"],
                # Scrub the full message before truncating: a cut landing
                # mid-key would leave a fragment the key-anchored pattern
                # can no longer match, leaking the raw remainder into
                # PostHog properties.
                "reason": scrub_secret_values(str(exc))[:200],
            }
            if task_id is not None:
                failed_props["task_id"] = task_id
            if user_id is not None:
                failed_props["user_id"] = user_id
            # Dedup by task id on a dedicated dispatch-failure guard (separate
            # from the pipeline terminal guard _fail_task uses): a crash
            # between dispatch and update_slot(generating) re-dispatches the
            # same deterministic id, and without the guard the second failed
            # dispatch would double-count the failure numerator while
            # requested stays suppressed. The guards stay separate so a
            # dispatch failure can never suppress — or re-arm — the genuine
            # pipeline terminal event of a later successful re-dispatch.
            # Pre-task failures (task_id None) have no requested event, so
            # they always emit.
            if task_id is None or tm._should_emit_dispatch_failed_event(task_id):
                track_event("video_generation_failed", failed_props)
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
        self.task_state.update_task(
            task_id, user_id=user_id, flow="batch", pipeline="video"
        )
        thread = threading.Thread(
            target=tm.start,
            kwargs={"task_id": task_id, "params": request, "stop_at": "video"},
            name=f"fill-schedule-generate-{task_id}",
            daemon=True,
        )
        thread.start()
