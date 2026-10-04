"""Shared helpers for the batch scheduling pipeline components."""

from __future__ import annotations

from typing import Any

from loguru import logger

from app.services.fill_schedule.store import ScheduleStore


FACELESS_PRICE = 1
FACE_QUALITY_PRICES = {"ok": 2, "very_good": 3}


def token_cost(faceless: bool, face_quality: str) -> int:
    """Per-video token cost.

    Mirrors the web's ``computeVideoTokens`` (apps/web/lib/tokens.ts) — the two
    MUST agree: the web pre-pays this amount and this function decides how
    much to refund, so a drift between them silently over- or under-refunds a
    failed slot. Personas are always faced (the face mix column is gone), so
    the only inputs are the per-post "no face" choice and the persona's face
    quality.
    """
    if faceless:
        return FACELESS_PRICE
    return FACE_QUALITY_PRICES["very_good" if face_quality == "very_good" else "ok"]


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


def slot_faceless(slot: dict[str, Any]) -> bool:
    """True when this slot's post was created with "no face".

    ``scheduled_posts.faceless`` is the per-post choice written by the web at
    creation (the persona face mix column no longer exists). Anything that is
    not the literal True is treated as "with the persona's face": a legacy row
    (NULL, before the column existed) or a malformed value prices and renders
    the expensive case, never the cheap one.
    """
    return slot.get("faceless") is True


def build_persona_params(
    persona: dict[str, Any],
    store: ScheduleStore,
    faceless: bool = False,
) -> dict[str, Any]:
    """TaskVideoRequest persona params: avatar/voice resolution.

    A faceless post contributes ONLY the voice — no avatar, no photo — so the
    engine renders stock footage (its ``persona_lipsync_active`` also returns
    false without a visual identity). This keeps the batch pipeline in step
    with the web's direct dispatch of the same slot.
    """
    params: dict[str, Any] = {"name": persona.get("name") or "Persona"}
    if not faceless:
        if persona.get("avatar_url"):
            params["avatar_url"] = persona["avatar_url"]
        elif persona.get("photo_path"):
            params["photo_url"] = store.signed_url("personas", persona["photo_path"])
    if persona.get("voice_id"):
        params["voice_id"] = persona["voice_id"]
    elif persona.get("voice_audio_path"):
        params["voice_audio_url"] = store.signed_url("personas", persona["voice_audio_path"])
    return params
