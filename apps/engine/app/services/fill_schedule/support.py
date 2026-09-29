"""Shared helpers for the batch scheduling pipeline components."""

from __future__ import annotations

from typing import Any

from loguru import logger

from app.services.fill_schedule.constants import SCHEDULE_KIND_BATCH
from app.services.fill_schedule.store import ScheduleStore


def assert_batch_kind(schedule: dict[str, Any]) -> None:
    """Fail fast on any non-batch schedule reaching the pipeline.

    The old recurring/one-off flow was deleted: no code path creates
    non-batch schedules anymore. Silently skipping them would hide that
    bug — a loud error surfaces it instead.
    """
    kind = schedule.get("kind")
    if kind != SCHEDULE_KIND_BATCH:
        raise ValueError(
            f"schedule {schedule.get('id')} has kind={kind!r}; "
            f"only kind={SCHEDULE_KIND_BATCH!r} is supported"
        )


def token_cost(face_mix_percent: float, face_quality: str) -> int:
    """Per-video token cost, reusing the scheduled-videos formula."""
    mix = min(100.0, max(0.0, face_mix_percent)) / 100.0
    quality_price = 3 if face_quality == "very_good" else 2
    return max(1, int((mix * quality_price + (1 - mix)) + 0.999999))


def persona_for(schedule: dict[str, Any]) -> dict[str, Any]:
    """Extract the embedded persona from a schedule row."""
    persona = schedule.get("personas")
    if not isinstance(persona, dict):
        raise RuntimeError(f"schedule {schedule.get('id')} has no persona embed")
    return persona


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
    except Exception as exc:  # noqa: BLE001
        logger.warning(f"fill_schedule: notify failed: {exc}")


def build_persona_params(persona: dict[str, Any], store: ScheduleStore) -> dict[str, Any]:
    """TaskVideoRequest persona params: avatar/voice resolution."""
    params: dict[str, Any] = {"name": persona.get("name") or "Persona"}
    if persona.get("avatar_url"):
        params["avatar_url"] = persona["avatar_url"]
    elif persona.get("photo_path"):
        params["photo_url"] = store.signed_url("personas", persona["photo_path"])
    if persona.get("voice_id"):
        params["voice_id"] = persona["voice_id"]
    elif persona.get("voice_audio_path"):
        params["voice_audio_url"] = store.signed_url("personas", persona["voice_audio_path"])
    return params
