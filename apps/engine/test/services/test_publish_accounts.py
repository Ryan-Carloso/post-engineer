"""Per-account publish retry (issue #500).

A recorded success is never posted again. A user-account error fails that
account at once and is notified while the slot is still publishing. A
transient error waits 30s, then 2min, then fails once.
"""

from __future__ import annotations

import os
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock

from app.services.fill_schedule import FillScheduleScheduler
from app.services.fill_schedule.account_outcomes import classify_failure, next_delay_seconds
from app.services.upload_publisher import PublishError

UTC = timezone.utc
NOW = datetime(2026, 9, 7, 12, 0, tzinfo=UTC)
EMAIL = (
    "Bluesky did not publish because the email on this account is not verified. "
    "This is a problem with your account. Only you can fix it: verify the email."
)


class _MemoryStore:
    def __init__(self, slot: dict):
        self.slot = slot
        self.updates: list[tuple[str, dict]] = []
        self.refund_batch_calls: list[tuple] = []

    def recover_stale_publishing(self) -> int:
        return 0

    def ready_due_slots(self, now: datetime) -> list[dict]:
        status = self.slot.get("status", "ready")
        if status != "ready":
            return []
        return [dict(self.slot)]

    def claim_ready_slot(self, slot_id: str) -> bool:
        if self.slot.get("status", "ready") != "ready":
            return False
        self.slot["status"] = "publishing"
        return True

    def resumable_publishing_slots(self, now: datetime) -> list[dict]:
        if self.slot.get("status") != "publishing":
            return []
        not_before = self.slot.get("publish_not_before")
        if isinstance(not_before, str) and not_before > now.isoformat():
            return []
        return [dict(self.slot)]

    def claim_resumable_slot(self, slot_id: str, now_iso: str, lease_iso: str) -> bool:
        if self.slot.get("status") != "publishing":
            return False
        not_before = self.slot.get("publish_not_before")
        if isinstance(not_before, str) and not_before > now_iso:
            return False
        self.slot["publish_not_before"] = lease_iso
        return True

    def update_slot(self, slot_id: str, **fields) -> None:
        self.updates.append((slot_id, dict(fields)))
        self.slot.update(fields)

    def refund_batch_tokens(self, *args, **kwargs) -> bool:
        self.refund_batch_calls.append(args)
        return True


class AccountRetryTests(unittest.TestCase):
    def setUp(self) -> None:
        from app.services import video_storage
        from unittest.mock import patch

        storage = patch.object(video_storage, "read_final_video_r2", return_value=b"fake-video-bytes")
        storage.start()
        self.addCleanup(storage.stop)
        handle, self.video_path = tempfile.mkstemp(suffix=".mp4")
        with os.fdopen(handle, "wb") as video_file:
            video_file.write(b"fake-video-bytes")
        self.addCleanup(os.unlink, self.video_path)

    def _slot(self, providers: list[str]) -> dict:
        return {
            "id": "slot-1",
            "title": "Porto coffee",
            "task_id": "t-1",
            "charged_tokens": 1,
            "publish_attempts": 0,
            "schedules": {
                "id": "sched-1",
                "user_id": "user-1",
                "providers": providers,
                "bluesky_account_ids": ["bsky-1"],
                "personas": {"name": "Ana"},
            },
        }

    def _scheduler(self, store: _MemoryStore, publish, notify=None):
        state = MagicMock()
        state.get_task.return_value = {
            "state": 1,
            "videos": [self.video_path],
            "video_storage_path": "user-1/faceless/t-1/final-1.mp4",
        }
        scheduler = FillScheduleScheduler(
            store=store,
            task_state=state,
            publish_video=publish,
            notify=notify or MagicMock(),
        )
        scheduler.publisher.base_url = "https://post-engineer.com"
        scheduler.publisher.api_secret = "secret"
        return scheduler

    def test_kill_mid_publish_does_not_repost_the_account_that_succeeded(self) -> None:
        store = _MemoryStore(self._slot(["youtube", "bluesky"]))
        calls: list[str] = []
        killed = False

        def publish(**kwargs):
            nonlocal killed
            name = type(kwargs["metadata"]).__name__
            calls.append(name)
            if name == "YouTubeMetadata":
                return {"success": True, "results": [{"success": True, "videoUrl": "https://youtu.be/abc"}]}
            if not killed:
                killed = True
                raise RuntimeError("killed")
            return {"postId": "at://did/post/abc"}

        scheduler = self._scheduler(store, publish)
        with self.assertRaises(RuntimeError):
            scheduler.publish_due(NOW)

        calls.clear()
        scheduler.publish_due(NOW + timedelta(minutes=31))
        self.assertEqual(calls, ["BlueskyMetadata"])
        self.assertEqual(store.slot["status"], "published")
        self.assertEqual(store.refund_batch_calls, [])
        youtube = next(item for item in store.slot["publish_outcomes"] if item["provider"] == "youtube")
        self.assertEqual(youtube["status"], "published")
        self.assertEqual(youtube["videoUrl"], "https://youtu.be/abc")

    def test_unverified_email_notifies_while_the_other_account_is_still_retrying(self) -> None:
        store = _MemoryStore(self._slot(["bluesky", "youtube"]))
        calls: list[str] = []
        notify = MagicMock()

        def publish(**kwargs):
            name = type(kwargs["metadata"]).__name__
            calls.append(name)
            if name == "BlueskyMetadata":
                return {
                    "success": False,
                    "results": [{
                        "accountId": "bsky-1",
                        "success": False,
                        "error": "Bluesky email is not verified.",
                        "errorCode": "email_not_verified",
                    }],
                }
            raise PublishError("upload API returned HTTP 503", status_code=503)

        scheduler = self._scheduler(store, publish, notify=notify)
        published = scheduler.publish_due(NOW)
        self.assertEqual(published, 0)
        self.assertEqual(store.slot["status"], "publishing")
        notify.assert_called_once()
        self.assertIn(EMAIL, notify.call_args.args[0])
        self.assertNotIn("❌", notify.call_args.args[0])
        bluesky = next(item for item in store.slot["publish_outcomes"] if item["provider"] == "bluesky")
        self.assertEqual(bluesky["status"], "failed")
        self.assertTrue(bluesky["requiresUser"])

        calls.clear()
        scheduler.publish_due(NOW + timedelta(seconds=30))
        self.assertEqual(calls, ["YouTubeMetadata"])
        self.assertEqual(store.refund_batch_calls, [])

    def test_three_transient_failures_notify_once_without_the_user_sentence(self) -> None:
        store = _MemoryStore(self._slot(["youtube"]))
        notify = MagicMock()

        def publish(**kwargs):
            raise PublishError("quota exceeded")

        scheduler = self._scheduler(store, publish, notify=notify)
        self.assertEqual(scheduler.publish_due(NOW), 0)
        self.assertEqual(store.slot["status"], "publishing")
        self.assertEqual(store.slot["publish_not_before"], "2026-09-07T12:00:30+00:00")
        notify.assert_not_called()

        self.assertEqual(scheduler.publish_due(NOW + timedelta(seconds=15)), 0)
        notify.assert_not_called()

        self.assertEqual(scheduler.publish_due(NOW + timedelta(seconds=30)), 0)
        self.assertEqual(store.slot["publish_not_before"], "2026-09-07T12:02:30+00:00")
        notify.assert_not_called()

        self.assertEqual(scheduler.publish_due(NOW + timedelta(seconds=150)), 0)
        self.assertEqual(store.slot["status"], "failed")
        self.assertEqual(store.slot["publish_attempts"], 3)
        notify.assert_called_once()
        message = notify.call_args.args[0]
        self.assertIn("❌", message)
        self.assertIn("quota exceeded", message)
        self.assertNotIn("Only you can fix", message)
        self.assertEqual(len(store.refund_batch_calls), 1)
        self.assertIn("3 attempts", store.refund_batch_calls[0][4])

    def test_partial_success_does_not_refund_or_republish(self) -> None:
        store = _MemoryStore(self._slot(["youtube", "bluesky"]))
        calls: list[str] = []

        def publish(**kwargs):
            name = type(kwargs["metadata"]).__name__
            calls.append(name)
            if name == "YouTubeMetadata":
                return {"success": True, "results": [{"success": True, "videoUrl": "https://youtu.be/abc"}]}
            raise PublishError("upload API returned HTTP 500", status_code=500)

        scheduler = self._scheduler(store, publish)
        self.assertEqual(scheduler.publish_due(NOW), 0)
        self.assertEqual(store.slot["status"], "publishing")
        self.assertEqual(store.refund_batch_calls, [])

        calls.clear()
        scheduler.publish_due(NOW + timedelta(seconds=30))
        self.assertEqual(calls, ["BlueskyMetadata"])
        youtube = next(item for item in store.slot["publish_outcomes"] if item["provider"] == "youtube")
        self.assertEqual(youtube["status"], "published")

    def test_delay_and_caption_classification(self) -> None:
        self.assertEqual(next_delay_seconds(1), 30)
        self.assertEqual(next_delay_seconds(2), 120)
        self.assertIsNone(next_delay_seconds(3))
        self.assertEqual(classify_failure("Invalid caption", None, 400), ("publish_rejected", False))
        self.assertEqual(classify_failure("account disconnected", None, 200), ("disconnected", True))
