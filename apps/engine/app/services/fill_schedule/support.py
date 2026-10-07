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


# Snapshot columns on ``schedules`` holding what the persona used to supply
# alone. The engine reads them through ``post_identity`` so a schedule created
# before migration 012 (no snapshot, persona present) and one created after it
# (snapshot present) reach the same job payload.
_SNAPSHOT_FIELDS = (
    ("voice_id", "post_voice_id"),
    ("voice_audio_url", "post_voice_audio_url"),
    ("script_prompt", "post_script_prompt"),
    ("niche", "post_niche"),
    ("language", "post_language"),
    ("video_aspect", "post_video_aspect"),
    ("paragraph_number", "post_paragraph_number"),
    ("face_quality", "post_face_quality"),
)


def post_identity(schedule: dict[str, Any]) -> dict[str, Any]:
    """What the engine needs to build the job: snapshot first, persona second.

    The web writes the ``post_*`` snapshot columns for every new schedule, and
    the snapshot wins over the embed whenever it was written: editing the
    persona afterwards cannot change an already-scheduled post. The embed is
    the fallback for rows created before migration 012 (no snapshot). A
    persona-less schedule has no embed and reads only the snapshot columns —
    which is what makes the post reproducible instead of depending on a row
    that may be deleted later.

    Raises ``RuntimeError`` when NEITHER source can supply the definition: the
    engine's ``PersonaParams`` rejects a job with no voice, so failing here
    (a slot-level failure, before any dispatch) beats dispatching a request
    the engine will refuse with an opaque error.
    """
    persona = schedule.get("personas")
    has_persona = isinstance(persona, dict)
    identity: dict[str, Any] = dict(persona) if has_persona else {}

    for persona_field, snapshot_field in _SNAPSHOT_FIELDS:
        value = schedule.get(snapshot_field)
        if value is None or value == "":
            continue
        # The snapshot wins over the embed: it is the value the web resolved
        # and charged for when the post was created.
        identity[persona_field] = value

    if not identity:
        raise RuntimeError(
            f"schedule {schedule.get('id')} has neither a persona nor a post snapshot"
        )
    return identity


def voice_for(identity: dict[str, Any]) -> str:
    """The voice the job will speak with, or raise.

    ``PersonaParams`` in the engine's schema requires exactly one of
    ``voice_id`` / ``voice_audio_url``, so a schedule that resolves no voice
    can never generate. An audio-voice persona carries ``voice_audio_path``
    in the embed (``build_persona_params`` signs it into ``voice_audio_url``
    at dispatch); a persona-less audio post carries ``voice_audio_url`` in
    the schedule snapshot. Checking here fails the SLOT with a readable
    reason instead of dispatching a request the engine refuses opaquely.
    (Pre-dispatch failures carry no refund: the slot never reached the
    dispatch a refund is anchored to.)
    """
    for key in ("voice_id", "voice_audio_url", "voice_audio_path"):
        value = identity.get(key)
        if isinstance(value, str) and value:
            return value
    raise RuntimeError("post resolves no voice: a job needs exactly one voice")


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
    not the literal True is treated as "with the persona's face": a slot dict
    without the field (rows selected before migration 007, partial API
    projections) or a malformed value prices and renders the expensive case,
    never the cheap one.
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
    elif persona.get("voice_audio_url"):
        # Persona-less audio post: the web validated the URL and stored it in
        # the schedule snapshot; pass it through untouched (no signing needed).
        params["voice_audio_url"] = persona["voice_audio_url"]
    elif persona.get("voice_audio_path"):
        params["voice_audio_url"] = store.signed_url("personas", persona["voice_audio_path"])
    return params
