"""Identity props shared by fill-schedule publish lifecycle events."""

from __future__ import annotations

from typing import Any

from app.services.fill_schedule.support import FACELESS_PRICE, slot_user_id, token_cost


def publish_tracking_context(
    slot: dict[str, Any], schedule: dict[str, Any]
) -> dict[str, object]:
    """Build PostHog identity props from the slot/schedule rows.

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


def publish_refund_amount(
    prepaid: int, task: dict[str, Any] | None, face_quality: str
) -> int:
    """Net of a :shortface premium already refunded for this slot.

    LongCat faceless fallback refunds only the face premium under
    ``:shortface``. A later publish failure must not refund that premium
    again: the remaining prepaid amount is the faceless price (or zero).
    """
    codes = (task or {}).get("user_warning_codes") or []
    if not isinstance(codes, list) or "avatar_disabled" not in codes:
        return prepaid
    premium = token_cost(False, face_quality) - FACELESS_PRICE
    return max(0, prepaid - premium)
