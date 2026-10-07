"""Durable archive for FINAL videos in Supabase Storage.

Local engine disk is ephemeral: a container restart wipes every generated
file, and /stream/ + /download/ start 404ing. The task STATE already lives
in Supabase (MPT_STATE_BACKEND=supabase); this module gives the video FILES
the same durability.

Scope is deliberately narrow — only the FINAL video (final-1.mp4, the
post-audio-mux render) is archived. Intermediates (combined-1.mp4),
caches, materials, and pre-audio renders are never uploaded.

Layout inside the ``videos`` bucket (private):
    {user_id}/{persona_id | faceless}/{task_id}/final-1.mp4
The user_id prefix is what the Supabase RLS policies match on, so every
object is scoped to its owning user.

Uploads use the Storage REST API directly (requests, no new dependency)
with the service-role key, which bypasses RLS — the same credentials the
Supabase task-state backend already requires.
"""

import os
from typing import Optional

import requests
from loguru import logger

STORAGE_BUCKET = "videos"
FINAL_VIDEO_FILENAME = "final-1.mp4"
FACELESS_FOLDER = "faceless"
_SIGNED_URL_TTL_SECONDS = 3600


def _supabase_url() -> str:
    return (os.getenv("SUPABASE_URL") or "").rstrip("/")


def _service_key() -> str:
    return os.getenv("SUPABASE_SERVICE_ROLE_KEY") or ""


def is_configured() -> bool:
    """True when the engine can reach Supabase Storage (service role)."""
    return bool(_supabase_url() and _service_key())


def _auth_headers() -> dict:
    key = _service_key()
    return {"apikey": key, "Authorization": f"Bearer {key}"}


def storage_object_path(user_id: str, persona_folder: str, task_id: str) -> str:
    """Deterministic object path for a task's final video."""
    return f"{user_id}/{persona_folder}/{task_id}/{FINAL_VIDEO_FILENAME}"


def persona_folder(task: dict, params) -> str:
    """Storage folder for the task's persona.

    Returns the persona_id for persona videos, ``faceless`` for faceless
    ones. A faceless video is an inline persona with no visual identity
    (voice-only — the batch pipeline and the web's direct dispatch both
    strip avatar/photo for faceless posts). With no inline persona at all
    (raw API call), the task row's persona_id is trusted when present.
    """
    persona = getattr(params, "persona", None)
    has_visuals = bool(
        persona and (getattr(persona, "photo_url", None) or getattr(persona, "avatar_url", None))
    )
    persona_id = str(task.get("persona_id") or getattr(persona, "id", "") or "").strip()
    if persona_id and (has_visuals or persona is None):
        return persona_id
    return FACELESS_FOLDER


def upload_final_video(object_path: str, local_path: str) -> Optional[str]:
    """Upload the final video to Supabase Storage.

    Best-effort: returns the object path on success, None on any failure
    (generation must never fail because the archive hiccuped). Callers
    record the returned path in the task state so /stream/ and /download/
    can fall back to it after a restart wipes the local disk.
    """
    if not is_configured():
        logger.warning(
            "video_storage: SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not set, skipping archive"
        )
        return None
    url = f"{_supabase_url()}/storage/v1/object/{STORAGE_BUCKET}/{object_path}"
    try:
        with open(local_path, "rb") as handle:
            response = requests.post(
                url,
                headers={**_auth_headers(), "Content-Type": "video/mp4", "x-upsert": "true"},
                data=handle,
                timeout=600,
            )
    except Exception as exc:  # noqa: BLE001 — archive is best-effort
        logger.error(f"video_storage: upload failed for {object_path}: {exc}")
        return None
    if not response.ok:
        logger.error(
            f"video_storage: upload failed for {object_path}: "
            f"{response.status_code} {response.text[:200]}"
        )
        return None
    logger.info(f"video_storage: archived final video to {STORAGE_BUCKET}/{object_path}")
    return object_path


def create_signed_url(object_path: str, expires_in: int = _SIGNED_URL_TTL_SECONDS) -> Optional[str]:
    """Mint a time-limited signed URL for a stored final video."""
    if not is_configured():
        return None
    url = f"{_supabase_url()}/storage/v1/object/sign/{STORAGE_BUCKET}/{object_path}"
    try:
        response = requests.post(
            url, headers=_auth_headers(), json={"expiresIn": expires_in}, timeout=30
        )
    except Exception as exc:  # noqa: BLE001 — fall back to the 404
        logger.error(f"video_storage: signed URL failed for {object_path}: {exc}")
        return None
    if not response.ok:
        logger.error(
            f"video_storage: signed URL failed for {object_path}: "
            f"{response.status_code} {response.text[:200]}"
        )
        return None
    signed = response.json().get("signedURL") or ""
    if signed.startswith("/"):
        signed = f"{_supabase_url()}{signed}"
    return signed or None
