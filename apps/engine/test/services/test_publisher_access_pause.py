import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from app.services.publisher.publish import BatchPublisher

NOW = datetime(2026, 11, 26, 12, 0, tzinfo=timezone.utc)
FUTURE = (NOW + timedelta(days=2)).isoformat()
PAST = (NOW - timedelta(days=1)).isoformat()
UPLOAD_ID = "22222222-2222-4222-8222-222222222222"


def _slot(slot_id="slot-1", user_id="user-1", status="ready", media_kind="image", media_ref=None):
    ref = media_ref if media_ref is not None else (UPLOAD_ID if media_kind == "upload" else f"scheduled-media/{user_id}/a.jpg")
    return {
        "id": slot_id,
        "title": "Post",
        "description": "",
        "user_id": user_id,
        "status": status,
        "media_kind": media_kind,
        "media_ref": ref,
        "media_content_type": "image/jpeg" if media_kind == "image" else "video/mp4",
        "schedules": {
            "id": "sched-1",
            "user_id": user_id,
            "persona_id": None,
            "providers": ["youtube"],
            "youtube_account_ids": ["UC1"],
            "personas": {"name": "Persona"},
        },
    }


def _publisher(store):
    publisher = BatchPublisher(store, notify=MagicMock())
    publisher.base_url = "https://example.com"
    publisher.api_secret = "secret"
    return publisher


def _store(due=None, resumable=None, access=None):
    store = MagicMock()
    store.ready_due_slots.return_value = due or []
    store.resumable_publishing_slots.return_value = resumable or []
    store.access_until_by_user.return_value = access or {}
    store.claim_ready_slot.return_value = True
    store.claim_resumable_slot.return_value = True
    store.expire_ready_slot.return_value = True
    store.remove_storage_object.return_value = True
    return store


class AccessPauseTests(unittest.TestCase):
    def test_trial_still_running_publishes(self):
        store = _store(due=[_slot()], access={"user-1": FUTURE})
        store.get_video_upload.return_value = {"storage_path": "user-1/x.mp4", "status": "ready", "user_id": "user-1"}
        publisher = _publisher(store)
        with patch.object(BatchPublisher, "_publish_one", return_value=1) as publish_one:
            self.assertEqual(publisher.run(NOW), 1)
        publish_one.assert_called_once()
        store.expire_ready_slot.assert_not_called()

    def test_paid_period_still_running_publishes(self):
        paid_through = (NOW + timedelta(days=200)).isoformat()
        store = _store(due=[_slot()], access={"user-1": paid_through})
        publisher = _publisher(store)
        with patch.object(BatchPublisher, "_publish_one", return_value=1) as publish_one:
            self.assertEqual(publisher.run(NOW), 1)
        publish_one.assert_called_once()
        store.expire_ready_slot.assert_not_called()

    def test_past_due_grace_window_still_publishes(self):
        grace = (NOW + timedelta(days=2)).isoformat()
        store = _store(due=[_slot()], access={"user-1": grace})
        publisher = _publisher(store)
        with patch.object(BatchPublisher, "_publish_one", return_value=1) as publish_one:
            self.assertEqual(publisher.run(NOW), 1)
        publish_one.assert_called_once()

    def test_trial_ended_expires_exactly_once(self):
        store = _store(due=[_slot()], access={"user-1": PAST})
        publisher = _publisher(store)
        with patch("app.services.publisher.publish.notify_owner_async") as notify_owner, patch(
            "app.services.publisher.publish.track_event"
        ) as track:
            self.assertEqual(publisher.run(NOW), 0)
            store.ready_due_slots.return_value = []
            self.assertEqual(publisher.run(NOW), 0)
        store.expire_ready_slot.assert_called_once_with("slot-1", NOW)
        notify_owner.assert_not_called()
        self.assertFalse(any(call.args and call.args[0] == "video_publish_failed" for call in track.call_args_list))

    def test_cancelled_subscription_expires_a_due_slot(self):
        store = _store(due=[_slot()], access={"user-1": NOW.isoformat()})
        publisher = _publisher(store)
        with patch.object(BatchPublisher, "_publish_one", return_value=1) as publish_one:
            self.assertEqual(publisher.run(NOW), 0)
        publish_one.assert_not_called()
        store.expire_ready_slot.assert_called_once_with("slot-1", NOW)

    def test_refunded_subscription_expires_a_due_slot(self):
        store = _store(due=[_slot()], access={"user-1": (NOW - timedelta(hours=3)).isoformat()})
        publisher = _publisher(store)
        with patch.object(BatchPublisher, "_publish_one", return_value=1) as publish_one:
            self.assertEqual(publisher.run(NOW), 0)
        publish_one.assert_not_called()
        store.expire_ready_slot.assert_called_once_with("slot-1", NOW)

    def test_expire_is_terminal_only_when_claim_wins(self):
        store = _store(due=[_slot()], access={"user-1": PAST})
        store.expire_ready_slot.return_value = False
        publisher = _publisher(store)
        self.assertEqual(publisher.run(NOW), 0)
        store.remove_storage_object.assert_not_called()

    def test_inactive_future_ready_is_not_in_due_list(self):
        store = _store(due=[], access={"user-1": PAST})
        publisher = _publisher(store)
        self.assertEqual(publisher.run(NOW), 0)
        store.expire_ready_slot.assert_not_called()

    def test_resumable_skipped_while_paused_and_resumes_after_reactivation(self):
        slot = _slot(status="publishing")
        store = _store(resumable=[slot], access={"user-1": PAST})
        publisher = _publisher(store)
        with patch.object(BatchPublisher, "_publish_one", return_value=1) as publish_one:
            self.assertEqual(publisher.run(NOW), 0)
            publish_one.assert_not_called()
            store.access_until_by_user.return_value = {"user-1": FUTURE}
            self.assertEqual(publisher.run(NOW), 1)
            publish_one.assert_called_once()

    def test_lookup_error_skips_only_affected_user(self):
        good = _slot("slot-good", "user-good")
        bad = _slot("slot-bad", "user-bad")

        store = _store(due=[good, bad], access={"user-good": FUTURE})
        publisher = _publisher(store)
        with patch.object(BatchPublisher, "_publish_one", return_value=1) as publish_one:
            publisher.run(NOW)
        self.assertEqual(publish_one.call_count, 1)
        self.assertEqual(publish_one.call_args.args[0]["id"], "slot-good")
        store.expire_ready_slot.assert_not_called()

    def test_lookup_error_for_one_chunk_skips_that_user_without_expire(self):
        slot = _slot()
        store = _store(due=[slot])
        store.access_until_by_user.side_effect = RuntimeError("db down")
        publisher = _publisher(store)
        with patch.object(BatchPublisher, "_publish_one", return_value=1) as publish_one:
            self.assertEqual(publisher.run(NOW), 0)
        publish_one.assert_not_called()
        store.expire_ready_slot.assert_not_called()

    def test_expire_cleans_up_image_media(self):
        store = _store(due=[_slot(media_kind="image")], access={"user-1": PAST})
        publisher = _publisher(store)
        publisher.run(NOW)
        store.remove_storage_object.assert_called_once_with("uploads", "scheduled-media/user-1/a.jpg")

    def test_expire_cleans_up_upload_media(self):
        store = _store(due=[_slot(media_kind="upload")], access={"user-1": PAST})
        store.get_video_upload.return_value = {"user_id": "user-1", "storage_path": "user-1/direct-uploads/x.mp4", "status": "ready"}
        publisher = _publisher(store)
        publisher.run(NOW)
        store.remove_storage_object.assert_called_once_with("videos", "user-1/direct-uploads/x.mp4")

    def test_expire_keeps_an_upload_owned_by_another_user(self):
        store = _store(due=[_slot(media_kind="upload")], access={"user-1": PAST})
        store.get_video_upload.return_value = {"user_id": "user-2", "storage_path": "user-2/direct-uploads/x.mp4", "status": "ready"}
        publisher = _publisher(store)
        publisher.run(NOW)
        store.remove_storage_object.assert_not_called()
        store.expire_ready_slot.assert_called_once_with("slot-1", NOW)

    def test_expire_survives_an_upload_lookup_failure_without_cleanup(self):
        store = _store(due=[_slot(media_kind="upload")], access={"user-1": PAST})
        store.get_video_upload.side_effect = RuntimeError("db down")
        publisher = _publisher(store)
        self.assertEqual(publisher.run(NOW), 0)
        store.expire_ready_slot.assert_called_once_with("slot-1", NOW)
        store.remove_storage_object.assert_not_called()

    def test_expire_skips_cleanup_when_the_upload_row_is_not_a_dict(self):
        store = _store(due=[_slot(media_kind="upload")], access={"user-1": PAST})
        store.get_video_upload.return_value = "junk"
        publisher = _publisher(store)
        publisher.run(NOW)
        store.remove_storage_object.assert_not_called()

    def test_expire_skips_cleanup_when_the_upload_has_no_storage_path(self):
        store = _store(due=[_slot(media_kind="upload")], access={"user-1": PAST})
        store.get_video_upload.return_value = {"storage_path": None}
        publisher = _publisher(store)
        publisher.run(NOW)
        store.remove_storage_object.assert_not_called()

    def test_expire_skips_cleanup_when_the_slot_has_no_media_ref(self):
        slot = _slot(media_kind="upload")
        slot["media_ref"] = ""
        store = _store(due=[slot], access={"user-1": PAST})
        publisher = _publisher(store)
        publisher.run(NOW)
        store.get_video_upload.assert_not_called()
        store.remove_storage_object.assert_not_called()

    def test_expire_falls_back_to_a_plain_update_without_the_claim_method(self):
        store = _store(due=[_slot()], access={"user-1": PAST})
        del store.expire_ready_slot
        publisher = _publisher(store)
        publisher.run(NOW)
        store.update_slot.assert_called_once_with("slot-1", status="expired", publish_not_before=None)

    def test_expire_failure_keeps_the_slot_for_the_next_tick(self):
        store = _store(due=[_slot()], access={"user-1": PAST})
        store.expire_ready_slot.side_effect = RuntimeError("db down")
        publisher = _publisher(store)
        self.assertEqual(publisher.run(NOW), 0)
        store.remove_storage_object.assert_not_called()

    def test_expire_does_not_notify_or_emit_failure_event(self):
        store = _store(due=[_slot()], access={"user-1": PAST})
        publisher = _publisher(store)
        with patch("app.services.publisher.publish.notify_owner_async") as notify_owner, patch(
            "app.services.publisher.publish.track_event"
        ) as track:
            publisher.run(NOW)
        notify_owner.assert_not_called()
        track.assert_not_called()


if __name__ == "__main__":
    unittest.main()
