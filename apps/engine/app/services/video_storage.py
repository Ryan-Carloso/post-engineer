"""Durable R2 archive for FINAL videos.

Local engine disk is ephemeral: a container restart wipes every generated
file, and /stream/ + /download/ start 404ing. Final video bytes therefore
live exclusively in Cloudflare R2. R2 credentials are mandatory; this module
never falls back to Supabase Storage or engine-local files.

The R2 bucket must be named ``videos``. It is private and accessed through
S3-compatible signed requests.

Scope is deliberately narrow — only the FINAL video (final-1.mp4, the
post-audio-mux render) is archived. Intermediates (combined-1.mp4),
caches, materials, and pre-audio renders are never uploaded.

Layout inside the bucket (private):
    {user_id}/{persona_id | faceless}/{task_id}/final-1.mp4
"""

import os
from typing import Optional

from loguru import logger

STORAGE_BUCKET = "videos"
FINAL_VIDEO_FILENAME = "final-1.mp4"
FACELESS_FOLDER = "faceless"
_SIGNED_URL_TTL_SECONDS = 3600

def _r2_account_id() -> str:
    return (os.getenv("R2_ACCOUNT_ID") or "").strip()


def r2_endpoint() -> str:
    """Account-scoped R2 S3 endpoint derived from the account id."""
    return f"https://{_r2_account_id()}.r2.cloudflarestorage.com"


def require_r2_configuration() -> None:
    """Fail before video work can use an unconfigured archive backend."""
    missing = [
        name
        for name, value in (
            ("R2_ACCOUNT_ID", _r2_account_id()),
            ("R2_ACCESS_KEY_ID", (os.getenv("R2_ACCESS_KEY_ID") or "").strip()),
            ("R2_SECRET_ACCESS_KEY", (os.getenv("R2_SECRET_ACCESS_KEY") or "").strip()),
        )
        if not value
    ]
    if missing:
        raise RuntimeError(
            "R2 video storage is required; missing " + ", ".join(missing)
        )


def _r2_client():
    """Build a boto3 S3 client pointed at the account's R2 endpoint.

    Signature V4 is mandatory for R2, which plain `requests` cannot produce;
    botocore does the signing. Endpoint URL is explicit because R2 is
    S3-compatible but NOT AWS, so the default AWS endpoint would be wrong.
    """
    import boto3  # imported lazily so non-video engine operations need no client

    return boto3.client(
        "s3",
        endpoint_url=r2_endpoint(),
        aws_access_key_id=(os.getenv("R2_ACCESS_KEY_ID") or "").strip(),
        aws_secret_access_key=(os.getenv("R2_SECRET_ACCESS_KEY") or "").strip(),
        # R2 ignores the region, but botocore refuses to sign without one.
        region_name="auto",
    )


def _verify_r2_object(client, object_path: str, expected_bytes: int) -> bool:
    """Confirm the object is really in the bucket at the full expected size.

    ``put_object`` returning 200 is not proof the bytes landed: a truncated
    body can still produce a successful response, and the whole point of
    making the archive a precondition is that a partial object must not be
    treated as "stored". HEAD returns ContentLength, so a mismatch means the
    object is short and the caller must not consider the video safe.
    """
    try:
        head = client.head_object(Bucket=STORAGE_BUCKET, Key=object_path)
    except Exception as exc:  # noqa: BLE001 — verification is a gate
        logger.error(f"video_storage: R2 verify HEAD failed for {object_path}: {exc}")
        return False
    remote_bytes = int(head.get("ContentLength") or 0)
    if remote_bytes != expected_bytes:
        logger.error(
            f"video_storage: R2 size mismatch for {object_path}: "
            f"remote={remote_bytes} expected={expected_bytes}"
        )
        return False
    return True


def upload_final_video_r2(object_path: str, local_path: str) -> Optional[str]:
    """Archive the final video to R2 and VERIFY it landed.

    Returns the object path only when the object is confirmed present at the
    expected size, None on any failure. The caller treats a None as "no
    durable copy exists", so a truncated upload can never be mistaken for a
    stored video.
    """
    require_r2_configuration()
    try:
        expected_bytes = os.path.getsize(local_path)
    except OSError as exc:
        logger.error(f"video_storage: cannot stat {local_path}: {exc}")
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
    except Exception as exc:  # noqa: BLE001 — reported to the caller as None
        logger.error(f"video_storage: R2 upload failed for {object_path}: {exc}")
        return None
    if not _verify_r2_object(client, object_path, expected_bytes):
        return None
    logger.info(
        f"video_storage: archived+verified final video to "
        f"r2/{STORAGE_BUCKET}/{object_path} ({expected_bytes} bytes)"
    )
    return object_path


def create_signed_url_r2(
    object_path: str, expires_in: int = _SIGNED_URL_TTL_SECONDS
) -> Optional[str]:
    """Mint a presigned GET URL for a video stored in R2."""
    require_r2_configuration()
    try:
        return _r2_client().generate_presigned_url(
            "get_object",
            Params={"Bucket": STORAGE_BUCKET, "Key": object_path},
            ExpiresIn=expires_in,
        )
    except Exception as exc:  # noqa: BLE001 — caller falls back to the 404
        logger.error(f"video_storage: R2 signed URL failed for {object_path}: {exc}")
        return None


def read_final_video_r2(object_path: str) -> bytes:
    """Read a final video from R2; publishing never falls back to local disk."""
    require_r2_configuration()
    try:
        response = _r2_client().get_object(Bucket=STORAGE_BUCKET, Key=object_path)
        body = response["Body"]
        try:
            content = body.read()
        finally:
            body.close()
    except Exception as exc:  # noqa: BLE001 — publishing requires the durable copy
        logger.error(f"video_storage: R2 read failed for {object_path}: {exc}")
        raise RuntimeError(f"could not read archived video {object_path} from R2") from exc
    if not content:
        raise RuntimeError(f"archived video {object_path} in R2 is empty")
    return content


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
    """Upload a final video to the mandatory R2 archive."""
    return upload_final_video_r2(object_path, local_path)


def create_signed_url(object_path: str, expires_in: int = _SIGNED_URL_TTL_SECONDS) -> Optional[str]:
    """Mint a time-limited R2 URL for a stored final video.

    Returns None when the archive cannot be signed — including when R2
    credentials are absent. Serving callers translate None into a 404; the
    R2-mandatory precondition is enforced at generation and publish time,
    not on this user-facing read path.
    """
    try:
        return create_signed_url_r2(object_path, expires_in)
    except RuntimeError as exc:
        logger.error(f"video_storage: cannot sign {object_path}: {exc}")
        return None
