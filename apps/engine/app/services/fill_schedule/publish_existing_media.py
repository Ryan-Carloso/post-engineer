"""Existing-media resolution for the publish tick (issue #384).

A ready slot with no engine task but with media columns publishes from
stored media instead of a generation task. The resolver turns the slot
row into publishable bytes; the publisher only wires the result into the
shared account loop. Kept out of publish.py so the route file stays
under the file-size ratchet.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Callable

from loguru import logger

from app.services import video_storage
from app.services.analytics import scrub_error_text
from app.services.fill_schedule.account_outcomes import lease_iso
from app.services.fill_schedule.support import slot_user_id

FailPermanently = Callable[[str, str], None]

MediaCleanup = tuple[str, str] | None

MediaResolution = tuple[list[str], Callable[[], bytes], str, MediaCleanup]


def r2_reader(object_path: str) -> Callable[[], bytes]:
    """Reader for a generated video's verified R2 archive."""
    return lambda: video_storage.read_final_video_r2(object_path)


def _parse_instant(value: Any) -> datetime | None:
    """Parse an ISO timestamp (or pass a datetime through); None when unparseable."""
    if isinstance(value, datetime):
        return value
    if not isinstance(value, str) or not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def _slot_owns_upload_claim(slot: dict[str, Any], row: dict[str, Any]) -> bool:
    """True when the row's claim is this slot's own first-attempt claim.

    Compares instants, not strings: PostgREST re-serializes timestamptz
    (trailing-zero trimming), so the same instant can arrive spelled
    differently on the two reads.
    """
    claimed_at = _parse_instant(slot.get("media_claimed_at"))
    consumed_at = _parse_instant(row.get("consumed_at"))
    return claimed_at is not None and claimed_at == consumed_at


UPLOAD_EXTENSIONS: dict[str, str] = {
    "video/mp4": "mp4",
    "video/quicktime": "mov",
    "image/jpeg": "jpg",
    "image/png": "png",
}


def _is_not_found(exc: BaseException) -> bool:
    """True when a storage download failed because the object is gone.

    A missing object never comes back, so the slot fails permanently
    instead of parking and retrying it forever. Anything else (5xx,
    timeout, network) stays transient.
    """
    response = getattr(exc, "response", None)
    return getattr(response, "status_code", None) == 404


def image_cleanup(slot: dict[str, Any]) -> MediaCleanup:
    """Stored-image cleanup for a slot.

    Only a path under this slot's own ``scheduled-media/<user_id>/``
    prefix is ever removed: a corrupted or foreign media_ref must never
    make the engine delete an arbitrary bucket object.
    """
    if slot.get("media_kind") != "image":
        return None
    ref = slot.get("media_ref")
    user_id = slot_user_id(slot)
    if not isinstance(ref, str) or not ref or not user_id:
        return None
    if not ref.startswith(f"scheduled-media/{user_id}/"):
        return None
    if any(part in ("", ".", "..") for part in ref.split("/")):
        return None
    return ("uploads", ref)


def claimed_upload_cleanup(store: Any, slot: dict[str, Any], resumed: bool) -> MediaCleanup:
    """Cleanup tuple for a resumed upload slot's own claimed bytes.

    The binding/plan checks run before the resolver, so no upload cleanup
    exists yet when they fail the slot. A resume whose first attempt
    already claimed the single-use row would otherwise leak the bytes: no
    sweeper covers consumed rows. Only the slot's own claim is removed —
    the row's consumed_at must match the slot's recorded media_claimed_at.
    A foreign claim, an unclaimed row, or a failed store read returns None.
    """
    if not resumed or slot.get("media_kind") != "upload":
        return None
    try:
        row = store.get_video_upload(str(slot.get("media_ref")))
    except Exception as exc:  # noqa: BLE001 - best-effort cleanup
        logger.warning(
            f"fill_schedule: slot {slot['id']} claimed-upload lookup failed, "
            f"leaving the bytes in place: {scrub_error_text(str(exc), max_chars=200)}"
        )
        return None
    if not isinstance(row, dict) or row.get("status") != "consumed":
        return None
    if not _slot_owns_upload_claim(slot, row):
        return None
    storage_path = row.get("storage_path")
    if not isinstance(storage_path, str) or not storage_path:
        return None
    return ("videos", storage_path)


def cleanup_existing_media(store: Any, slot: dict[str, Any], cleanup: MediaCleanup) -> None:
    """Remove single-use stored media after a terminal outcome.

    Best-effort: the slot is already published or failed, so a missing
    object is a loud log line, never a tick failure.
    """
    if cleanup is None:
        return
    bucket, path = cleanup
    if not store.remove_storage_object(bucket, path):
        logger.warning(
            f"fill_schedule: slot {slot['id']} stored media {bucket}/{path} could not be removed"
        )


def resolve_existing_media(
    store: Any,
    fail_permanently: FailPermanently,
    slot: dict[str, Any],
    now: datetime,
    resumed: bool = False,
) -> MediaResolution | None:
    """Resolve a task-less media slot into publishable bytes.

    Returns (videos, reader, content_type, cleanup), or None when the
    slot failed permanently (already marked through fail_permanently) or
    must retry later (left in `publishing` with a lease). An upload is
    downloaded BEFORE the claim so a storage outage never burns the
    single-use row; the claim is the last step before dispatch. A resume
    re-uses the claim its own first attempt won: the slot records the
    claim's consumed_at at claim time (media_claimed_at) and a `consumed`
    row is trusted only when consumed_at matches it. A `consumed` row
    claimed by anyone else fails the slot permanently — re-using it would
    double-publish media that is already live, or re-download an object
    that is already gone. A storage 404 on download fails permanently
    too: a missing object never comes back.
    """
    media_kind = slot.get("media_kind")
    media_ref = slot.get("media_ref")
    if media_kind == "upload":
        if not isinstance(media_ref, str) or not media_ref:
            fail_permanently(
                "scheduled video upload id is missing",
                "Publish failed: scheduled video upload is missing; video refunded",
            )
            return None
        row = store.get_video_upload(media_ref)
        if row is None or row.get("user_id") != slot_user_id(slot):
            fail_permanently(
                "scheduled video upload not found",
                "Publish failed: scheduled video upload not found; video refunded",
            )
            return None
        if (
            row.get("status") == "consumed"
            and resumed
            and _slot_owns_upload_claim(slot, row)
        ):
            already_claimed = True
        elif row.get("status") != "ready":
            fail_permanently(
                "scheduled video upload is no longer ready",
                "Publish failed: scheduled video upload is no longer ready; video refunded",
            )
            return None
        else:
            already_claimed = False
        storage_path = row.get("storage_path")
        if not isinstance(storage_path, str) or not storage_path:
            fail_permanently(
                "scheduled video upload has no stored file",
                "Publish failed: scheduled video upload has no stored file; video refunded",
            )
            return None
        try:
            video_bytes = store.download_storage_object("videos", storage_path)
        except Exception as exc:  # noqa: BLE001 - transient: retry next tick
            if _is_not_found(exc):
                fail_permanently(
                    "scheduled video upload file is gone",
                    "Publish failed: scheduled video upload file is gone; video refunded",
                )
                return None
            logger.warning(
                f"fill_schedule: slot {slot['id']} scheduled upload download failed, "
                f"retrying later: {scrub_error_text(str(exc), max_chars=200)}"
            )
            store.update_slot(slot["id"], publish_not_before=lease_iso(now))
            return None
        if already_claimed:
            claimed = row
        else:
            claimed = store.claim_video_upload(media_ref)
        if claimed is None:
            fail_permanently(
                "scheduled video upload was already used",
                "Publish failed: scheduled video upload was already used; video refunded",
            )
            return None
        if not already_claimed:
            claimed_at = claimed.get("consumed_at")
            if isinstance(claimed_at, str) and claimed_at:
                store.update_slot(slot["id"], media_claimed_at=claimed_at)
        content_type = str(
            row.get("declared_content_type") or row.get("detected_content_type") or "video/mp4"
        )
        extension = UPLOAD_EXTENSIONS.get(content_type, "mp4")
        return (
            [f"{media_ref}.{extension}"],
            lambda: video_bytes,
            content_type,
            ("videos", storage_path),
        )
    if media_kind == "image":
        cleanup = image_cleanup(slot)
        if cleanup is None:
            fail_permanently(
                "scheduled image path is invalid",
                "Publish failed: scheduled image path is invalid; video refunded",
            )
            return None
        content_type = str(slot.get("media_content_type") or "image/jpeg")
        extension = "png" if content_type == "image/png" else "jpg"
        try:
            image_bytes = store.download_storage_object("uploads", str(slot["media_ref"]))
        except Exception as exc:  # noqa: BLE001 - transient: retry next tick
            if _is_not_found(exc):
                fail_permanently(
                    "scheduled image file is gone",
                    "Publish failed: scheduled image file is gone; video refunded",
                )
                return None
            logger.warning(
                f"fill_schedule: slot {slot['id']} scheduled image download failed, "
                f"retrying later: {scrub_error_text(str(exc), max_chars=200)}"
            )
            store.update_slot(slot["id"], publish_not_before=lease_iso(now))
            return None
        return ([f"image.{extension}"], lambda: image_bytes, content_type, None)
    return None
