"""Account outcome rules for fill-schedule publish (issue #500)."""

from __future__ import annotations

import json
from datetime import datetime, timedelta
from typing import Any

from app.services.analytics import scrub_error_text
from app.services.upload_publisher import RETRYABLE_STATUS_CODES
from app.services.fill_schedule.constants import (
    MAX_PUBLISH_ATTEMPTS,
    PUBLISH_IN_PROGRESS_DELAY_SECONDS,
    PUBLISH_RETRY_DELAY_SECONDS,
)
from app.services.fill_schedule.metadata import metadata_for

ATTEMPT_LEASE_SECONDS = 30 * 60

USER_CODES = frozenset({
    "email_not_verified",
    "token_expired",
    "token_missing",
    "disconnected",
})
_ACCOUNT_COLUMNS = {
    "youtube": "youtube_account_ids",
    "instagram": "instagram_account_ids",
    "linkedin": "linkedin_account_ids",
    "bluesky": "bluesky_account_ids",
    "threads": "threads_account_ids",
    "facebook": "facebook_account_ids",
    "pinterest": "pinterest_account_ids",
    "3speak": "threespeak_account_ids",
    "rumble": "rumble_account_ids",
    "fanvue": "fanvue_account_ids",
}
_LABELS = {
    "youtube": "YouTube",
    "instagram": "Instagram",
    "linkedin": "LinkedIn",
    "bluesky": "Bluesky",
    "threads": "Threads",
    "facebook": "Facebook",
    "pinterest": "Pinterest",
    "3speak": "3Speak",
    "rumble": "Rumble",
    "fanvue": "Fanvue",
}
_LINK_FIELDS = ("videoUrl", "permalink", "postId")


def next_delay_seconds(attempts: int) -> int | None:
    """Seconds after ``attempts`` transient tries.

    The third delay (600s, index 2) is never scheduled: attempt 3 is
    terminal, so this returns ``None`` for it instead.
    """
    if attempts >= MAX_PUBLISH_ATTEMPTS:
        return None
    index = max(attempts - 1, 0)
    return PUBLISH_RETRY_DELAY_SECONDS[min(index, len(PUBLISH_RETRY_DELAY_SECONDS) - 1)]


def lease_iso(now: datetime) -> str:
    return (now + timedelta(seconds=ATTEMPT_LEASE_SECONDS)).isoformat()


def load_outcomes(slot: dict[str, Any]) -> list[dict[str, Any]]:
    raw = slot.get("publish_outcomes")
    if not isinstance(raw, list):
        return []
    return [dict(item) for item in raw if isinstance(item, dict)]


def _label(provider: str) -> str:
    return _LABELS.get(provider, provider)


def user_notice(provider: str, code: str) -> str | None:
    label = _label(provider)
    if code == "email_not_verified":
        return (
            f"{label} did not publish because the email on this account is not verified. "
            f"This is a problem with your account. Only you can fix it: verify the email on {label}."
        )
    if code in USER_CODES:
        return (
            f"{label} did not publish because the account needs to be reconnected. "
            f"This is a problem with your account. Only you can fix it: reconnect {label}."
        )
    if code == "publish_unknown":
        return (
            f"{label} may already have published this video, but the publish record was lost. "
            f"Check {label} before posting it again: this slot will not retry on its own "
            f"and the token was not refunded."
        )
    return None


def _action_sentence(provider: str, code: str) -> str:
    notice = user_notice(provider, code)
    if notice:
        return notice
    label = _label(provider)
    if code == "retries_exhausted":
        return f"{label} did not publish after 3 attempts."
    return f"{label} did not publish."


def classify_failure(
    error_code: str | None,
    status_code: int | None,
) -> tuple[str, bool]:
    """Return (code, requires_user) from the handler's code, else the HTTP status.

    The web upload handler owns the classification (lib/upload/account-error.ts)
    and sends a stable ``errorCode``. The engine never reads the error text:
    an English sentence like "Media ID not found" is not an account problem.
    """
    code = error_code.strip() if isinstance(error_code, str) else ""
    if code in USER_CODES:
        return code, True
    if code == "publish_unknown":
        # The web route parked the claim: the post may already be live, but
        # its ledger record was lost. The account must never be retried by
        # the scheduler — only a human who checked the provider may post
        # again — so it fails terminally as a user action, like a
        # disconnected account.
        return code, True
    if code in ("transient", "publish_rejected", "publish_in_progress"):
        return code, False
    # No code: an older handler, a network error, or an engine-side
    # synthetic result. Decide from the status only.
    if status_code is None or status_code in RETRYABLE_STATUS_CODES:
        return "transient", False
    if status_code in (401, 403):
        return "disconnected", True
    if 200 <= status_code < 300:
        # A 2xx that published nothing with no code. Bounded by 3 tries.
        return "transient", False
    return "publish_rejected", False


def _account_ids(provider: str, schedule: dict[str, Any]) -> list[str]:
    column = _ACCOUNT_COLUMNS.get(provider)
    raw = schedule.get(column, []) if column else []
    ids = [str(value) for value in raw or [] if str(value)]
    # No account list on the schedule: one synthetic target so a provider
    # with no ids (the common test fixture) is still one retry unit.
    return ids or [""]


def _index(outcomes: list[dict[str, Any]]) -> dict[tuple[str, str, str], dict[str, Any]]:
    found: dict[tuple[str, str, str], dict[str, Any]] = {}
    for outcome in outcomes:
        provider = str(outcome.get("provider") or "")
        account_id = str(outcome.get("accountId") or "")
        video = str(outcome.get("video") or "")
        found[(provider, account_id, video)] = outcome
    return found


def _is_terminal(outcome: dict[str, Any] | None) -> bool:
    if outcome is None:
        return False
    status = outcome.get("status")
    if status == "published":
        return True
    if status != "failed":
        return False
    if outcome.get("requiresUser") is True:
        return True
    if outcome.get("code") != "transient":
        return True
    return int(outcome.get("attempts") or 0) >= MAX_PUBLISH_ATTEMPTS


def _prior_attempts(
    outcome: dict[str, Any] | None, slot: dict[str, Any], *, legacy_slot: bool
) -> int:
    """Attempts already spent by this account.

    A recorded outcome carries its own count. A legacy outcome without
    one falls back to the slot counter. A brand-new account starts at
    zero: the slot counter mixes every account's failures, so inheriting
    it would start the account at the cap with no tries of its own.
    The exception is a slot that never recorded per-account outcomes
    at all (``legacy_slot``): its counter is the legacy retry state
    for the accounts on it, so counting continues from it.
    """
    if outcome is not None:
        if isinstance(outcome.get("attempts"), int):
            return int(outcome["attempts"])
        return int(slot.get("publish_attempts") or 0)
    if legacy_slot:
        return int(slot.get("publish_attempts") or 0)
    return 0


def _due(outcome: dict[str, Any] | None, now: datetime) -> bool:
    if outcome is None:
        return True
    if outcome.get("status") != "retrying":
        return not _is_terminal(outcome)
    # The last try was started and never recorded. Close it; do not call again.
    if int(outcome.get("attempts") or 0) >= MAX_PUBLISH_ATTEMPTS:
        return True
    retry_at = outcome.get("retryAt")
    if not isinstance(retry_at, str) or not retry_at:
        return True
    try:
        wake = datetime.fromisoformat(retry_at)
    except ValueError:
        return True
    if wake.tzinfo is None:
        wake = wake.replace(tzinfo=now.tzinfo)
    return wake <= now


def _apply_links(outcome: dict[str, Any], source: dict[str, Any]) -> None:
    for name in _LINK_FIELDS:
        if source.get(name):
            outcome[name] = source[name]


def _fail_outcome(
    outcome: dict[str, Any],
    message: str,
    error_code: str | None,
    status_code: int | None,
    now: datetime,
) -> None:
    if error_code == "publish_in_progress":
        # The web route is still publishing this account under an earlier
        # request that outlived the engine's 600s timeout. The retry only
        # re-asks for that attempt's recorded result: it must not start a
        # second publish, and it must not spend one of the 3 tries, or a
        # slow upload would exhaust the budget (and refund the slot) while
        # the original post is about to go live. The attempt this call
        # recorded is handed back, and the account wakes in 60s.
        outcome["error"] = scrub_error_text(message, max_chars=200)
        outcome["requiresUser"] = False
        outcome["status"] = "retrying"
        outcome["code"] = "publish_in_progress"
        outcome["notice"] = None
        outcome["attempts"] = max(int(outcome.get("attempts") or 0) - 1, 0)
        outcome["retryAt"] = (
            now + timedelta(seconds=PUBLISH_IN_PROGRESS_DELAY_SECONDS)
        ).isoformat()
        return
    code, requires_user = classify_failure(error_code, status_code)
    attempts = int(outcome.get("attempts") or 0)
    outcome["error"] = scrub_error_text(message, max_chars=200)
    outcome["requiresUser"] = requires_user
    if requires_user or code != "transient":
        outcome["status"] = "failed"
        outcome["code"] = code
        outcome["notice"] = _action_sentence(outcome["provider"], code)
        outcome["retryAt"] = None
        return
    if attempts >= MAX_PUBLISH_ATTEMPTS:
        exhaust_outcome(outcome)
        return
    delay = next_delay_seconds(attempts)
    outcome["status"] = "retrying"
    outcome["code"] = "transient"
    outcome["requiresUser"] = False
    outcome["notice"] = None
    outcome["retryAt"] = (now + timedelta(seconds=delay or 0)).isoformat()


def exhaust_outcome(outcome: dict[str, Any]) -> None:
    """Terminal: the account spent its 3 transient tries."""
    outcome["status"] = "failed"
    outcome["code"] = "retries_exhausted"
    outcome["requiresUser"] = False
    outcome["notice"] = _action_sentence(str(outcome.get("provider") or ""), "retries_exhausted")
    outcome["retryAt"] = None


def _publish_outcome(outcome: dict[str, Any], source: dict[str, Any]) -> None:
    outcome["status"] = "published"
    outcome["code"] = None
    outcome["requiresUser"] = False
    outcome["notice"] = None
    outcome["error"] = None
    outcome["retryAt"] = None
    _apply_links(outcome, source)


def _blank(provider: str, account_id: str, video: str, attempts: int) -> dict[str, Any]:
    return {
        "provider": provider,
        "accountId": account_id,
        "video": video,
        "status": "retrying",
        "attempts": attempts,
        "code": "transient",
        "requiresUser": False,
        "notice": None,
        "error": None,
        "retryAt": None,
    }


def _interpret_result(result: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    """('published'|'failed', source dict) for one results[] item or a body."""
    if result.get("success") is True or any(result.get(name) for name in _LINK_FIELDS):
        if result.get("success") is False:
            return "failed", result
        return "published", result
    message = str(result.get("error") or "upload API reported account failure")
    code = result.get("errorCode")
    return "failed", {"error": message, "errorCode": code if isinstance(code, str) else None}


def _targets_from_body(
    pending: list[str],
    body: Any,
) -> dict[str, tuple[str, dict[str, Any]]]:
    if not isinstance(body, dict):
        failed = {"error": "upload API returned no per-account results and no link"}
        return {account_id: ("failed", failed) for account_id in pending}
    results = body.get("results")
    if results == []:
        failed = {"error": "upload API returned an empty results list"}
        return {account_id: ("failed", failed) for account_id in pending}
    if not isinstance(results, list) or not results:
        if any(body.get(name) for name in _LINK_FIELDS):
            return {account_id: ("published", body) for account_id in pending}
        failed = {"error": "upload API returned no per-account results and no link"}
        return {account_id: ("failed", failed) for account_id in pending}
    if pending == [""]:
        kind, source = _interpret_result(results[0] if len(results) == 1 and isinstance(results[0], dict) else {
            "success": any(isinstance(item, dict) and item.get("success") is True for item in results),
            "error": next(
                (item.get("error") for item in results if isinstance(item, dict) and item.get("success") is not True),
                "upload API reported account failure",
            ),
            "errorCode": next(
                (item.get("errorCode") for item in results if isinstance(item, dict) and isinstance(item.get("errorCode"), str)),
                None,
            ),
        })
        if kind == "published":
            source = next(
                (item for item in results if isinstance(item, dict) and item.get("success") is True),
                body,
            )
        return {"": (kind, source if isinstance(source, dict) else {})}
    by_id: dict[str, dict[str, Any]] = {}
    unlabeled: list[dict[str, Any]] = []
    for item in results:
        if not isinstance(item, dict):
            continue
        account_id = item.get("accountId")
        if isinstance(account_id, str) and account_id:
            by_id[account_id] = item
        else:
            unlabeled.append(item)
    if len(pending) == 1 and len(results) == 1 and pending[0] not in by_id:
        only = results[0] if isinstance(results[0], dict) else {}
        return {pending[0]: _interpret_result(only)}
    # One unlabeled failure (a request-level rejection such as "Caption is
    # required") applies to every pending account, with its own code. An
    # unlabeled success is only trusted for a single pending account: it
    # cannot say which of several accounts went live.
    shared = unlabeled[0] if len(unlabeled) == 1 else None
    if shared is not None and len(pending) > 1 and _interpret_result(shared)[0] != "failed":
        shared = None
    assigned: dict[str, tuple[str, dict[str, Any]]] = {}
    for account_id in pending:
        item = by_id.get(account_id)
        if item is None:
            item = shared
        if item is None:
            assigned[account_id] = ("failed", {"error": "upload API reported account failure"})
        else:
            assigned[account_id] = _interpret_result(item)
    return assigned


def _json_accounts(response_body: str | None) -> list[dict[str, Any]] | None:
    if not response_body:
        return None
    try:
        parsed = json.loads(response_body)
    except (ValueError, TypeError):
        return None
    results = parsed.get("results") if isinstance(parsed, dict) else None
    if not isinstance(results, list):
        return None
    return [item for item in results if isinstance(item, dict)]


def _metadata(provider: str, title: str, schedule: dict[str, Any], account_ids: list[str], description: str) -> Any:
    metadata = metadata_for(provider, title, schedule, description)
    real = tuple(account_id for account_id in account_ids if account_id)
    if real and hasattr(metadata, "account_ids"):
        metadata.account_ids = real
    return metadata


def _upsert(outcomes: list[dict[str, Any]], outcome: dict[str, Any]) -> None:
    key = (outcome["provider"], outcome["accountId"], outcome["video"])
    for index, existing in enumerate(outcomes):
        if (existing.get("provider"), existing.get("accountId"), existing.get("video")) == key:
            outcomes[index] = outcome
            return
    outcomes.append(outcome)

