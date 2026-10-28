"""Video generation dispatch: pending batch slots (parallel) to the video pipeline."""

from __future__ import annotations

import threading
import uuid
from datetime import datetime
from typing import Any

from loguru import logger

from app.models.schema import TaskVideoRequest
from app.models import const as model_const
from app.services import notify as notify_module
from app.services import task as tm
from app.services.analytics import nonempty_error_reason, scrub_secret_values, track_event
from app.services.fill_schedule.constants import (
    SLOT_FAILED,
    SLOT_GENERATING,
)
from app.services.fill_schedule.metadata import validate_publish_plan
from app.services.fill_schedule.store import ScheduleStore
from app.services.language_gate import ENGLISH_ONLY_VIDEO_MESSAGE, is_english_language
from app.services.fill_schedule.support import (
    build_persona_params,
    notify_safe,
    post_identity,
    slot_faceless,
    slot_material,
    slot_user_id,
    token_cost,
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
        identity: dict[str, Any] = {}
        task_id: str | None = None
        user_id: str | None = None
        try:
            # The identity may be gone (persona deleted after the schedule
            # was created, and no snapshot): fail the slot instead of killing
            # the whole generate stage every tick. A persona-less schedule
            # resolves from its own snapshot columns here.
            identity = post_identity(schedule)
            # Topics are stored at creation; there is no LLM fallback,
            # so an empty topic fails the slot loudly.
            topic = str(slot.get("topic") or "").strip()
            if not topic:
                raise RuntimeError("Batch slot has no topic")
            # Pre-flight before anything about the job itself: a slot that
            # could never publish is the more fundamental failure, and this
            # check is free.
            validate_publish_plan(schedule, topic)
            # `PersonaParams` requires exactly one of voice_id / voice_audio_url,
            # so a schedule that resolves no voice can never generate. Checked
            # before the dispatch: failing the slot now gives a readable reason
            # instead of an opaque engine rejection after the request left.
            # (No refund on this path: the slot never reached the dispatch a
            # refund is anchored to.)
            voice_for(identity)
            faceless = slot_faceless(slot)
            request = TaskVideoRequest(
                video_subject=topic,
                persona=build_persona_params(identity, self.store, faceless),
                video_aspect=identity.get("video_aspect") or "9:16",
                # Layout resolves through post_identity() like every other
                # editorial field: snapshot first, persona embed second. The
                # `or "standard"` covers both a NULL snapshot (schedule created
                # before migration 018) and a NULL persona column, which is
                # the behaviour every existing video already has.
                video_layout=identity.get("video_layout") or "standard",
                # Per-post material (scheduled_posts, migration 029), forwarded
                # exactly like the web's direct dispatch does.
                faceless_material=slot_material(slot),
                # Segments (scheduled_posts, migration 030), forwarded exactly
                # like the web's direct dispatch does. Without this, a
                # requeued slot (engine restart mid-generation) or a
                # tick-dispatched pending slot regenerates from the topic
                # alone: the script differs and every user photo disappears
                # with no warning. A row without segments (NULL) behaves
                # exactly as before; the TaskVideoRequest validator joins
                # them into video_script and rejects a malformed row, so a
                # corrupt row fails the slot loudly instead of rendering a
                # different video.
                segments=slot.get("segments"),
                video_script_prompt=identity.get("script_prompt") or "",
                video_cta=identity.get("cta_text") or "",
                # Snapshot (post_language) already resolved by post_identity();
                # without this the prompt carries no "- language:" line and
                # the script language falls back to the LLM's guess from the
                # topic (DEFAULT_SCRIPT_SYSTEM_PROMPT rule 7).
                video_language=str(identity.get("language") or ""),
                paragraph_number=(
                    int(identity["paragraph_number"])
                    if identity.get("paragraph_number") is not None
                    else None
                ),
            )
            user_id = slot_user_id(slot)
            if user_id is None:
                raise RuntimeError("Scheduled slot has no user_id")
            face_quality = str(identity.get("face_quality") or "ok")
            cost = token_cost(faceless, face_quality)
            # Prepaid at request time under this id: no spend here, only a
            # refund if dispatch itself fails.
            generation_id = f"batch:{schedule['id']}"
            task_id = new_task_id(slot)
            try:
                # English-only launch: a slot scheduled before the launch can
                # still carry a non-English language. It fails here, inside
                # the refund block, so its prepaid cost comes back — and
                # before the funnel entry below, because a language-gated
                # slot is a data error, not a generation attempt.
                if request.video_language.strip() and not is_english_language(request.video_language):
                    raise ValueError(ENGLISH_ONLY_VIDEO_MESSAGE)
                # Funnel entry: requested BEFORE dispatch, so a dispatch
                # failure still counts as requested -> failed in the
                # failure % funnel.
                tm.track_generation_requested(
                    task_id,
                    user_id=user_id,
                    flow="batch",
                    pipeline="video",
                    slot_id=slot["id"],
                    persona_id=identity.get("id"),
                )
                self._dispatch_generation(
                    task_id,
                    request,
                    user_id,
                    slot_id=str(slot["id"]),
                    schedule_id=str(schedule.get("id") or ""),
                    persona_id=str(schedule.get("persona_id") or ""),
                )
            except Exception:
                # Refund just this video's prepaid cost; the id keeps the
                # other videos' charges intact.
                refunded = self.store.refund_batch_tokens(
                    user_id,
                    generation_id,
                    f"{generation_id}:slot:{slot['id']}",
                    cost,
                    "Batch generation could not be dispatched",
                    engine_task_id=task_id,
                )
                # Fire refund_issued only on a landed refund (see reconcile.py
                # for why never optimistically). The task never reached the
                # engine, but the allocated id still links the ledger row.
                if refunded:
                    track_refund_issued(
                        user_id=user_id,
                        amount=cost,
                        reason="Batch generation could not be dispatched",
                        batch_generation_id=generation_id,
                        slot_id=str(slot["id"]),
                        engine_task_id=task_id,
                    )
                raise
            self.store.update_slot(
                slot["id"], status=SLOT_GENERATING, topic=topic, task_id=task_id
            )
            return f"{identity.get('name', 'Persona')}: {topic}"
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
                # Identity for PostHog: the dispatch never created a task
                # row, so these props are the only attribution the failed
                # event gets. (slotId keeps its historic camelCase name;
                # new props use snake_case.)
                "schedule_id": schedule.get("id"),
                "persona_id": schedule.get("persona_id"),
                # Scrub the full message before truncating: a cut landing
                # mid-key would leave a fragment the key-anchored pattern
                # can no longer match, leaking the raw remainder into
                # PostHog properties.
                "reason": nonempty_error_reason(str(exc), type(exc).__name__),
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
                    identity.get("name", "Persona"), "", notify_module.safe_reason(exc)
                ),
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
    ) -> None:
        """Start the video pipeline immediately for a due slot.

        This is the same immediate path the /persona-videos route uses:
        create the task state first (so the reconciler can observe it),
        then run the pipeline in a daemon thread so the tick never blocks
        on a long generation.

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
        self.task_state.update_task(
            task_id,
            user_id=user_id,
            flow="batch",
            pipeline="video",
            # New tasks start at explicit 0/PROCESSING: update_task() only
            # overwrites state/progress when they are passed, so the initial
            # values are set here rather than relying on defaults.
            state=model_const.TASK_STATE_PROCESSING,
            progress=0,
            **tracking_ids,
        )
        thread = threading.Thread(
            target=tm.start,
            kwargs={"task_id": task_id, "params": request, "stop_at": "video"},
            name=f"fill-schedule-generate-{task_id}",
            daemon=True,
        )
        thread.start()
