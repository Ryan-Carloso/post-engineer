"""Publish/schedule existing media (issue #384) — engine tick.

A ready slot with no engine task but with media columns publishes from
stored media instead of a generation task: a signed-upload video is
downloaded from the ``videos`` bucket and claimed once; a scheduled image
is downloaded from the ``uploads`` bucket. No generation tokens are
charged on this path, so a failed media slot never refunds.
"""

import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import MagicMock, patch

import requests

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from app.services.fill_schedule import FillScheduleScheduler
from app.services.fill_schedule.publish import BatchPublisher
from app.services.fill_schedule.publish_accounts import AccountPublishResult
from app.services.fill_schedule.publish_existing_media import (
    cleanup_existing_media,
    image_cleanup,
    resolve_existing_media,
)
from app.services.fill_schedule.store import ScheduleStore

UTC = timezone.utc
NOW = datetime(2026, 11, 14, 12, 0, tzinfo=UTC)
UPLOAD_ID = "22222222-2222-4222-8222-222222222222"
USER_ID = "user-1"
CLAIMED_AT = "2026-11-14T11:30:00+00:00"


def _not_found_error() -> requests.exceptions.HTTPError:
    """A storage 404 shaped like production: raise_for_status's HTTPError."""
    error = requests.exceptions.HTTPError("404 Client Error")
    error.response = _FakeResponse(status_code=404)
    return error


class _FakeResponse:
    def __init__(self, rows=None, content=b"[...]", status_code=200):
        self._rows = rows if rows is not None else []
        self.content = content
        self.status_code = status_code

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")

    def json(self):
        return self._rows


class _FakeRequests:
    """Fake requests module: .request for PostgREST, .get/.delete for Storage."""

    def __init__(self):
        self.calls: list[tuple[str, str, dict]] = []
        self.get_rows: list[dict] = []
        self.patch_rows: list[dict] = []
        self.get_content = b""
        self.delete_status = 200

    def request(self, method, url, headers=None, timeout=None, **kwargs):
        self.calls.append(("request", method, url, kwargs))
        if method == "PATCH":
            return _FakeResponse(rows=self.patch_rows)
        return _FakeResponse(rows=self.get_rows)

    def get(self, url, headers=None, timeout=None):
        self.calls.append(("get", url, {}))
        return _FakeResponse(content=self.get_content)

    def delete(self, url, headers=None, timeout=None):
        self.calls.append(("delete", url, {}))
        return _FakeResponse(status_code=self.delete_status)


def _store(requests):
    store = ScheduleStore.__new__(ScheduleStore)
    store._requests = requests
    store._base_url = "https://supabase.example"
    store._headers = {"apikey": "key", "Authorization": "Bearer key"}
    return store


def _upload_row(**overrides):
    row = {
        "id": UPLOAD_ID,
        "user_id": USER_ID,
        "storage_path": f"{USER_ID}/direct-uploads/{UPLOAD_ID}.mp4",
        "declared_content_type": "video/mp4",
        "detected_content_type": "video/mp4",
        "size_bytes": 3,
        "status": "ready",
        "expires_at": "2026-11-20T12:00:00Z",
        "created_at": "2026-11-14T11:00:00Z",
        "consumed_at": None,
    }
    row.update(overrides)
    return row


class VideoUploadStoreTests(unittest.TestCase):
    def test_claim_video_upload_wins_only_when_still_ready(self):
        requests = _FakeRequests()
        requests.patch_rows = [_upload_row(status="consumed")]
        store = _store(requests)
        row = store.claim_video_upload(UPLOAD_ID)
        self.assertEqual(row["status"], "consumed")
        method, verb, url, kwargs = requests.calls[0]
        self.assertEqual((method, verb), ("request", "PATCH"))
        self.assertTrue(url.endswith("/rest/v1/video_uploads"))
        self.assertEqual(kwargs["params"]["id"], f"eq.{UPLOAD_ID}")
        self.assertEqual(kwargs["params"]["status"], "eq.ready")
        self.assertEqual(kwargs["json"]["status"], "consumed")
        self.assertIn("consumed_at", kwargs["json"])

    def test_claim_video_upload_loses_the_race(self):
        requests = _FakeRequests()
        requests.patch_rows = []
        store = _store(requests)
        self.assertIsNone(store.claim_video_upload(UPLOAD_ID))

    def test_get_video_upload_returns_the_row_or_none(self):
        requests = _FakeRequests()
        requests.get_rows = [_upload_row()]
        store = _store(requests)
        self.assertEqual(store.get_video_upload(UPLOAD_ID)["id"], UPLOAD_ID)
        self.assertTrue(requests.calls[0][2].endswith("/rest/v1/video_uploads"))
        requests.get_rows = []
        self.assertIsNone(store.get_video_upload(UPLOAD_ID))

    def test_download_storage_object_uses_the_authenticated_endpoint(self):
        requests = _FakeRequests()
        requests.get_content = b"video-bytes"
        store = _store(requests)
        self.assertEqual(
            store.download_storage_object("videos", f"{USER_ID}/direct-uploads/{UPLOAD_ID}.mp4"),
            b"video-bytes",
        )
        method, url, _kwargs = requests.calls[0]
        self.assertEqual(method, "get")
        self.assertEqual(
            url,
            f"https://supabase.example/storage/v1/object/authenticated/videos/{USER_ID}/direct-uploads/{UPLOAD_ID}.mp4",
        )

    def test_remove_storage_object_deletes_and_reports(self):
        requests = _FakeRequests()
        store = _store(requests)
        self.assertTrue(store.remove_storage_object("uploads", "scheduled-media/user-1/a.jpg"))
        method, url, _kwargs = requests.calls[0]
        self.assertEqual(method, "delete")
        self.assertEqual(
            url,
            "https://supabase.example/storage/v1/object/uploads/scheduled-media/user-1/a.jpg",
        )

    def test_remove_storage_object_never_raises(self):
        requests = _FakeRequests()
        requests.delete_status = 404
        store = _store(requests)
        self.assertFalse(store.remove_storage_object("uploads", "scheduled-media/user-1/a.jpg"))


def _media_slot(**overrides):
    slot = {
        "id": "slot-1",
        "task_id": None,
        "title": "Ready video",
        "description": "Edited outside.",
        "user_id": USER_ID,
        "charged_tokens": 0,
        "status": "ready",
        "media_kind": "upload",
        "media_ref": UPLOAD_ID,
        "media_content_type": "video/mp4",
        "schedules": {
            "id": "sched-1",
            "user_id": USER_ID,
            "persona_id": None,
            "providers": ["youtube"],
            "youtube_account_ids": ["UC1"],
        },
    }
    slot.update(overrides)
    return slot


def _published_result(providers=("youtube",)):
    return AccountPublishResult(
        outcomes=[
            {"provider": provider, "accountId": "acc-1", "status": "published"}
            for provider in providers
        ],
        published_providers=list(providers),
        max_attempts=1,
        any_published=True,
    )


class PublishExistingMediaTests(unittest.TestCase):
    def _publisher(self, store):
        task_state = MagicMock()
        task_state.get_task.return_value = None
        publisher = BatchPublisher(store, task_state, notify=MagicMock())
        publisher.base_url = "https://post-engineer.com"
        publisher.api_secret = "secret"
        return publisher

    def test_upload_slot_publishes_from_the_claimed_video(self):
        store = MagicMock()
        store.claim_ready_slot.return_value = True
        store.get_video_upload.return_value = _upload_row()
        store.claim_video_upload.return_value = _upload_row(status="consumed", consumed_at=CLAIMED_AT)
        store.download_storage_object.return_value = b"video-bytes"
        publisher = self._publisher(store)
        with patch(
            "app.services.fill_schedule.publish.publish_slot_accounts",
            return_value=_published_result(),
        ) as publish_accounts:
            published = publisher._publish_one(_media_slot(), NOW, resumed=False)
        self.assertEqual(published, 1)
        store.get_video_upload.assert_called_once_with(UPLOAD_ID)
        store.download_storage_object.assert_called_once_with(
            "videos", f"{USER_ID}/direct-uploads/{UPLOAD_ID}.mp4"
        )
        store.claim_video_upload.assert_called_once_with(UPLOAD_ID)
        # The claim is recorded on the slot: a resume trusts a `consumed`
        # row only when it is this claim.
        self.assertTrue(
            any(
                call.kwargs.get("media_claimed_at") == CLAIMED_AT
                for call in store.update_slot.call_args_list
            )
        )
        _args, kwargs = publish_accounts.call_args
        self.assertEqual(_args[2], [f"{UPLOAD_ID}.mp4"])
        self.assertEqual(kwargs["content_type"], "video/mp4")
        self.assertEqual(_args[3](), b"video-bytes")
        self.assertTrue(
            any(
                call.kwargs.get("status") == "published"
                for call in store.update_slot.call_args_list
            )
        )
        store.remove_storage_object.assert_called_once_with(
            "videos", f"{USER_ID}/direct-uploads/{UPLOAD_ID}.mp4"
        )
        store.refund_batch_tokens.assert_not_called()

    def test_image_slot_publishes_from_the_uploads_bucket(self):
        store = MagicMock()
        store.claim_ready_slot.return_value = True
        store.download_storage_object.return_value = b"image-bytes"
        publisher = self._publisher(store)
        slot = _media_slot(
            media_kind="image",
            media_ref="scheduled-media/user-1/a.jpg",
            media_content_type="image/jpeg",
            schedules={
                "id": "sched-1",
                "user_id": USER_ID,
                "persona_id": None,
                "providers": ["instagram"],
                "instagram_account_ids": ["ig-1"],
            },
        )
        with patch(
            "app.services.fill_schedule.publish.publish_slot_accounts",
            return_value=_published_result(("instagram",)),
        ) as publish_accounts:
            published = publisher._publish_one(slot, NOW, resumed=False)
        self.assertEqual(published, 1)
        store.download_storage_object.assert_called_once_with(
            "uploads", "scheduled-media/user-1/a.jpg"
        )
        _args, kwargs = publish_accounts.call_args
        self.assertEqual(_args[2], ["image.jpg"])
        self.assertEqual(kwargs["content_type"], "image/jpeg")
        self.assertEqual(_args[3](), b"image-bytes")
        store.remove_storage_object.assert_called_once_with(
            "uploads", "scheduled-media/user-1/a.jpg"
        )
        store.refund_batch_tokens.assert_not_called()

    def test_resumed_upload_slot_retries_and_cleans_up(self):
        # First attempt claims the upload, then the provider asks for a
        # retry: the slot stays `publishing` with the object still stored.
        # The resume must re-dispatch from the consumed claim instead of
        # failing permanently, and remove the object at the terminal
        # outcome.
        store = MagicMock()
        store.claim_ready_slot.return_value = True
        store.claim_resumable_slot.return_value = True
        store.get_video_upload.return_value = _upload_row()
        store.claim_video_upload.return_value = _upload_row(status="consumed", consumed_at=CLAIMED_AT)
        store.download_storage_object.return_value = b"video-bytes"
        publisher = self._publisher(store)
        retrying = AccountPublishResult(
            outcomes=[
                {
                    "provider": "youtube",
                    "accountId": "acc-1",
                    "status": "retrying",
                    "retryAt": "2026-11-14T12:05:00+00:00",
                }
            ],
            max_attempts=1,
            any_retrying=True,
            failure_reason="youtube rate limited",
        )
        with patch(
            "app.services.fill_schedule.publish.publish_slot_accounts",
            return_value=retrying,
        ):
            published = publisher._publish_one(_media_slot(), NOW, resumed=False)
        self.assertEqual(published, 0)
        store.claim_video_upload.assert_called_once_with(UPLOAD_ID)
        # The first attempt recorded its claim on the slot.
        self.assertTrue(
            any(
                call.kwargs.get("media_claimed_at") == CLAIMED_AT
                for call in store.update_slot.call_args_list
            )
        )
        # The object is still needed: no cleanup while retrying.
        store.remove_storage_object.assert_not_called()
        self.assertTrue(
            any(
                call.kwargs.get("status") == "publishing"
                for call in store.update_slot.call_args_list
            )
        )
        # Resume: the row is `consumed` by our own first attempt (the
        # tick re-read the slot with the recorded claim).
        store.get_video_upload.return_value = _upload_row(status="consumed", consumed_at=CLAIMED_AT)
        with patch(
            "app.services.fill_schedule.publish.publish_slot_accounts",
            return_value=_published_result(),
        ) as publish_accounts:
            published = publisher._publish_one(_media_slot(media_claimed_at=CLAIMED_AT), NOW, resumed=True)
        self.assertEqual(published, 1)
        # The provider was retried; the claim was not taken a second time.
        publish_accounts.assert_called_once()
        store.claim_video_upload.assert_called_once_with(UPLOAD_ID)
        self.assertTrue(
            any(
                call.kwargs.get("status") == "published"
                for call in store.update_slot.call_args_list
            )
        )
        store.remove_storage_object.assert_called_once_with(
            "videos", f"{USER_ID}/direct-uploads/{UPLOAD_ID}.mp4"
        )

    def test_lost_upload_claim_fails_permanently_without_dispatch(self):
        store = MagicMock()
        store.claim_ready_slot.return_value = True
        store.get_video_upload.return_value = _upload_row()
        store.claim_video_upload.return_value = None
        store.download_storage_object.return_value = b"video-bytes"
        publisher = self._publisher(store)
        with (
            patch(
                "app.services.fill_schedule.publish.publish_slot_accounts",
                return_value=_published_result(),
            ) as publish_accounts,
            patch("app.services.fill_schedule.publish.notify_owner_async"),
        ):
            published = publisher._publish_one(_media_slot(), NOW, resumed=False)
        self.assertEqual(published, 0)
        publish_accounts.assert_not_called()
        # The media path ran: bytes downloaded, then the claim lost.
        store.download_storage_object.assert_called_once_with(
            "videos", f"{USER_ID}/direct-uploads/{UPLOAD_ID}.mp4"
        )
        store.claim_video_upload.assert_called_once_with(UPLOAD_ID)
        self.assertTrue(
            any(call.kwargs.get("status") == "failed" for call in store.update_slot.call_args_list)
        )
        # The bytes were downloaded but the claim lost: the winner publishes,
        # so this slot must not remove the object out from under it.
        store.remove_storage_object.assert_not_called()
        store.refund_batch_tokens.assert_not_called()

    def test_image_path_outside_scheduled_media_fails_without_download(self):
        store = MagicMock()
        store.claim_ready_slot.return_value = True
        publisher = self._publisher(store)
        slot = _media_slot(
            media_kind="image",
            media_ref="other-bucket/evil.jpg",
            media_content_type="image/jpeg",
        )
        with (
            patch(
                "app.services.fill_schedule.publish.publish_slot_accounts",
                return_value=_published_result(),
            ) as publish_accounts,
            patch("app.services.fill_schedule.publish.notify_owner_async"),
        ):
            published = publisher._publish_one(slot, NOW, resumed=False)
        self.assertEqual(published, 0)
        store.download_storage_object.assert_not_called()
        publish_accounts.assert_not_called()
        failed = [
            call
            for call in store.update_slot.call_args_list
            if call.kwargs.get("status") == "failed"
        ]
        self.assertEqual(len(failed), 1)
        # The media path rejected the path itself — not the generic
        # "task has no finished videos" of a task-less generation slot.
        self.assertIn("scheduled image", str(failed[0].kwargs.get("error") or ""))

    def test_download_failure_leaves_the_slot_publishing_for_retry(self):
        store = MagicMock()
        store.claim_ready_slot.return_value = True
        store.get_video_upload.return_value = _upload_row()
        store.download_storage_object.side_effect = OSError("storage down")
        publisher = self._publisher(store)
        with patch(
            "app.services.fill_schedule.publish.publish_slot_accounts",
            return_value=_published_result(),
        ) as publish_accounts:
            published = publisher._publish_one(_media_slot(), NOW, resumed=False)
        self.assertEqual(published, 0)
        # Download runs before the claim: a storage outage never burns the
        # single-use row, and the slot waits out its lease for the next tick.
        store.claim_video_upload.assert_not_called()
        publish_accounts.assert_not_called()
        self.assertFalse(
            any(call.kwargs.get("status") == "failed" for call in store.update_slot.call_args_list)
        )
        self.assertTrue(
            any("publish_not_before" in call.kwargs for call in store.update_slot.call_args_list)
        )

    def test_taskless_slot_without_media_fails_exactly_as_before(self):
        store = MagicMock()
        store.claim_ready_slot.return_value = True
        publisher = self._publisher(store)
        slot = _media_slot(media_kind=None, media_ref=None, media_content_type=None)
        with (
            patch(
                "app.services.fill_schedule.publish.publish_slot_accounts",
                return_value=_published_result(),
            ) as publish_accounts,
            patch("app.services.fill_schedule.publish.notify_owner_async"),
        ):
            published = publisher._publish_one(slot, NOW, resumed=False)
        self.assertEqual(published, 0)
        publish_accounts.assert_not_called()
        failed = [
            call
            for call in store.update_slot.call_args_list
            if call.kwargs.get("status") == "failed"
        ]
        self.assertEqual(len(failed), 1)
        self.assertEqual(failed[0].kwargs.get("error"), "task has no finished videos")


class ResolveExistingMediaDirectTests(unittest.TestCase):
    """Direct tests for the extracted resolver (mutmut attributes per file)."""

    def test_upload_resolves_with_download_before_claim(self):
        store = MagicMock()
        store.get_video_upload.return_value = _upload_row()
        store.claim_video_upload.return_value = _upload_row(status="consumed")
        store.download_storage_object.return_value = b"video-bytes"
        fail = MagicMock()
        resolved = resolve_existing_media(store, fail, _media_slot(), NOW)
        self.assertIsNotNone(resolved)
        assert resolved is not None
        videos, reader, content_type, cleanup = resolved
        self.assertEqual(videos, [f"{UPLOAD_ID}.mp4"])
        self.assertEqual(reader(), b"video-bytes")
        self.assertEqual(content_type, "video/mp4")
        self.assertEqual(cleanup, ("videos", f"{USER_ID}/direct-uploads/{UPLOAD_ID}.mp4"))
        fail.assert_not_called()
        calls = [call[0] for call in store.method_calls]
        self.assertLess(calls.index("download_storage_object"), calls.index("claim_video_upload"))

    def test_upload_download_failure_retries_without_fail_or_claim(self):
        store = MagicMock()
        store.get_video_upload.return_value = _upload_row()
        store.download_storage_object.side_effect = OSError("storage down")
        fail = MagicMock()
        self.assertIsNone(resolve_existing_media(store, fail, _media_slot(), NOW))
        fail.assert_not_called()
        store.claim_video_upload.assert_not_called()
        store.update_slot.assert_called_once()
        _args, kwargs = store.update_slot.call_args
        self.assertIn("publish_not_before", kwargs)

    def test_upload_missing_row_fails_permanently(self):
        store = MagicMock()
        store.get_video_upload.return_value = None
        fail = MagicMock()
        self.assertIsNone(resolve_existing_media(store, fail, _media_slot(), NOW))
        fail.assert_called_once()
        self.assertEqual(fail.call_args[0][0], "scheduled video upload not found")

    def test_upload_foreign_row_fails_permanently(self):
        store = MagicMock()
        store.get_video_upload.return_value = _upload_row(user_id="someone-else")
        fail = MagicMock()
        self.assertIsNone(resolve_existing_media(store, fail, _media_slot(), NOW))
        fail.assert_called_once()
        self.assertEqual(fail.call_args[0][0], "scheduled video upload not found")

    def test_upload_consumed_row_fails_permanently(self):
        store = MagicMock()
        store.get_video_upload.return_value = _upload_row(status="consumed")
        fail = MagicMock()
        self.assertIsNone(resolve_existing_media(store, fail, _media_slot(), NOW))
        fail.assert_called_once()
        self.assertEqual(fail.call_args[0][0], "scheduled video upload is no longer ready")

    def test_upload_consumed_row_resolves_on_resume(self):
        # The resume re-uses the claim its own first attempt won: the row
        # is `consumed` by then, so a fresh `ready` check would fail the
        # slot permanently and leak the claimed object.
        store = MagicMock()
        store.get_video_upload.return_value = _upload_row(status="consumed", consumed_at=CLAIMED_AT)
        store.download_storage_object.return_value = b"video-bytes"
        fail = MagicMock()
        # Same instant, different spelling: the comparison is on instants,
        # not strings (PostgREST re-serializes timestamptz).
        slot = _media_slot(media_claimed_at="2026-11-14T11:30:00.000000+00:00")
        resolved = resolve_existing_media(store, fail, slot, NOW, resumed=True)
        self.assertIsNotNone(resolved)
        assert resolved is not None
        videos, reader, content_type, cleanup = resolved
        self.assertEqual(videos, [f"{UPLOAD_ID}.mp4"])
        self.assertEqual(reader(), b"video-bytes")
        self.assertEqual(content_type, "video/mp4")
        self.assertEqual(cleanup, ("videos", f"{USER_ID}/direct-uploads/{UPLOAD_ID}.mp4"))
        fail.assert_not_called()
        store.claim_video_upload.assert_not_called()

    def test_upload_consumed_row_with_foreign_claim_fails_permanently_on_resume(self):
        # Another consumer (a second slot with the same upload id, or an
        # ASAP publish) claimed the row: trusting it would double-publish
        # media that is already live, or re-download an object that is
        # already gone.
        store = MagicMock()
        store.get_video_upload.return_value = _upload_row(status="consumed", consumed_at=CLAIMED_AT)
        fail = MagicMock()
        slot = _media_slot(media_claimed_at="2026-11-14T10:00:00+00:00")
        self.assertIsNone(resolve_existing_media(store, fail, slot, NOW, resumed=True))
        fail.assert_called_once()
        self.assertEqual(fail.call_args[0][0], "scheduled video upload is no longer ready")
        store.download_storage_object.assert_not_called()
        store.claim_video_upload.assert_not_called()

    def test_upload_consumed_row_without_recorded_claim_fails_permanently_on_resume(self):
        # No recorded claim on the slot (a pre-migration row, or a crash
        # between the claim and the record): ownership cannot be proven,
        # so the resume fails closed instead of trusting the row.
        store = MagicMock()
        store.get_video_upload.return_value = _upload_row(status="consumed", consumed_at=CLAIMED_AT)
        fail = MagicMock()
        self.assertIsNone(resolve_existing_media(store, fail, _media_slot(), NOW, resumed=True))
        fail.assert_called_once()
        self.assertEqual(fail.call_args[0][0], "scheduled video upload is no longer ready")
        store.download_storage_object.assert_not_called()

    def test_upload_gone_object_fails_permanently_on_resume(self):
        # The object is gone (another consumer published and cleaned it
        # up): parking would retry it on every tick forever.
        store = MagicMock()
        store.get_video_upload.return_value = _upload_row(status="consumed", consumed_at=CLAIMED_AT)
        store.download_storage_object.side_effect = _not_found_error()
        fail = MagicMock()
        slot = _media_slot(media_claimed_at=CLAIMED_AT)
        self.assertIsNone(resolve_existing_media(store, fail, slot, NOW, resumed=True))
        fail.assert_called_once()
        self.assertEqual(fail.call_args[0][0], "scheduled video upload file is gone")
        self.assertFalse(
            any("publish_not_before" in call.kwargs for call in store.update_slot.call_args_list)
        )

    def test_upload_gone_object_fails_permanently_on_first_attempt(self):
        # A missing object never comes back, so the first attempt fails
        # permanently instead of parking; the single-use row is not burned.
        store = MagicMock()
        store.get_video_upload.return_value = _upload_row()
        store.download_storage_object.side_effect = _not_found_error()
        fail = MagicMock()
        self.assertIsNone(resolve_existing_media(store, fail, _media_slot(), NOW))
        fail.assert_called_once()
        self.assertEqual(fail.call_args[0][0], "scheduled video upload file is gone")
        store.claim_video_upload.assert_not_called()
        self.assertFalse(
            any("publish_not_before" in call.kwargs for call in store.update_slot.call_args_list)
        )

    def test_image_resolves_from_the_uploads_bucket(self):
        store = MagicMock()
        store.download_storage_object.return_value = b"png-bytes"
        fail = MagicMock()
        slot = _media_slot(
            media_kind="image",
            media_ref="scheduled-media/user-1/a.png",
            media_content_type="image/png",
        )
        resolved = resolve_existing_media(store, fail, slot, NOW)
        self.assertIsNotNone(resolved)
        assert resolved is not None
        videos, reader, content_type, cleanup = resolved
        self.assertEqual(videos, ["image.png"])
        self.assertEqual(reader(), b"png-bytes")
        self.assertEqual(content_type, "image/png")
        self.assertIsNone(cleanup)
        store.download_storage_object.assert_called_once_with(
            "uploads", "scheduled-media/user-1/a.png"
        )
        fail.assert_not_called()

    def test_image_cleanup_accepts_only_the_slots_own_prefix(self):
        own = _media_slot(media_kind="image", media_ref="scheduled-media/user-1/a.jpg")
        self.assertEqual(image_cleanup(own), ("uploads", "scheduled-media/user-1/a.jpg"))
        other_user = _media_slot(media_kind="image", media_ref="scheduled-media/user-2/a.jpg")
        self.assertIsNone(image_cleanup(other_user))
        self.assertIsNone(image_cleanup(_media_slot(media_kind="image", media_ref="other/a.jpg")))
        self.assertIsNone(image_cleanup(_media_slot(media_kind="upload", media_ref=UPLOAD_ID)))
        # Dot segments escape the owner prefix when the storage gateway
        # normalizes them, so they are rejected even under the prefix.
        self.assertIsNone(
            image_cleanup(
                _media_slot(media_kind="image", media_ref="scheduled-media/user-1/../../user-2/x.jpg")
            )
        )
        self.assertIsNone(
            image_cleanup(_media_slot(media_kind="image", media_ref="scheduled-media/user-1/./x.jpg"))
        )
        self.assertIsNone(
            image_cleanup(_media_slot(media_kind="image", media_ref="scheduled-media/user-1//x.jpg"))
        )

    def test_cleanup_existing_media_removes_and_warns_on_failure(self):
        store = MagicMock()
        store.remove_storage_object.return_value = True
        slot = _media_slot()
        cleanup_existing_media(store, slot, ("uploads", "scheduled-media/user-1/a.jpg"))
        store.remove_storage_object.assert_called_once_with(
            "uploads", "scheduled-media/user-1/a.jpg"
        )
        store.remove_storage_object.return_value = False
        with patch("app.services.fill_schedule.publish_existing_media.logger") as log:
            cleanup_existing_media(store, slot, ("uploads", "scheduled-media/user-1/a.jpg"))
        log.warning.assert_called_once()
        cleanup_existing_media(store, slot, None)
        self.assertEqual(store.remove_storage_object.call_count, 2)


class PublishAccountsContentTypeTests(unittest.TestCase):
    """publish_slot_accounts threads the media content type to the upload API."""

    def test_image_content_type_reaches_the_upload_call(self):
        from app.services.fill_schedule.publish_accounts import publish_slot_accounts

        calls: list[dict] = []

        def publish_video(**kwargs):
            calls.append(kwargs)
            return {
                "success": True,
                "results": [{"accountId": "ig-1", "success": True, "postId": "ig-post-1"}],
            }

        slot = {"id": "slot-1", "publish_outcomes": []}
        schedule = {
            "id": "sched-1",
            "user_id": USER_ID,
            "providers": ["instagram"],
            "instagram_account_ids": ["ig-1"],
        }
        result = publish_slot_accounts(
            slot,
            schedule,
            ["image.jpg"],
            lambda: b"image-bytes",
            NOW,
            "Sunset photo",
            "Edited photo.",
            base_url="https://post-engineer.com",
            api_secret="secret",
            publish_video=publish_video,
            persist_outcomes=lambda _outcomes, _fields: None,
            record_results=None,
            content_type="image/jpeg",
        )
        self.assertTrue(result.any_published)
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0]["content_type"], "image/jpeg")
        self.assertEqual(calls[0]["video_path"], "image.jpg")
        self.assertEqual(calls[0]["video_bytes"], b"image-bytes")

    def test_video_content_type_defaults_to_mp4(self):
        from app.services.fill_schedule.publish_accounts import publish_slot_accounts

        calls: list[dict] = []

        def publish_video(**kwargs):
            calls.append(kwargs)
            return {
                "success": True,
                "results": [{"accountId": "UC1", "success": True, "videoId": "vid-1"}],
            }

        slot = {"id": "slot-1", "publish_outcomes": []}
        schedule = {
            "id": "sched-1",
            "user_id": USER_ID,
            "providers": ["youtube"],
            "youtube_account_ids": ["UC1"],
        }
        result = publish_slot_accounts(
            slot,
            schedule,
            ["final-1.mp4"],
            lambda: b"video-bytes",
            NOW,
            "Porto walk",
            "Walking the riverside.",
            base_url="https://post-engineer.com",
            api_secret="secret",
            publish_video=publish_video,
            persist_outcomes=lambda _outcomes, _fields: None,
            record_results=None,
        )
        self.assertTrue(result.any_published)
        self.assertEqual(calls[0]["content_type"], "video/mp4")


class PublishExistingMediaSchedulerTests(unittest.TestCase):
    """End to end through the scheduler: a media slot publishes with no task."""

    def test_image_slot_publishes_through_the_real_account_loop(self):
        slot = _media_slot(
            media_kind="image",
            media_ref="scheduled-media/user-1/a.jpg",
            media_content_type="image/jpeg",
            schedules={
                "id": "sched-1",
                "user_id": USER_ID,
                "persona_id": None,
                "providers": ["instagram"],
                "instagram_account_ids": ["ig-1"],
            },
        )
        store = MagicMock()
        store.ready_due_slots.return_value = [dict(slot)]
        store.claim_ready_slot.return_value = True
        store.resumable_publishing_slots.return_value = []
        store.download_storage_object.return_value = b"image-bytes"
        task_state = MagicMock()
        task_state.get_task.return_value = None
        calls: list[dict] = []

        def publish_video(**kwargs):
            calls.append(kwargs)
            return {
                "success": True,
                "results": [{"accountId": "ig-1", "success": True, "postId": "ig-post-1"}],
            }

        scheduler = FillScheduleScheduler(
            store=store,
            task_state=task_state,
            publish_video=publish_video,
            notify=MagicMock(),
        )
        scheduler.publisher.base_url = "https://post-engineer.com"
        scheduler.publisher.api_secret = "secret"
        self.assertEqual(scheduler.publish_due(NOW), 1)
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0]["content_type"], "image/jpeg")
        self.assertEqual(calls[0]["video_bytes"], b"image-bytes")
        self.assertTrue(
            any(
                call.kwargs.get("status") == "published"
                for call in store.update_slot.call_args_list
            )
        )
        store.remove_storage_object.assert_called_once_with(
            "uploads", "scheduled-media/user-1/a.jpg"
        )


if __name__ == "__main__":
    unittest.main()
