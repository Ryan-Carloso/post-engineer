"""Identity props for fill-schedule publish lifecycle PostHog events."""

from __future__ import annotations

from typing import Any

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
