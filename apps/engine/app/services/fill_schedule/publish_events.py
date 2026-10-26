"""PostHog payloads for fill-schedule publish failures."""

from __future__ import annotations

from typing import Any

from app.services.analytics import nonempty_error_reason, scrub_error_text
from app.services.fill_schedule.support import slot_user_id


def publish_tracking_context(
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


def provider_failed_properties(
    slot: dict[str, Any],
    schedule: dict[str, Any],
    provider: str | None,
    exc: BaseException,
) -> dict[str, object]:
    """publish_provider_failed payload: why + scrubbed body, never empty reason."""
    return {
        **publish_tracking_context(slot, schedule),
        "provider": str(provider) if provider else "unknown",
        "status_code": getattr(exc, "status_code", None),
        "response_body": scrub_error_text(
            getattr(exc, "response_body", None) or "", max_chars=500
        ),
        "reason": nonempty_error_reason(str(exc), type(exc).__name__, max_chars=200),
    }


def publish_failed_properties(
    slot: dict[str, Any],
    schedule: dict[str, Any],
    reason: str,
    fallback: str = "Error",
    **extra: object,
) -> dict[str, object]:
    return {
        **publish_tracking_context(slot, schedule),
        "reason": nonempty_error_reason(reason, fallback, max_chars=200),
        **extra,
    }


def partial_failure_properties(
    slot: dict[str, Any],
    schedule: dict[str, Any],
    failed_providers: list[str],
    published_providers: list[str],
    first_error: str = "",
) -> dict[str, object]:
    why = first_error or ",".join(failed_providers) or "partial_failure"
    return {
        **publish_tracking_context(slot, schedule),
        "failed_providers": failed_providers,
        "published_providers": published_providers,
        "reason": nonempty_error_reason(why, "partial_failure", max_chars=200),
    }
