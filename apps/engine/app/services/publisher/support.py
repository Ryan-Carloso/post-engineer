"""Shared helpers for the batch scheduling pipeline components."""

from __future__ import annotations

from typing import Any

from loguru import logger


def slot_user_id(slot: dict[str, Any]) -> str | None:
    """Owner of a slot: the slot row first, then the schedule embed."""
    user_id = slot.get("user_id")
    if isinstance(user_id, str) and user_id:
        return user_id
    schedule = slot.get("schedules")
    if isinstance(schedule, dict) and isinstance(schedule.get("user_id"), str):
        return str(schedule["user_id"])
    return None


def notify_safe(notify: Any, message: str) -> None:
    """Discord fire-and-forget — a notification failure never kills the tick."""
    try:
        notify(message)
    except Exception as exc:
        logger.warning(f"publisher: notify failed: {exc}")
