"""Publishing: publish ready batch slots whose time has come."""

from __future__ import annotations

import os
from datetime import datetime
from typing import Any

from loguru import logger

from app.services import notify as notify_module
from app.services import upload_publisher
from app.services import video_storage
from app.services.analytics import scrub_secret_values, track_event
from app.services.fill_schedule.constants import (
    MAX_PUBLISH_ATTEMPTS,
    SLOT_FAILED,
    SLOT_PUBLISHED,
    SLOT_READY,
)
from app.services.fill_schedule.metadata import metadata_for
from app.services.fill_schedule.store import ScheduleStore
from app.services.fill_schedule.support import (
    notify_safe,
    post_identity,
    slot_faceless,
    slot_user_id,
    token_cost,
)


def _publish_tracking_context(
    slot: dict[str, Any], schedule: dict[str, Any]
) -> dict[str, object]:
    """Identity props shared by the publish lifecycle events.

    The publish stage runs without a task pipeline context, so these are
    built from the slot/schedule rows directly: task_id, user_id,
    schedule_id and persona_id let PostHog attribute every publish event
    instead of leaving it "Anonymous". Blank values are omitted.
    """
    context: dict[str, object] = {"slotId": str(slot["id"])}
    task_id = slot.get("task_id")
    user_id = slot_user_id(slot)
    schedule_id = schedule.get("id")
    persona_id = schedule.get("persona_id")
    if isinstance(task_id, str) and task_id:
        context["task_id"] = task_id
    if user_id:
        context["user_id"] = user_id
    if isinstance(schedule_id, str) and schedule_id:
        context["schedule_id"] = schedule_id
    if isinstance(persona_id, str) and persona_id:
        context["persona_id"] = persona_id
    return context


class BatchPublisher:
    """Publishes due batch slots to their providers."""

    def __init__(
        self,
        store: ScheduleStore,
        task_state: Any,
        publish_video: Any = upload_publisher.publish_video,
        notify: Any = notify_module.send_discord,
    ) -> None:
        self.store = store
        self.task_state = task_state
        self.publish_video = publish_video
        self.notify = notify
        self.base_url = os.getenv("MPT_UPLOAD_API_BASE_URL", "").rstrip("/")
        self.api_secret = os.getenv("MONEYPRINT_API_SECRET", "")

    def run(self, now: datetime) -> int:
        """Publish ready slots whose time has come. Return = published count.

        C2 — atomic claim before publishing: only whoever transitions
        ready→publishing (conditional PATCH) may call publish_video.
        Crash midway? The slot stays 'publishing' and recovery moves it back
        to 'ready' — never 'ready' directly, so it never re-publishes by mistake.
        """
        if not self.base_url or not self.api_secret:
            logger.warning("fill_schedule: publish skipped — MPT_UPLOAD_API_BASE_URL/MONEYPRINT_API_SECRET missing")
            return 0
        try:
            self.store.recover_stale_publishing()
        except Exception as exc:  # noqa: BLE001 — recovery is best-effort
            # safe_diagnostic, not safe_reason: this is a log-only line, and
            # requests puts the urllib3 root cause ("Caused by
            # NameResolutionError") at the END of the message, which
            # safe_reason's 200-char cut drops. The Discord call sites below
            # keep safe_reason — its output reaches users.
            logger.warning(
                f"fill_schedule: stale publishing recovery failed: {notify_module.safe_diagnostic(exc)}"
            )

        published = 0
        for slot in self.store.ready_due_slots(now):
            schedule = slot.get("schedules") or {}
            topic = slot.get("topic") or "Scheduled post"
            persona_name = (schedule.get("personas") or {}).get("name", "Persona")
            if not self.store.claim_ready_slot(str(slot["id"])):
                # another tick/process already claimed (or published) this slot
                continue
            track_event("video_publish_started", _publish_tracking_context(slot, schedule))
            task = self.task_state.get_task(str(slot["task_id"]))
            videos = (task or {}).get("videos") or []
            object_path = (task or {}).get("video_storage_path")
            if not videos:
                self.store.update_slot(
                    slot["id"], status=SLOT_FAILED,
                    error="task has no finished videos",
                )
                # A fail-fast abort is still an abort: the funnel needs the
                # failed event with the reason, not just the started one.
                track_event(
                    "video_publish_failed",
                    {
                        **_publish_tracking_context(slot, schedule),
                        "reason": "task has no finished videos",
                        "retryable": False,
                    },
                )
                continue
            if not isinstance(object_path, str) or not object_path:
                # A video generated before the R2 archive flow can never
                # publish: fail fast with a refund instead of retrying a
                # hopeless slot on every tick.
                self._fail_slot_permanently(
                    slot,
                    schedule,
                    "task has no verified R2 video archive",
                    "Publish failed: video was generated before the R2 archive; "
                    "video refunded",
                )
                continue
            try:
                video_bytes = video_storage.read_final_video_r2(object_path)
                for video_path in videos:
                    for provider in schedule.get("providers", []):
                        self.publish_video(
                            base_url=self.base_url,
                            api_secret=self.api_secret,
                            owner_user_id=schedule["user_id"],
                            metadata=metadata_for(str(provider), topic, schedule),
                            video_path=os.path.basename(video_path),
                            video_bytes=video_bytes,
                            content_type="video/mp4",
                        )
                self.store.update_slot(
                    slot["id"], status=SLOT_PUBLISHED, published_at=now.isoformat()
                )
                published += 1
                track_event(
                    "video_published",
                    {
                        **_publish_tracking_context(slot, schedule),
                        "providers": [str(p) for p in schedule.get("providers", [])],
                    },
                )
                notify_safe(
                    self.notify,
                    notify_module.slot_published_msg(
                        persona_name,
                        topic,
                        [str(provider) for provider in schedule.get("providers", [])],
                    ),
                )
            except (upload_publisher.PublishError, OSError, RuntimeError) as exc:
                # The upstream response body (if any) is logged server-side
                # only — the Discord alert via safe_reason must not carry
                # remote-controlled response text.
                upstream = getattr(exc, "response_body", None)
                logger.warning(
                    f"fill_schedule: slot {slot['id']} publish failed: {exc}"
                    + (f" | upstream response: {upstream}" if upstream else "")
                )
                attempts = int(slot.get("publish_attempts") or 0) + 1
                if attempts >= MAX_PUBLISH_ATTEMPTS:
                    # Bounded retries: auto-cancel the slot and refund the
                    # prepaid token instead of retrying forever.
                    self._fail_slot_permanently(
                        slot,
                        schedule,
                        f"publish failed after {attempts} attempts: "
                        f"{notify_module.safe_reason(exc)}",
                        f"Publish failed after {attempts} attempts; video refunded",
                        attempts=attempts,
                        # The video_publish_failed event with the attempt
                        # history fires below; don't emit a second one.
                        emit_failed_event=False,
                    )
                else:
                    # back to 'ready' (not 'failed'): may be transient; the atomic
                    # claim guarantees only one worker publishes at a time.
                    self.store.update_slot(
                        slot["id"], status=SLOT_READY, publish_attempts=attempts
                    )
                track_event(
                    "video_publish_failed",
                    {
                        **_publish_tracking_context(slot, schedule),
                        # Scrub the full message before truncating: a cut
                        # landing mid-key would leave a fragment the
                        # key-anchored pattern can no longer match.
                        "reason": scrub_secret_values(str(exc))[:200],
                        "retryable": attempts < MAX_PUBLISH_ATTEMPTS,
                        "attempts": attempts,
                    },
                )
                notify_safe(
                    self.notify,
                    notify_module.slot_failed_msg(
                        persona_name,
                        topic,
                        notify_module.safe_reason(exc),
                    ),
                )
        return published

    def _fail_slot_permanently(
        self,
        slot: dict[str, Any],
        schedule: dict[str, Any],
        error: str,
        refund_reason: str,
        attempts: int | None = None,
        emit_failed_event: bool = True,
    ) -> None:
        """Auto-cancel a slot that can never publish and refund its token.

        Mirrors the reconciler's per-slot refund convention: the unified
        generate+schedule flow prepays under ``batch:{scheduleId}`` and each
        slot refunds with its own idempotent key (the ``:publish`` suffix keeps
        it distinct from a generation-failure refund of the same slot). A
        refund RPC failure never kills the tick — the slot is already
        terminal, and the loud log line is the recovery trail.

        Every permanent abort emits ``video_publish_failed`` with the reason,
        so the analytics funnel never ends at ``video_publish_started``.
        Callers that already emitted the event themselves (the exhausted
        publish-attempts path, which carries the attempt history) pass
        ``emit_failed_event=False``.
        """
        if emit_failed_event:
            track_event(
                "video_publish_failed",
                {
                    **_publish_tracking_context(slot, schedule),
                    # Same scrub-then-truncate convention as the exception
                    # path: the reason is client-visible in the error column.
                    "reason": scrub_secret_values(error)[:200],
                    "retryable": False,
                },
            )
        user_id = slot_user_id(slot)
        schedule_id = schedule.get("id")
        if user_id and isinstance(schedule_id, str) and schedule_id:
            try:
                identity = post_identity(schedule)
            except RuntimeError:
                logger.warning(
                    "fill_schedule: skipping refund for publish-failed slot "
                    "without a resolvable identity",
                    slot_id=slot.get("id"),
                    schedule_id=schedule_id,
                )
            else:
                cost = token_cost(
                    slot_faceless(slot),
                    str(identity.get("face_quality") or "ok"),
                )
                batch_generation_id = f"batch:{schedule_id}"
                try:
                    refunded = self.store.refund_batch_tokens(
                        user_id,
                        batch_generation_id,
                        f"{batch_generation_id}:slot:{slot['id']}:publish",
                        cost,
                        refund_reason,
                    )
                except Exception as exc:  # noqa: BLE001 — refund is best-effort here
                    logger.error(
                        f"fill_schedule: refund failed for publish-failed "
                        f"slot {slot['id']}: {exc}"
                    )
                else:
                    # The RPC answered but the charge was NOT refunded: a
                    # soft failure. Log loudly (billing rule) and keep the
                    # tick running — the slot is already terminal.
                    if not refunded:
                        logger.error(
                            f"fill_schedule: refund not applied for "
                            f"publish-failed slot {slot['id']}: rpc returned "
                            f"not-refunded"
                        )
        else:
            logger.error(
                "fill_schedule: cannot refund publish-failed slot without "
                "user_id/schedule_id",
                slot_id=slot.get("id"),
            )
        # The error column is client-visible: scrub before storing.
        fields: dict[str, Any] = {
            "status": SLOT_FAILED,
            "error": scrub_secret_values(error)[:200],
        }
        if attempts is not None:
            fields["publish_attempts"] = attempts
        self.store.update_slot(slot["id"], **fields)
