"""Publishing: publish ready batch slots whose time has come."""

from __future__ import annotations

import os
from datetime import datetime, timedelta
from functools import partial
from typing import Any

from loguru import logger

from app.services import notify as notify_module
from app.services import upload_publisher
from app.services.analytics import scrub_error_text, track_event
from app.services.publisher.constants import (
    SLOT_FAILED,
    SLOT_PUBLISHED,
    SLOT_PUBLISHING,
)
from app.services.publisher.metadata import AccountNotBoundError, validate_publish_plan
from app.services.publisher.publish_accounts import (
    lease_iso,
    next_delay_seconds,
    publish_slot_accounts,
)
from app.services.publisher.publish_existing_media import (
    claimed_upload_cleanup,
    cleanup_existing_media,
    image_cleanup,
    resolve_existing_media,
)
from app.services.publisher.publish_events import (
    partial_failure_properties,
    provider_failed_properties,
    publish_failed_properties,
    publish_tracking_context,
)
from app.services.owner_alert import notify_owner_async, notify_publish_failed, notify_publish_partial
from app.services.publisher.store import ScheduleStore
from app.services.publisher.support import notify_safe, slot_user_id
from app.services.publisher.access_gate import access_states, partition_slots


def _failed_outcomes(
    outcomes: list[dict[str, Any]] | None,
) -> list[dict[str, Any]]:
    """Failed outcomes as owner-alert failures: provider, account, reason."""
    failures: list[dict[str, Any]] = []
    for outcome in outcomes or []:
        if not isinstance(outcome, dict) or outcome.get("status") != "failed":
            continue
        failures.append(
            {
                "provider": str(outcome.get("provider") or ""),
                "account_id": str(outcome.get("accountId") or ""),
                "reason": str(outcome.get("error") or ""),
            }
        )
    return failures


class BatchPublisher:
    """Publishes due batch slots to their providers."""

    def __init__(
        self,
        store: ScheduleStore,
        publish_video: Any = upload_publisher.publish_video,
        notify: Any = notify_module.send_discord,
    ) -> None:
        self.store = store
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
            logger.warning("publisher: publish skipped — MPT_UPLOAD_API_BASE_URL/MONEYPRINT_API_SECRET missing")
            return 0
        resumable: list[dict[str, Any]] = []
        fetch = getattr(self.store, "resumable_publishing_slots", None)
        if callable(fetch):
            try:
                resumable = [row for row in fetch(now) if isinstance(row, dict)]
            except Exception as exc:
                logger.warning(
                    f"publisher: resumable publish lookup failed: {notify_module.safe_diagnostic(exc)}"
                )
        due = [row for row in self.store.ready_due_slots(now) if isinstance(row, dict)]
        owners: list[str] = []
        for slot in [*due, *resumable]:
            uid = slot_user_id(slot)
            if uid is not None:
                owners.append(uid)
        states = access_states(self.store, owners, now)
        due_active, due_inactive, due_unknown = partition_slots(due, states)
        res_active, res_inactive, res_unknown = partition_slots(resumable, states)
        published = 0
        expired = 0
        for slot in due_active:
            published += self._publish_one(slot, now, resumed=False)
        for slot in res_active:
            published += self._publish_one(slot, now, resumed=True)
        for slot in due_inactive:
            if self._expire_slot(slot, now):
                expired += 1
        skipped = len(due_unknown) + len(res_unknown) + len(res_inactive)
        if published or expired or skipped:
            logger.info(
                f"publisher tick counters: published={published} expired={expired} skipped={skipped}"
            )
        return published

    def _expire_cleanup(self, slot: dict[str, Any]) -> Any:
        cleanup = image_cleanup(slot)
        if cleanup is not None:
            return cleanup
        if slot.get("media_kind") != "upload":
            return None
        media_ref = slot.get("media_ref")
        if not isinstance(media_ref, str) or not media_ref:
            return None
        try:
            row = self.store.get_video_upload(media_ref)
        except Exception as exc:
            logger.warning(
                f"publisher: slot {slot['id']} expire upload lookup failed: {notify_module.safe_diagnostic(exc)}"
            )
            return None
        if not isinstance(row, dict):
            return None
        if row.get("user_id") != slot_user_id(slot):
            return None
        storage_path = row.get("storage_path")
        if not isinstance(storage_path, str) or not storage_path:
            return None
        return ("videos", storage_path)

    def _expire_slot(self, slot: dict[str, Any], now: datetime) -> bool:
        expire = getattr(self.store, "expire_ready_slot", None)
        if callable(expire):
            try:
                won = bool(expire(str(slot["id"]), now))
            except Exception as exc:
                logger.warning(
                    f"publisher: slot {slot['id']} expire failed: {notify_module.safe_diagnostic(exc)}"
                )
                return False
            if not won:
                return False
        else:
            self.store.update_slot(slot["id"], status="expired", publish_not_before=None)
        cleanup_existing_media(self.store, slot, self._expire_cleanup(slot))
        return True

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
        media_cleanup = image_cleanup(slot) or claimed_upload_cleanup(self.store, slot, resumed)
        persona_id = schedule.get("persona_id")
        if isinstance(persona_id, str) and persona_id:
            try:
                bound = self.store.persona_bound_accounts(persona_id)
            except Exception as exc:
                logger.warning(
                    f"publisher: slot {slot['id']} binding read failed, "
                    f"leaving it for the next tick: {notify_module.safe_diagnostic(exc)}"
                )
                return 0
            try:
                validate_publish_plan(schedule, title, description, bound)
            except AccountNotBoundError as exc:
                self._fail_slot_permanently(
                    slot,
                    schedule,
                    str(exc),
                                    )
                cleanup_existing_media(self.store, slot, media_cleanup)
                return 0
            except (RuntimeError, ValueError) as exc:
                self._fail_slot_permanently(
                    slot,
                    schedule,
                    str(exc),
                                    )
                cleanup_existing_media(self.store, slot, media_cleanup)
                return 0
        if not resumed:
            track_event("video_publish_started", publish_tracking_context(slot, schedule))
        if slot.get("media_kind") not in ("upload", "image"):
            self._fail_slot_permanently(slot, schedule, "slot has no uploaded media")
            return 0
        fail = partial(self._fail_slot_permanently, slot, schedule)
        resolved = resolve_existing_media(self.store, fail, slot, now, resumed)
        if resolved is None:
            return 0
        videos, video_reader, content_type, upload_cleanup = resolved
        media_cleanup = upload_cleanup or media_cleanup
        if not resumed:
            self.store.update_slot(slot["id"], publish_not_before=lease_iso(now))
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
            video_reader,
            now,
            title,
            description,
            base_url=self.base_url,
            api_secret=self.api_secret,
            publish_video=self.publish_video,
            persist_outcomes=persist_outcomes,
            content_type=content_type,
        )
        if account_result.transport_error is not None:
            logger.warning(
                f"publisher: slot {slot['id']} video read failed: "
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
            cleanup_existing_media(self.store, slot, media_cleanup)
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
                            str(slot["id"]),
                            account_result.non_user_failed_providers,
                        ),
                    )
                notify_owner_async(
                    notify_publish_partial,
                    slot_user_id(slot),
                    slot_id=str(slot["id"]),
                    title=title,
                    failures=_failed_outcomes(account_result.outcomes),
                    persona=persona_name,
                )
            return 1
        self._fail_slot_permanently(
            slot,
            schedule,
            f"publish failed after {account_result.max_attempts} attempts: "
            f"{scrub_error_text(account_result.failure_reason, max_chars=200)}",
            attempts=account_result.max_attempts,
            emit_failed_event=False,
            outcomes=account_result.outcomes,
        )
        cleanup_existing_media(self.store, slot, media_cleanup)
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
        attempts: int | None = None,
        emit_failed_event: bool = True,
        outcomes: list[dict[str, Any]] | None = None,
    ) -> None:
        """Mark a slot that can never publish as failed and alert its owner.

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
        personas = schedule.get("personas") or {}
        persona = personas.get("name") if isinstance(personas, dict) else None
        notify_owner_async(
            notify_publish_failed,
            user_id,
            slot_id=str(slot["id"]),
            title=str(slot.get("title") or ""),
            reason=fields["error"],
            persona=persona if isinstance(persona, str) else None,
            failures=_failed_outcomes(outcomes),
        )
