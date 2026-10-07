"""Durable archive for FINAL videos.

Local engine disk is ephemeral: a container restart wipes every generated
file, and /stream/ + /download/ start 404ing. The task STATE already lives
in Supabase (MPT_STATE_BACKEND=supabase); this module gives the video FILES
the same durability.

Two backends are supported:

- **Supabase Storage** (``SUPABASE_URL`` + ``SUPABASE_SERVICE_ROLE_KEY``) —
  the original backend, still the default so an existing deployment changes
  nothing. Its Free plan caps a single object at ~50 MB, and the bucket's
  ``file_size_limit`` is NOT configurable through the API (a PUT setting it
  is rejected with the same 413 that rejects oversized uploads), so a long
  1080x1920 render fails to archive and the failure is best-effort.
- **Cloudflare R2** (``R2_ACCOUNT_ID`` + ``R2_ACCESS_KEY_ID`` +
  ``R2_SECRET_ACCESS_KEY``) — an S3-compatible bucket with a 5 GB per-object
  limit and 10 GB free, so the same render archives fine.

R2 is opt-in via ``MPT_VIDEO_STORAGE=r2``. When it is set, R2 is used for
upload and for signed URLs; otherwise the Supabase path runs unchanged.

Scope is deliberately narrow — only the FINAL video (final-1.mp4, the
post-audio-mux render) is archived. Intermediates (combined-1.mp4),
caches, materials, and pre-audio renders are never uploaded.

Layout inside the bucket (private):
    {user_id}/{persona_id | faceless}/{task_id}/final-1.mp4
"""

import os
from typing import Optional

import requests
from loguru import logger

STORAGE_BUCKET = "videos"
FINAL_VIDEO_FILENAME = "final-1.mp4"
FACELESS_FOLDER = "faceless"
_SIGNED_URL_TTL_SECONDS = 3600

# R2 access is opt-in: without this the engine keeps using Supabase Storage,
# so adding credentials is never enough on its own to switch backends.
_R2_BACKEND_VALUE = "r2"


def _r2_selected() -> bool:
    return (os.getenv("MPT_VIDEO_STORAGE") or "").strip().lower() == _R2_BACKEND_VALUE


def _r2_account_id() -> str:
    return (os.getenv("R2_ACCOUNT_ID") or "").strip()


def r2_endpoint() -> str:
    """Account-scoped R2 S3 endpoint derived from the account id."""
    return f"https://{_r2_account_id()}.r2.cloudflarestorage.com"


def r2_is_configured() -> bool:
    """True when R2 is selected AND all three credentials are present.

    All three are required together: a partial config would build an unsigned
    or half-valid client and fail at the first PUT, so it is treated as
    unconfigured instead (archive stays best-effort and the caller falls back).
    """
    return bool(
        _r2_selected()
        and _r2_account_id()
        and (os.getenv("R2_ACCESS_KEY_ID") or "").strip()
        and (os.getenv("R2_SECRET_ACCESS_KEY") or "").strip()
    )


def _r2_client():
    """Build a boto3 S3 client pointed at the account's R2 endpoint.

    Signature V4 is mandatory for R2, which plain `requests` cannot produce;
    botocore does the signing. Endpoint URL is explicit because R2 is
    S3-compatible but NOT AWS, so the default AWS endpoint would be wrong.
    """
    import boto3  # imported lazily: the Supabase path must not require it

    return boto3.client(
        "s3",
        endpoint_url=r2_endpoint(),
        aws_access_key_id=(os.getenv("R2_ACCESS_KEY_ID") or "").strip(),
        aws_secret_access_key=(os.getenv("R2_SECRET_ACCESS_KEY") or "").strip(),
        # R2 ignores the region, but botocore refuses to sign without one.
        region_name="auto",
    )


def upload_final_video_r2(object_path: str, local_path: str) -> Optional[str]:
    """Archive the final video to R2. Best-effort: returns None on failure."""
    if not r2_is_configured():
        logger.warning("video_storage: R2 not configured, skipping R2 archive")
        return None
    try:
        client = _r2_client()
        with open(local_path, "rb") as handle:
            client.put_object(
                Bucket=STORAGE_BUCKET,
                Key=object_path,
                Body=handle,
                ContentType="video/mp4",
            )
    except Exception as exc:  # noqa: BLE001 — archive is best-effort
        logger.error(f"video_storage: R2 upload failed for {object_path}: {exc}")
        return None
    logger.info(f"video_storage: archived final video to r2/{STORAGE_BUCKET}/{object_path}")
    return object_path


def create_signed_url_r2(
    object_path: str, expires_in: int = _SIGNED_URL_TTL_SECONDS
) -> Optional[str]:
    """Mint a presigned GET URL for a video stored in R2."""
    if not r2_is_configured():
        return None
    try:
        return _r2_client().generate_presigned_url(
            "get_object",
            Params={"Bucket": STORAGE_BUCKET, "Key": object_path},
            ExpiresIn=expires_in,
        )
    except Exception as exc:  # noqa: BLE001 — caller falls back to the 404
        logger.error(f"video_storage: R2 signed URL failed for {object_path}: {exc}")
        return None


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
    """Upload the final video to the configured backend.

    R2 when ``MPT_VIDEO_STORAGE=r2`` is selected and configured, otherwise
    Supabase Storage (the historical default, unchanged for existing
    deployments).

    Best-effort: returns the object path on success, None on any failure
    (generation must never fail because the archive hiccuped). Callers
    record the returned path in the task state so /stream/ and /download/
    can fall back to it after a restart wipes the local disk.
    """
    if _r2_selected():
        return upload_final_video_r2(object_path, local_path)
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
    """Mint a time-limited signed URL for a stored final video.

    R2 when selected, otherwise the Supabase Storage signing endpoint.
    """
    if _r2_selected():
        return create_signed_url_r2(object_path, expires_in)
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
