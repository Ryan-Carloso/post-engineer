"""Per-account publish loop for one slot (issue #500)."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Callable

from loguru import logger

from app.services.analytics import scrub_error_text
from app.services.fill_schedule.account_outcomes import (
    _account_ids,
    _blank,
    _due,
    _fail_outcome,
    _index,
    _is_terminal,
    _json_accounts,
    _metadata,
    _prior_attempts,
    _publish_outcome,
    _targets_from_body,
    _upsert,
    exhaust_outcome,
    lease_iso,
    load_outcomes,
)
from app.services.fill_schedule.constants import MAX_PUBLISH_ATTEMPTS
from app.services.fill_schedule.publish_results import entries_for_result, failed_entry
from app.services import upload_publisher

# Re-export the delay helper the publisher uses for the slot wake-up time.
from app.services.fill_schedule.account_outcomes import next_delay_seconds as next_delay_seconds

RecordResults = Callable[[list[dict[str, Any]]], bool]
PersistOutcomes = Callable[[list[dict[str, Any]], dict[str, Any]], None]


@dataclass
class AccountPublishResult:
    outcomes: list[dict[str, Any]] = field(default_factory=list)
    published_providers: list[str] = field(default_factory=list)
    failed_providers: list[str] = field(default_factory=list)
    non_user_failed_providers: list[str] = field(default_factory=list)
    publish_results: list[dict[str, Any]] = field(default_factory=list)
    first_error: str = ""
    max_attempts: int = 0
    any_retrying: bool = False
    any_published: bool = False
    new_user_notices: list[str] = field(default_factory=list)
    provider_exceptions: list[tuple[str, BaseException]] = field(default_factory=list)
    failure_reason: str = ""
    state_write_failed: bool = False
    # The final video could not be read: every due account spent one try.
    transport_error: BaseException | None = None


def publish_slot_accounts(
    slot: dict[str, Any],
    schedule: dict[str, Any],
    videos: list[Any],
    read_video: Callable[[], bytes],
    now: datetime,
    title: str,
    *,
    base_url: str,
    api_secret: str,
    publish_video: Callable[..., Any],
    persist_outcomes: PersistOutcomes,
    record_results: RecordResults | None = None,
) -> AccountPublishResult:
    """Publish every account that does not already have a terminal outcome.

    ``read_video`` runs once, only when an account is due. When it fails,
    each due account records one transient try, so a storage outage uses
    the same per-account budget and never fails accounts already live.
    """
    outcomes = load_outcomes(slot)
    # A slot that never recorded per-account outcomes is still on the
    # legacy slot-level counter: its accounts keep counting from it.
    # Once any outcome exists, a brand-new account starts at zero.
    legacy_slot = not outcomes
    indexed = _index(outcomes)
    already_user = {
        key
        for key, outcome in indexed.items()
        if outcome.get("requiresUser") is True
    }
    result = AccountPublishResult(outcomes=outcomes)
    owner = schedule.get("user_id")
    lease = lease_iso(now)
    video_bytes: bytes | None = None

    for video_path in videos:
        video_name = os.path.basename(str(video_path))
        for provider in schedule.get("providers", []):
            provider_name = str(provider)
            account_ids = _account_ids(provider_name, schedule)
            pending = [
                account_id
                for account_id in account_ids
                if not _is_terminal(indexed.get((provider_name, account_id, video_name)))
                and _due(indexed.get((provider_name, account_id, video_name)), now)
            ]
            if not pending:
                continue
            started: list[dict[str, Any]] = []
            for account_id in pending:
                prior = indexed.get((provider_name, account_id, video_name))
                # A retrying row already at the cap was an in-flight last try
                # that never recorded a result. Do not call the provider again.
                if prior is not None and prior.get("status") == "retrying" and int(prior.get("attempts") or 0) >= MAX_PUBLISH_ATTEMPTS:
                    exhaust_outcome(prior)
                    _upsert(outcomes, prior)
                    continue
                attempt = _prior_attempts(prior, slot, legacy_slot=legacy_slot) + 1
                outcome = _blank(provider_name, account_id, video_name, attempt)
                _upsert(outcomes, outcome)
                indexed[(provider_name, account_id, video_name)] = outcome
                started.append(outcome)
            if not started:
                continue
            max_attempts = max(int(item.get("attempts") or 0) for item in outcomes)
            persist_outcomes(outcomes, {
                "status": "publishing",
                "publish_attempts": max_attempts,
                "publish_not_before": lease,
            })
            if video_bytes is None and result.transport_error is None:
                try:
                    video_bytes = read_video()
                except (OSError, RuntimeError) as exc:
                    result.transport_error = exc
                    if not result.first_error:
                        result.first_error = str(exc)
            if result.transport_error is not None or video_bytes is None:
                reason = str(result.transport_error) if result.transport_error else "video unavailable"
                for outcome in started:
                    _fail_outcome(outcome, reason, "transient", None, now)
                persist_outcomes(outcomes, {"publish_attempts": max_attempts})
                continue
            try:
                metadata = _metadata(provider_name, title, schedule, [item["accountId"] for item in started])
            except RuntimeError as exc:
                for outcome in started:
                    _fail_outcome(outcome, str(exc), "publish_rejected", 400, now)
                # A metadata error is local: no provider was called, so it
                # is not a provider exception and must not fire
                # publish_provider_failed for that provider.
                if not result.first_error:
                    result.first_error = str(exc)
                persist_outcomes(outcomes, {"publish_attempts": max_attempts})
                continue
            try:
                body = publish_video(
                    base_url=base_url,
                    api_secret=api_secret,
                    owner_user_id=owner,
                    metadata=metadata,
                    video_path=video_name,
                    video_bytes=video_bytes,
                    content_type="video/mp4",
                    max_attempts=1,
                    surface_application_failure=True,
                )
            except upload_publisher.PublishError as exc:
                parsed = _json_accounts(getattr(exc, "response_body", None))
                per_account = None
                if parsed:
                    per_account = _targets_from_body(
                        [item["accountId"] for item in started],
                        {"results": parsed},
                    )
                for outcome in started:
                    if per_account and outcome["accountId"] in per_account:
                        kind, source = per_account[outcome["accountId"]]
                        if kind == "published":
                            _publish_outcome(outcome, source)
                            continue
                        _fail_outcome(
                            outcome,
                            str(source.get("error") or exc),
                            source.get("errorCode") if isinstance(source.get("errorCode"), str) else None,
                            getattr(exc, "status_code", None),
                            now,
                        )
                    else:
                        _fail_outcome(
                            outcome,
                            str(exc),
                            None,
                            getattr(exc, "status_code", None),
                            now,
                        )
                result.provider_exceptions.append((provider_name, exc))
                if not result.first_error:
                    result.first_error = str(exc)
                logger.warning(
                    f"fill_schedule: slot {slot.get('id')} provider {provider_name} "
                    f"publish failed: {exc}"
                )
                entries = [
                    failed_entry(provider_name, video_name, scrub_error_text(str(exc), max_chars=500))
                ]
            except OSError as exc:
                for outcome in started:
                    _fail_outcome(outcome, str(exc), None, None, now)
                result.provider_exceptions.append((provider_name, exc))
                if not result.first_error:
                    result.first_error = str(exc)
                entries = [
                    failed_entry(provider_name, video_name, scrub_error_text(str(exc), max_chars=500))
                ]
            else:
                assigned = _targets_from_body([item["accountId"] for item in started], body)
                for outcome in started:
                    kind, source = assigned.get(outcome["accountId"], ("failed", {}))
                    if kind == "published":
                        _publish_outcome(outcome, source)
                    else:
                        _fail_outcome(
                            outcome,
                            str(source.get("error") or "upload API reported account failure"),
                            source.get("errorCode") if isinstance(source.get("errorCode"), str) else None,
                            200,
                            now,
                        )
                entries = entries_for_result(provider_name, video_name, body if isinstance(body, dict) else {})
            result.publish_results.extend(entries)
            if record_results is not None and entries:
                # Only the latest write counts: an early failed write
                # followed by a successful one leaves nothing unwritten.
                result.state_write_failed = record_results(list(result.publish_results)) is False
            persist_outcomes(outcomes, {
                "publish_attempts": max(int(item.get("attempts") or 0) for item in outcomes),
            })

    result.outcomes = outcomes
    result.max_attempts = max((int(item.get("attempts") or 0) for item in outcomes), default=0)
    published: list[str] = []
    failed: list[str] = []
    non_user: list[str] = []
    for outcome in outcomes:
        provider_name = str(outcome.get("provider") or "")
        if outcome.get("status") == "published":
            result.any_published = True
            if provider_name not in published:
                published.append(provider_name)
        elif outcome.get("status") == "retrying":
            result.any_retrying = True
            if provider_name not in failed:
                failed.append(provider_name)
        elif outcome.get("status") == "failed":
            if provider_name not in failed:
                failed.append(provider_name)
            if outcome.get("requiresUser") is not True and provider_name not in non_user:
                non_user.append(provider_name)
        key = (provider_name, str(outcome.get("accountId") or ""), str(outcome.get("video") or ""))
        notice = outcome.get("notice")
        if outcome.get("requiresUser") is True and key not in already_user and isinstance(notice, str):
            result.new_user_notices.append(notice)
    result.published_providers = published
    result.failed_providers = failed
    result.non_user_failed_providers = non_user
    if not result.any_published:
        names = ", ".join(failed) or "unknown"
        detail = f": {result.first_error}" if result.first_error else ""
        result.failure_reason = f"all providers failed: {names}{detail}"
    elif result.any_retrying:
        # Some accounts published, so the reason above stays empty and the
        # retry event would fall back to a bare "Error": name the accounts
        # still waiting instead.
        names = ", ".join(failed) or "unknown"
        detail = f": {result.first_error}" if result.first_error else ""
        result.failure_reason = f"some accounts still retrying: {names}{detail}"
    return result
