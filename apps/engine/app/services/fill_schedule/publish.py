"""Publishing: publish ready batch slots whose time has come."""

from __future__ import annotations

import os
from datetime import datetime, timedelta
from typing import Any

from loguru import logger

from app.services import notify as notify_module
from app.services import upload_publisher
from app.services import video_storage
from app.services.analytics import scrub_error_text, track_event
from app.services.fill_schedule.constants import (
    SLOT_FAILED,
    SLOT_PUBLISHED,
    SLOT_PUBLISHING,
)
from app.services.fill_schedule.publish_accounts import (
    lease_iso,
    next_delay_seconds,
    publish_slot_accounts,
)
from app.services.fill_schedule.publish_events import (
    partial_failure_properties,
    provider_failed_properties,
    publish_failed_properties,
    publish_tracking_context,
)
from app.services.fill_schedule.publish_results import merge_prior_published
from app.services.fill_schedule.store import ScheduleStore
from app.services.fill_schedule.support import (
    notify_safe,
    slot_refund_amount,
    slot_user_id,
    track_refund_issued,
)
from app.services.state import persist_state_update


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
        """Publish due slots. Returns how many reached status published.

        Ready slots are claimed ready→publishing. A slot that is already
        publishing waits on publish_not_before and is resumed, skipping any
        account that already has a recorded success.
        """
        if not self.base_url or not self.api_secret:
            logger.warning("fill_schedule: publish skipped — MPT_UPLOAD_API_BASE_URL/MONEYPRINT_API_SECRET missing")
            return 0
        # A slot left in publishing by a crash is resumed here once its
        # lease (publish_not_before) passes; it never goes back to ready.
        # Snapshot before this tick parks new backoffs, so a slot we just
        # scheduled is not resumed in the same pass.
        resumable: list[dict[str, Any]] = []
        fetch = getattr(self.store, "resumable_publishing_slots", None)
        if callable(fetch):
            try:
                resumable = [row for row in fetch(now) if isinstance(row, dict)]
            except Exception as exc:  # noqa: BLE001 — resume is best-effort
                logger.warning(
                    f"fill_schedule: resumable publish lookup failed: {notify_module.safe_diagnostic(exc)}"
                )
        published = 0
        for slot in self.store.ready_due_slots(now):
            published += self._publish_one(slot, now, resumed=False)
        for slot in resumable:
            published += self._publish_one(slot, now, resumed=True)
        return published

    def _publish_one(self, slot: dict[str, Any], now: datetime, resumed: bool) -> int:
        schedule = slot.get("schedules") or {}
        title = slot.get("title") or "Scheduled post"
        description = str(slot.get("description") or "").strip()
        persona_name = (schedule.get("personas") or {}).get("name", "Persona")
        if resumed:
            claim = getattr(self.store, "claim_resumable_slot", None)
            if not callable(claim) or not claim(str(slot["id"]), now.isoformat(), lease_iso(now)):
                return 0
        elif not self.store.claim_ready_slot(str(slot["id"]), now):
            return 0
        if not resumed:
            # Once per publish: a resume (backoff, crash lease) is the same publish.
            track_event("video_publish_started", publish_tracking_context(slot, schedule))
        task = self.task_state.get_task(str(slot["task_id"]))
        videos = (task or {}).get("videos") or []
        object_path = (task or {}).get("video_storage_path")
        if not videos:
            self.store.update_slot(
                slot["id"], status=SLOT_FAILED,
                error="task has no finished videos",
            )
            track_event(
                "video_publish_failed",
                publish_failed_properties(
                    slot, schedule, "task has no finished videos", retryable=False
                ),
            )
            return 0
        if not isinstance(object_path, str) or not object_path:
            self._fail_slot_permanently(
                slot,
                schedule,
                "task has no verified R2 video archive",
                "Publish failed: video was generated before the R2 archive; "
                "video refunded",
            )
            return 0
        if not resumed:
            self.store.update_slot(slot["id"], publish_not_before=lease_iso(now))
        prior_results = (task or {}).get("publish_results")

        def record_results(entries: list[dict[str, Any]]) -> bool:
            if not slot.get("task_id"):
                return True
            return persist_state_update(
                self.task_state,
                str(slot["task_id"]),
                publish_results=merge_prior_published(prior_results, entries),
            )

        def persist_outcomes(saved: list[dict[str, Any]], fields: dict[str, Any]) -> None:
            self.store.update_slot(
                slot["id"],
                publish_outcomes=[dict(item) for item in saved],
                **fields,
            )

        account_result = publish_slot_accounts(
            slot,
            schedule,
            videos,
            lambda: video_storage.read_final_video_r2(object_path),
            now,
            title,
            description,
            base_url=self.base_url,
            api_secret=self.api_secret,
            publish_video=self.publish_video,
            persist_outcomes=persist_outcomes,
            record_results=record_results,
        )
        if account_result.transport_error is not None:
            logger.warning(
                f"fill_schedule: slot {slot['id']} video read failed: "
                f"{notify_module.safe_diagnostic(account_result.transport_error)}"
            )
            track_event(
                "publish_provider_failed",
                provider_failed_properties(slot, schedule, None, account_result.transport_error),
                immediate=True,
            )
        for provider_name, exc in account_result.provider_exceptions:
            track_event(
                "publish_provider_failed",
                provider_failed_properties(slot, schedule, provider_name, exc),
                immediate=True,
            )
        for notice in account_result.new_user_notices:
            notify_safe(self.notify, notify_module.user_action_msg(notice))
        if account_result.state_write_failed and account_result.any_published:
            track_event(
                "video_publish_partial_failure",
                partial_failure_properties(
                    slot, schedule, ["state-write"], account_result.published_providers, "state-write",
                ),
            )
        outcome_fields = {
            "publish_outcomes": [dict(item) for item in account_result.outcomes],
            "publish_attempts": account_result.max_attempts,
        }
        if account_result.any_retrying:
            self.store.update_slot(
                slot["id"],
                status=SLOT_PUBLISHING,
                publish_not_before=self._soonest_retry(account_result.outcomes, now),
                **outcome_fields,
            )
            track_event(
                "video_publish_failed",
                publish_failed_properties(
                    slot,
                    schedule,
                    account_result.failure_reason,
                    retryable=True,
                    attempts=account_result.max_attempts,
                ),
                immediate=True,
            )
            return 0
        if account_result.any_published:
            self.store.update_slot(
                slot["id"],
                status=SLOT_PUBLISHED,
                published_at=now.isoformat(),
                publish_not_before=None,
                **outcome_fields,
            )
            track_event(
                "video_published",
                {
                    **publish_tracking_context(slot, schedule),
                    "providers": account_result.published_providers,
                },
            )
            notify_safe(
                self.notify,
                notify_module.slot_published_msg(
                    persona_name, title, account_result.published_providers,
                ),
            )
            if account_result.failed_providers:
                track_event(
                    "video_publish_partial_failure",
                    partial_failure_properties(
                        slot,
                        schedule,
                        account_result.failed_providers,
                        account_result.published_providers,
                        account_result.first_error,
                    ),
                )
                if account_result.non_user_failed_providers:
                    notify_safe(
                        self.notify,
                        notify_module.partial_publish_msg(
                            str(slot["id"]), account_result.non_user_failed_providers,
                        ),
                    )
            return 1
        self._fail_slot_permanently(
            slot,
            schedule,
            f"publish failed after {account_result.max_attempts} attempts: "
            f"{scrub_error_text(account_result.failure_reason, max_chars=200)}",
            f"Publish failed after {account_result.max_attempts} attempts; video refunded",
            attempts=account_result.max_attempts,
            emit_failed_event=False,
            outcomes=account_result.outcomes,
        )
        track_event(
            "video_publish_failed",
            publish_failed_properties(
                slot,
                schedule,
                account_result.failure_reason,
                retryable=False,
                attempts=account_result.max_attempts,
            ),
            immediate=True,
        )
        notify_safe(
            self.notify,
            notify_module.slot_failed_msg(
                persona_name,
                title,
                scrub_error_text(account_result.failure_reason, max_chars=200),
            ),
        )
        return 0

    def _soonest_retry(self, outcomes: list[dict[str, Any]], now: datetime) -> str:
        wakes = [
            item["retryAt"]
            for item in outcomes
            if item.get("status") == "retrying" and isinstance(item.get("retryAt"), str)
        ]
        if wakes:
            return min(wakes)
        delay = next_delay_seconds(1)
        return (now + timedelta(seconds=delay)).isoformat()

    def _fail_slot_permanently(
        self,
        slot: dict[str, Any],
        schedule: dict[str, Any],
        error: str,
        refund_reason: str,
        attempts: int | None = None,
        emit_failed_event: bool = True,
        outcomes: list[dict[str, Any]] | None = None,
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
        Callers that already emitted the event themselves pass
        ``emit_failed_event=False``.
        """
        if emit_failed_event:
            track_event(
                "video_publish_failed",
                publish_failed_properties(slot, schedule, error, retryable=False),
            )
        user_id = slot_user_id(slot)
        schedule_id = schedule.get("id")
        if user_id and isinstance(schedule_id, str) and schedule_id:
            cost = slot_refund_amount(slot)
            if cost is not None:
                batch_generation_id = f"batch:{schedule_id}"
                engine_task_id = str(slot["task_id"]) if slot.get("task_id") else None
                try:
                    refunded = self.store.refund_batch_tokens(
                        user_id,
                        batch_generation_id,
                        f"{batch_generation_id}:slot:{slot['id']}:publish",
                        cost,
                        refund_reason,
                        engine_task_id=engine_task_id,
                    )
                except Exception as exc:  # noqa: BLE001 — refund is best-effort here
                    logger.error(
                        f"fill_schedule: refund failed for publish-failed slot {slot['id']}: {exc}"
                    )
                else:
                    if refunded:
                        track_refund_issued(
                            user_id=user_id,
                            amount=cost,
                            reason=refund_reason,
                            batch_generation_id=batch_generation_id,
                            slot_id=str(slot["id"]),
                            engine_task_id=engine_task_id,
                        )
                    if not refunded:
                        logger.error(
                            f"fill_schedule: refund not applied for publish-failed "
                            f"slot {slot['id']}: rpc returned not-refunded"
                        )
        else:
            logger.error(
                "fill_schedule: cannot refund publish-failed slot without user_id/schedule_id",
                slot_id=slot.get("id"),
            )
        fields: dict[str, Any] = {
            "status": SLOT_FAILED,
            "error": scrub_error_text(error, max_chars=200),
            "publish_not_before": None,
        }
        if attempts is not None:
            fields["publish_attempts"] = attempts
        if outcomes is not None:
            fields["publish_outcomes"] = [dict(item) for item in outcomes]
        self.store.update_slot(slot["id"], **fields)
