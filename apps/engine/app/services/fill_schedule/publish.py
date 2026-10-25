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
    MAX_PUBLISH_ATTEMPTS,
    PUBLISH_RETRY_DELAY_SECONDS,
    SLOT_FAILED,
    SLOT_PUBLISHED,
    SLOT_READY,
)
from app.services.fill_schedule.metadata import metadata_for
from app.services.fill_schedule.publish_results import (
    entries_for_result,
    failed_entry,
    merge_prior_published,
)
from app.services.fill_schedule.store import ScheduleStore
from app.services.fill_schedule.support import (
    notify_safe,
    post_identity,
    slot_faceless,
    slot_user_id,
    token_cost,
    track_refund_issued,
)
from app.services.state import persist_state_update
from app.services.fill_schedule.publish_tracking import (
    publish_refund_amount,
    publish_tracking_context as _publish_tracking_context,
)


class _AllProvidersFailed(Exception):
    """Internal: every provider failed; trigger the slot retry/fail path."""

    def __init__(self, failed_providers: list[str], first_error: str = "") -> None:
        self.failed_providers = failed_providers
        self.first_error = first_error
        super().__init__(
            f"all providers failed: {', '.join(failed_providers)}"
            + (f": {first_error}" if first_error else "")
        )


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
            # One provider failing must not cancel the others: each
            # provider failure is recorded and the loop continues. Only
            # when every provider failed does the slot go through the
            # retry/fail path below.
            failed_providers: list[str] = []
            published_providers: list[str] = []
            publish_results: list[dict[str, Any]] = []
            first_error: str = ""
            provider: str | None = None
            try:
                video_bytes = video_storage.read_final_video_r2(object_path)
                for video_path in videos:
                    for provider in schedule.get("providers", []):
                        provider_name = str(provider)
                        try:
                            result = self.publish_video(
                                base_url=self.base_url,
                                api_secret=self.api_secret,
                                owner_user_id=schedule["user_id"],
                                metadata=metadata_for(provider_name, topic, schedule),
                                video_path=os.path.basename(video_path),
                                video_bytes=video_bytes,
                                content_type="video/mp4",
                            )
                        except (
                            upload_publisher.PublishError,
                            OSError,
                            RuntimeError,
                        ) as exc:
                            # Record and continue: a single provider being
                            # down never cancels the others.
                            failed_providers.append(provider_name)
                            publish_results.append(
                                failed_entry(
                                    provider_name,
                                    video_path,
                                    # 500 like the publish_provider_failed
                                    # event's response_body: this entry is a
                                    # diagnostic record, not a display field.
                                    scrub_error_text(str(exc), max_chars=500),
                                )
                            )
                            if not first_error:
                                first_error = str(exc)
                            upstream = getattr(exc, "response_body", None)
                            logger.warning(
                                f"fill_schedule: slot {slot['id']} provider "
                                f"{provider_name} publish failed: {exc}"
                                + (f" | upstream response: {upstream}" if upstream else "")
                            )
                            track_event(
                                "publish_provider_failed",
                                {
                                    **_publish_tracking_context(slot, schedule),
                                    "provider": provider_name,
                                    "status_code": getattr(exc, "status_code", None),
                                    "response_body": scrub_error_text(
                                        getattr(exc, "response_body", None) or "",
                                        max_chars=500,
                                    ),
                                },
                                immediate=True,
                            )
                            continue
                        entries = entries_for_result(provider_name, video_path, result)
                        publish_results.extend(entries)
                        # Only a published entry counts as published: a
                        # 2xx body can still post nothing (empty results
                        # list, or no successful account), and counting
                        # the provider anyway would flip the slot to
                        # published with zero recorded links. A provider
                        # that posted nothing is named as failed so the
                        # retry/fail path carries it instead of the
                        # provider silently vanishing.
                        if any(e.get("status") == "published" for e in entries):
                            if provider_name not in published_providers:
                                published_providers.append(provider_name)
                        elif provider_name not in failed_providers:
                            failed_providers.append(provider_name)
                            if not first_error and entries:
                                first_error = str(entries[0].get("error") or "")
                # Past the provider loops: a failure from here on (e.g. the
                # slot-state PATCH) is not a provider failure.
                provider = None
                # Record the per-provider results on the task state BEFORE
                # the slot flips to published: the web builds the post's
                # links from publish_results (post-detail -> engine task),
                # and a slot already showing 'published' must never read
                # as published-without-links. Since the #231 unification
                # dropped the task_publish.py recording, nothing wrote
                # these — published slots showed no links at all.
                if publish_results and slot.get("task_id"):
                    recorded = persist_state_update(
                        self.task_state,
                        str(slot["task_id"]),
                        publish_results=merge_prior_published(
                            (task or {}).get("publish_results"), publish_results
                        ),
                    )
                    if not recorded:
                        # The video really posted but its links could not
                        # be recorded; the slot still flips to published
                        # below, so surface the lost write as a partial
                        # failure instead of leaving only a server log.
                        track_event(
                            "video_publish_partial_failure",
                            {
                                **_publish_tracking_context(slot, schedule),
                                "failed_providers": ["state-write"],
                                "published_providers": published_providers,
                            },
                        )
                if not published_providers:
                    # Every provider failed: fall through to the retry/fail
                    # path via a synthetic exception carrying the first
                    # failure. The per-provider events above already fired.
                    raise _AllProvidersFailed(failed_providers, first_error)
                self.store.update_slot(
                    slot["id"], status=SLOT_PUBLISHED, published_at=now.isoformat()
                )
                published += 1
                track_event(
                    "video_published",
                    {
                        **_publish_tracking_context(slot, schedule),
                        "providers": published_providers,
                    },
                )
                notify_safe(
                    self.notify,
                    notify_module.slot_published_msg(
                        persona_name,
                        topic,
                        published_providers,
                    ),
                )
                if failed_providers:
                    # Partial success: some published, some failed. Alert
                    # with the failed provider names (never the upstream
                    # body — it reaches Discord).
                    track_event(
                        "video_publish_partial_failure",
                        {
                            **_publish_tracking_context(slot, schedule),
                            "failed_providers": failed_providers,
                            "published_providers": published_providers,
                        },
                    )
                    notify_safe(
                        self.notify,
                        notify_module.partial_publish_msg(
                            str(slot["id"]), failed_providers
                        ),
                    )
            except (
                _AllProvidersFailed,
                upload_publisher.PublishError,
                OSError,
                RuntimeError,
            ) as exc:
                # The upstream response body (if any) is logged server-side
                # only — the Discord alert via safe_reason must not carry
                # remote-controlled response text.
                upstream = getattr(exc, "response_body", None)
                logger.warning(
                    f"fill_schedule: slot {slot['id']} publish failed: {exc}"
                    + (f" | upstream response: {upstream}" if upstream else "")
                )
                # PostHog gets the full diagnostic picture (provider, status,
                # upstream body): unlike Discord, it is our own observability
                # backend, not a user-facing surface. `provider` is the
                # innermost loop variable; it is None (never unbound) if
                # read_final_video_r2 raised before the loop started.
                # _AllProvidersFailed skips this: the per-provider events
                # already fired in the inner loop above.
                if not isinstance(exc, _AllProvidersFailed):
                    track_event(
                        "publish_provider_failed",
                        {
                            **_publish_tracking_context(slot, schedule),
                            "provider": str(provider) if provider else "unknown",
                            "status_code": getattr(exc, "status_code", None),
                            "response_body": scrub_error_text(
                                getattr(exc, "response_body", None) or "", max_chars=500
                            ),
                        },
                        immediate=True,
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
                    # claim guarantees only one worker publishes at a time. The
                    # retry does NOT run on the next tick: a backoff key
                    # (publish_not_before) staggers it 30s / 2min / 10min so a
                    # failing upload endpoint is re-attempted inside its own
                    # recovery window instead of hammered every tick.
                    delay_index = min(attempts - 1, len(PUBLISH_RETRY_DELAY_SECONDS) - 1)
                    not_before = now + timedelta(seconds=PUBLISH_RETRY_DELAY_SECONDS[delay_index])
                    self.store.update_slot(
                        slot["id"],
                        status=SLOT_READY,
                        publish_attempts=attempts,
                        publish_not_before=not_before.isoformat(),
                    )
                track_event(
                    "video_publish_failed",
                    {
                        **_publish_tracking_context(slot, schedule),
                        # Keep the diagnostic tail and strip local paths:
                        # scrub_error_text scrubs the full message before
                        # truncating, so a cut landing mid-key cannot leave
                        # a fragment the key-anchored pattern can no longer
                        # match.
                        "reason": scrub_error_text(str(exc), max_chars=200),
                        "retryable": attempts < MAX_PUBLISH_ATTEMPTS,
                        "attempts": attempts,
                    },
                    # Same lone-event rationale as publish_provider_failed
                    # above: flush so the failure is visible immediately.
                    immediate=True,
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
                    # Scrub-then-truncate: the reason is client-visible.
                    "reason": scrub_error_text(error, max_chars=200),
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
                face_quality = str(identity.get("face_quality") or "ok")
                cost = token_cost(slot_faceless(slot), face_quality)
                batch_generation_id = f"batch:{schedule_id}"
                engine_task_id = (
                    str(slot["task_id"]) if slot.get("task_id") else None
                )
                task_record = None
                if engine_task_id:
                    try:
                        task_record = self.task_state.get_task(engine_task_id)
                    except Exception as exc:  # noqa: BLE001 — lookup must not abort the tick
                        logger.error(
                            "fill_schedule: task lookup failed for "
                            f"publish-failed slot {slot['id']}: {exc}"
                        )
                amount = publish_refund_amount(cost, task_record, face_quality)
                if amount > 0:
                    try:
                        refunded = self.store.refund_batch_tokens(
                            user_id,
                            batch_generation_id,
                            f"{batch_generation_id}:slot:{slot['id']}:publish",
                            amount,
                            refund_reason,
                            engine_task_id=engine_task_id,
                        )
                    except Exception as exc:  # noqa: BLE001 — refund is best-effort here
                        logger.error(
                            f"fill_schedule: refund failed for publish-failed "
                            f"slot {slot['id']}: {exc}"
                        )
                    else:
                        if refunded:
                            track_refund_issued(
                                user_id=user_id,
                                amount=amount,
                                reason=refund_reason,
                                batch_generation_id=batch_generation_id,
                                slot_id=str(slot["id"]),
                                engine_task_id=engine_task_id,
                            )
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
        # The error column is client-visible: scrub before storing, keep
        # the diagnostic tail and strip local paths.
        fields: dict[str, Any] = {
            "status": SLOT_FAILED,
            "error": scrub_error_text(error, max_chars=200),
        }
        if attempts is not None:
            fields["publish_attempts"] = attempts
        self.store.update_slot(slot["id"], **fields)
