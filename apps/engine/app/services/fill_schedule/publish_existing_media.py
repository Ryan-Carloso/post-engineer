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

# fail_permanently(error, refund_reason): the publisher's
# _fail_slot_permanently bound to (slot, schedule).
FailPermanently = Callable[[str, str], None]

# (bucket, storage path) of single-use media to remove after a terminal
# outcome, or None when the slot holds no stored bytes.
MediaCleanup = tuple[str, str] | None

MediaResolution = tuple[list[str], Callable[[], bytes], str, MediaCleanup]


def r2_reader(object_path: str) -> Callable[[], bytes]:
    """Reader for a generated video's verified R2 archive."""
    return lambda: video_storage.read_final_video_r2(object_path)


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
    return ("uploads", ref)


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
) -> MediaResolution | None:
    """Resolve a task-less media slot into publishable bytes.

    Returns (videos, reader, content_type, cleanup), or None when the
    slot failed permanently (already marked through fail_permanently) or
    must retry later (left in `publishing` with a lease). An upload is
    downloaded BEFORE the claim so a storage outage never burns the
    single-use row; the claim is the last step before dispatch.
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
        if row.get("status") != "ready":
            fail_permanently(
                "scheduled video upload is no longer ready",
                "Publish failed: scheduled video upload is no longer ready; video refunded",
            )
            return None
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
            logger.warning(
                f"fill_schedule: slot {slot['id']} scheduled upload download failed, "
                f"retrying later: {scrub_error_text(str(exc), max_chars=200)}"
            )
            store.update_slot(slot["id"], publish_not_before=lease_iso(now))
            return None
        claimed = store.claim_video_upload(media_ref)
        if claimed is None:
            fail_permanently(
                "scheduled video upload was already used",
                "Publish failed: scheduled video upload was already used; video refunded",
            )
            return None
        content_type = str(
            row.get("declared_content_type") or row.get("detected_content_type") or "video/mp4"
        )
        extension = "mov" if content_type == "video/quicktime" else "mp4"
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
            logger.warning(
                f"fill_schedule: slot {slot['id']} scheduled image download failed, "
                f"retrying later: {scrub_error_text(str(exc), max_chars=200)}"
            )
            store.update_slot(slot["id"], publish_not_before=lease_iso(now))
            return None
        return ([f"image.{extension}"], lambda: image_bytes, content_type, None)
    return None
