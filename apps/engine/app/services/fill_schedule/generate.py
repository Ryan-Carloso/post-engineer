"""Video generation dispatch: pending slots through the shared task manager."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from loguru import logger

from app.models.schema import LipSyncQuality, TaskVideoRequest
from app.models import const as model_const
from app.services import notify as notify_module
from app.services import task as tm
from app.services.analytics import nonempty_error_reason, scrub_secret_values, subtitle_event_props, track_event
from app.services.fill_schedule.batch_admission import (
    SlotDeferred,
    free_running_slots,
    read_pending_slots,
    submit_batch_start,
)
from app.services.fill_schedule.constants import (
    SLOT_FAILED,
    SLOT_GENERATING,
)
from app.services.fill_schedule.metadata import validate_publish_plan
from app.services.fill_schedule.store import ScheduleStore
from app.services.language_gate import ENGLISH_ONLY_VIDEO_MESSAGE, is_english_language
from app.services.owner_alert import notify_generation_failed, notify_owner_async
from app.services.persona_image import is_engine_usable_persona_image_url
from app.services.script_segments import legacy_media_list
from app.services.tracking_props import pacing_tracking_props
from app.services.fill_schedule.support import (
    build_persona_params,
    notify_safe,
    post_identity,
    slot_music_mood,
    slot_refund_amount,
    slot_user_id,
    slot_video_type,
    track_refund_issued,
    voice_for,
)


def new_task_id(slot: dict[str, Any]) -> str:
    """Deterministic task id per slot (uuid5) — M4: if the engine crashes
    between dispatch and update_slot(generating), the next tick's
    re-dispatch generates the SAME id instead of creating a second
    orphan task (duplicate GPU cost)."""
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"fill-schedule:{slot['id']}"))


class BatchGenerator:
    """Starts video generation for pending batch slots.

    Slots are user-requested and prepaid at request time
    (``batch:{scheduleId}``): they always generate, using the slot's
    stored script segments with no LLM call and no token spend. A slot
    without segments has no script: it fails loudly with no dispatch,
    no token spend and no refund (it never reached dispatch).
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
        """Dispatch generation for pending slots the manager can start now.

        Returns how many slots were started. A slot that cannot start on
        this tick stays pending: it is not queued, not failed, and not
        refunded. Batch dispatch never fills the task-manager queue.
        """
        from app.controllers.v1.video import task_manager

        budget = free_running_slots(task_manager)
        enqueued = 0
        enqueued_titles: list[str] = []

        for slot in read_pending_slots(self.store, now, budget):
            label = self._generate_slot(slot)
            if label is not None:
                enqueued += 1
                enqueued_titles.append(label)

        if enqueued:
            notify_safe(self.notify, notify_module.generation_batch_msg(enqueued, enqueued_titles))
        return enqueued

    def _generate_slot(self, slot: dict[str, Any]) -> str | None:
        """Process one pending slot. Returns the notify label on success,
        None when the slot failed (already recorded + notified) or was
        left pending for a later tick (transient binding-read failure,
        or the shared task manager could not accept it)."""
        schedule = slot.get("schedules") or {}
        identity: dict[str, Any] = {}
        task_id: str | None = None
        user_id: str | None = None
        try:
            identity = post_identity(schedule)
            title = str(slot.get("title") or "").strip()
            description = str(slot.get("description") or "").strip()
            video_type = slot_video_type(slot)
            segments = legacy_media_list(slot.get("segments"))
            if not segments:
                raise RuntimeError("Slot has no script segments")
            bound_accounts = None
            if schedule.get("persona_id"):
                try:
                    bound_accounts = self.store.persona_bound_accounts(str(schedule["persona_id"]))
                except Exception as exc:
                    logger.warning(
                        f"fill_schedule: slot {slot['id']} binding read failed, "
                        f"leaving it for the next tick: {scrub_secret_values(str(exc))}"
                    )
                    return None
            validate_publish_plan(schedule, title, description, bound_accounts)
            voice_for(identity)
            user_id = slot_user_id(slot)
            if user_id is None:
                raise RuntimeError("Scheduled slot has no user_id")
            generation_id = f"batch:{schedule['id']}"
            task_id = new_task_id(slot)
            try:
                request = TaskVideoRequest(
                    video_title=title[:100],
                    video_description=description,
                    video_type=video_type,
                    video_quality=(
                        LipSyncQuality.very_good
                        if video_type != "faceless" and identity.get("face_quality") == "very_good"
                        else LipSyncQuality.ok
                    ),
                    persona=build_persona_params(identity, self.store, video_type),
                    lipsync_photos=slot.get("lipsync_photos"),
                    video_aspect=identity.get("video_aspect") or "9:16",
                    video_layout=identity.get("video_layout") or "standard",
                    hook_panel=identity.get("hook_panel") is not False,
                    music_mood=slot_music_mood(slot),
                    segments=segments,
                    cta_type=(
                        identity.get("cta_type")
                        if any(
                            isinstance(segment, dict) and segment.get("cta") is True
                            for segment in segments
                        )
                        else None
                    ),
                    video_language=str(identity.get("language") or ""),
                    paragraph_number=(
                        int(identity["paragraph_number"])
                        if identity.get("paragraph_number") is not None
                        else None
                    ),
                )
                if video_type in ("full_lipsync", "hook_lipsync"):
                    avatar_url = identity.get("avatar_url")
                    if avatar_url:
                        if not is_engine_usable_persona_image_url(avatar_url):
                            raise RuntimeError(
                                f"{video_type} requires a usable persona photo"
                            )
                    elif not identity.get("photo_path"):
                        raise RuntimeError(
                            f"{video_type} requires a persona with a photo"
                        )
                if request.video_language.strip() and not is_english_language(request.video_language):
                    raise ValueError(ENGLISH_ONLY_VIDEO_MESSAGE)
                def _accepted() -> None:
                    tm.track_generation_requested(
                        task_id,
                        user_id=user_id,
                        flow="batch",
                        pipeline="video",
                        slot_id=slot["id"],
                        persona_id=identity.get("id"),
                        **subtitle_event_props(request),
                        **pacing_tracking_props(request),
                    )

                self._dispatch_generation(
                    task_id,
                    request,
                    user_id,
                    slot_id=str(slot["id"]),
                    schedule_id=str(schedule.get("id") or ""),
                    persona_id=str(schedule.get("persona_id") or ""),
                    on_accepted=_accepted,
                )
            except SlotDeferred:
                raise
            except Exception as dispatch_exc:
                cost = slot_refund_amount(slot)
                refunded = False
                try:
                    refunded = cost is not None and self.store.refund_batch_tokens(
                        user_id,
                        generation_id,
                        f"{generation_id}:slot:{slot['id']}",
                        cost,
                        "Batch generation could not be dispatched",
                        engine_task_id=task_id,
                    )
                except Exception as refund_exc:
                    logger.error(
                        f"fill_schedule: refund failed for undispatched slot "
                        f"{slot['id']}: {scrub_secret_values(str(refund_exc))}"
                    )
                else:
                    if cost is not None and not refunded:
                        logger.error(
                            f"fill_schedule: refund not applied for undispatched "
                            f"slot {slot['id']}: rpc returned not-refunded"
                        )
                if refunded and cost is not None:
                    track_refund_issued(
                        user_id=user_id,
                        amount=cost,
                        reason="Batch generation could not be dispatched",
                        batch_generation_id=generation_id,
                        slot_id=str(slot["id"]),
                        engine_task_id=task_id,
                    )
                raise dispatch_exc
            self.store.update_slot(
                slot["id"], status=SLOT_GENERATING, title=title, task_id=task_id
            )
            return f"{identity.get('name', 'Persona')}: {title}"
        except SlotDeferred:
            logger.info(
                f"fill_schedule: slot {slot['id']} stays pending: "
                "the task manager cannot accept it on this tick"
            )
            return None
        except Exception as exc:
            logger.error(
                f"fill_schedule: slot {slot['id']} generation failed: "
                f"{scrub_secret_values(str(exc))}"
            )
            self.store.update_slot(
                slot["id"], status=SLOT_FAILED, error=scrub_secret_values(str(exc))[:500]
            )
            failed_props: dict[str, object] = {
                "flow": "batch",
                "pipeline": "video",
                "slotId": slot["id"],
                "schedule_id": schedule.get("id"),
                "persona_id": schedule.get("persona_id"),
                "reason": nonempty_error_reason(str(exc), type(exc).__name__),
            }
            if task_id is not None:
                failed_props["task_id"] = task_id
            if user_id is not None:
                failed_props["user_id"] = user_id
            if task_id is None or tm._should_emit_dispatch_failed_event(task_id):
                track_event("video_generation_failed", failed_props)
            notify_safe(
                self.notify,
                notify_module.slot_failed_msg(
                    identity.get("name", "Persona"), "", notify_module.safe_reason(exc)
                ),
            )
            if user_id is not None:
                notify_owner_async(
                    notify_generation_failed,
                    user_id,
                    slot_id=str(slot["id"]),
                    title=str(slot.get("title") or ""),
                    reason=notify_module.safe_reason(exc),
                    persona=identity.get("name", "Persona"),
                )
            return None

    def _dispatch_generation(
        self,
        task_id: str,
        request: TaskVideoRequest,
        user_id: str,
        *,
        slot_id: str | None = None,
        schedule_id: str | None = None,
        persona_id: str | None = None,
        on_accepted: Any | None = None,
    ) -> None:
        """Start one due slot on a free running slot of the shared manager.

        Reserve the running slot first. The task row is written only after
        that reservation, outside the manager lock. ``SlotDeferred`` means
        no running slot was free: the caller leaves the slot pending and
        this method has written no task row. A write that raises releases
        the reservation before the exception propagates. Batch dispatch
        does not queue; direct ``add_task`` still does.

        The caller claims the slot (pending → generating) only after
        this returns. The next tick must not dispatch a started slot again.

        The slot/schedule/persona ids are persisted on the task row so the
        PostHog tracking context can attribute every lifecycle event
        (started/progress/failed/generated) instead of "unknown".
        """
        tracking_ids: dict[str, str] = {}
        if slot_id:
            tracking_ids["slot_id"] = slot_id
        if schedule_id:
            tracking_ids["schedule_id"] = schedule_id
        if persona_id:
            tracking_ids["persona_id"] = persona_id

        def _write_task_row() -> None:
            self.task_state.update_task(
                task_id,
                user_id=user_id,
                flow="batch",
                pipeline="video",
                state=model_const.TASK_STATE_PROCESSING,
                progress=0,
                **tracking_ids,
                **subtitle_event_props(request),
            )

        from app.controllers.v1.video import task_manager

        submit_batch_start(
            task_manager,
            tm.start,
            task_id=task_id,
            params=request,
            on_accepted=on_accepted,
            before_start=_write_task_row,
        )
