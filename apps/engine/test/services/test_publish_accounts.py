"""Per-account publish retry (issue #500).

A recorded success is never posted again. A user-account error fails that
account at once and is notified while the slot is still publishing. A
transient error waits 30s, then 2min, then fails once.
"""

from __future__ import annotations

import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

from app.services.fill_schedule import FillScheduleScheduler
from app.services.fill_schedule import publish as publish_module
from app.services.fill_schedule.account_outcomes import classify_failure, next_delay_seconds
from app.services.upload_publisher import PublishError

UTC = timezone.utc
NOW = datetime(2026, 9, 7, 12, 0, tzinfo=UTC)
UPLOAD_ID = "22222222-2222-4222-8222-222222222222"
CLAIMED_AT = "2026-09-07T12:00:00+00:00"
EMAIL = (
    "Bluesky did not publish because the email on this account is not verified. "
    "This is a problem with your account. Only you can fix it: verify the email on Bluesky."
)


class _MemoryStore:
    def __init__(self, slot: dict):
        self.slot = slot
        self.updates: list[tuple[str, dict]] = []
        self.upload = {
            "id": UPLOAD_ID,
            "user_id": "user-1",
            "storage_path": f"user-1/direct-uploads/{UPLOAD_ID}.mp4",
            "declared_content_type": "video/mp4",
            "status": "ready",
            "consumed_at": None,
        }
        self.removed: list[tuple[str, str]] = []

    def ready_due_slots(self, now: datetime) -> list[dict]:
        status = self.slot.get("status", "ready")
        if status != "ready":
            return []
        return [dict(self.slot)]

    def claim_ready_slot(self, slot_id: str, now_utc=None) -> bool:
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

    def get_video_upload(self, upload_id: str) -> dict | None:
        return dict(self.upload) if upload_id == self.upload["id"] else None

    def claim_video_upload(self, upload_id: str) -> dict | None:
        if upload_id != self.upload["id"] or self.upload["status"] != "ready":
            return None
        self.upload.update(status="consumed", consumed_at=CLAIMED_AT)
        return dict(self.upload)

    def download_storage_object(self, bucket: str, path: str) -> bytes:
        return b"fake-video-bytes"

    def remove_storage_object(self, bucket: str, path: str) -> bool:
        self.removed.append((bucket, path))
        return True


class AccountRetryTests(unittest.TestCase):
    def _slot(self, providers: list[str]) -> dict:
        return {
            "id": "slot-1",
            "title": "Porto coffee",
            "description": "Porto coffee description.",
            "user_id": "user-1",
            "media_kind": "upload",
            "media_ref": UPLOAD_ID,
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
        scheduler = FillScheduleScheduler(
            store=store,
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

    def test_partial_success_does_not_republish(self) -> None:
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

        calls.clear()
        scheduler.publish_due(NOW + timedelta(seconds=30))
        self.assertEqual(calls, ["BlueskyMetadata"])
        youtube = next(item for item in store.slot["publish_outcomes"] if item["provider"] == "youtube")
        self.assertEqual(youtube["status"], "published")

    def test_in_progress_result_waits_for_the_first_attempt_then_replays_its_success(self) -> None:
        slot = self._slot(["instagram"])
        slot["schedules"]["instagram_account_ids"] = ["ig-1"]
        store = _MemoryStore(slot)
        calls: list[dict] = []
        state = {"answered": 0}

        def publish(**kwargs):
            calls.append(kwargs)
            state["answered"] += 1
            if state["answered"] <= 2:
                return {
                    "success": False,
                    "results": [{
                        "accountId": "ig-1",
                        "success": False,
                        "error": "publish still in progress",
                        "errorCode": "publish_in_progress",
                    }],
                }
            return {
                "success": True,
                "results": [{"accountId": "ig-1", "success": True, "postId": "ig-post-1"}],
            }

        scheduler = self._scheduler(store, publish)
        scheduler.publish_due(NOW)
        outcome = store.slot["publish_outcomes"][0]
        self.assertEqual((outcome["status"], outcome["code"]), ("retrying", "publish_in_progress"))
        self.assertEqual(outcome["attempts"], 0)
        self.assertEqual(store.slot["status"], "publishing")
        self.assertEqual(store.slot["publish_not_before"], "2026-09-07T12:01:00+00:00")

        scheduler.publish_due(NOW + timedelta(seconds=60))
        outcome = store.slot["publish_outcomes"][0]
        self.assertEqual((outcome["status"], outcome["code"]), ("retrying", "publish_in_progress"))
        self.assertEqual(outcome["attempts"], 0)
        self.assertEqual(store.slot["status"], "publishing")

        scheduler.publish_due(NOW + timedelta(seconds=120))
        outcome = store.slot["publish_outcomes"][0]
        self.assertEqual(outcome["status"], "published")
        self.assertEqual(outcome["postId"], "ig-post-1")
        self.assertEqual(store.slot["status"], "published")

        expected_key = f"slot:slot-1:video:{UPLOAD_ID}.mp4"
        self.assertEqual(len(calls), 3)
        self.assertTrue(all(item.get("publish_scope_key") == expected_key for item in calls))

    def test_in_progress_wait_capped_as_unknown(self) -> None:
        slot = self._slot(["instagram"])
        slot["schedules"]["instagram_account_ids"] = ["ig-1"]
        store = _MemoryStore(slot)
        calls: list[dict] = []
        notify = MagicMock()

        def publish(**kwargs):
            calls.append(kwargs)
            return {
                "success": False,
                "results": [{
                    "accountId": "ig-1",
                    "success": False,
                    "error": "publish still in progress",
                    "errorCode": "publish_in_progress",
                }],
            }

        scheduler = self._scheduler(store, publish, notify=notify)
        with patch(
            "app.services.fill_schedule.account_outcomes.MAX_IN_PROGRESS_WAIT_SECONDS", 120
        ):
            scheduler.publish_due(NOW)
            outcome = store.slot["publish_outcomes"][0]
            self.assertEqual((outcome["status"], outcome["code"]), ("retrying", "publish_in_progress"))
            self.assertEqual(outcome["inProgressWaitSeconds"], 60)
            self.assertEqual(store.slot["status"], "publishing")

            scheduler.publish_due(NOW + timedelta(seconds=60))
            outcome = store.slot["publish_outcomes"][0]
            self.assertEqual(outcome["status"], "failed")
            self.assertEqual(outcome["code"], "publish_unknown")
            self.assertTrue(outcome["requiresUser"])
            self.assertIn("may already have published", outcome["notice"])
            self.assertIn("will not retry on its own", outcome["notice"])
            self.assertEqual(store.slot["status"], "failed")
            self.assertEqual(notify.call_count, 2)
            self.assertIn("may already have published", notify.call_args_list[0].args[0])
            self.assertIn("❌ Slot failed", notify.call_args_list[1].args[0])

            self.assertEqual(len(calls), 2)

    def test_transient_account_failure_inside_a_200_is_retried_then_exhausted(self) -> None:
        slot = self._slot(["instagram"])
        slot["schedules"]["instagram_account_ids"] = ["ig-1"]
        store = _MemoryStore(slot)
        calls: list[str] = []

        def publish(**kwargs):
            calls.append(type(kwargs["metadata"]).__name__)
            return {
                "success": False,
                "results": [{
                    "accountId": "ig-1",
                    "success": False,
                    "error": "Instagram API 503",
                    "errorCode": "transient",
                }],
            }

        scheduler = self._scheduler(store, publish)
        scheduler.publish_due(NOW)
        outcome = store.slot["publish_outcomes"][0]
        self.assertEqual(outcome["status"], "retrying")
        self.assertEqual(store.slot["status"], "publishing")
        scheduler.publish_due(NOW + timedelta(seconds=30))
        scheduler.publish_due(NOW + timedelta(seconds=150))
        self.assertEqual(len(calls), 3)
        outcome = store.slot["publish_outcomes"][0]
        self.assertEqual(outcome["code"], "retries_exhausted")
        self.assertFalse(outcome["requiresUser"])
        self.assertEqual(store.slot["status"], "failed")

    def test_one_unlabeled_rejection_applies_to_every_pending_account(self) -> None:
        slot = self._slot(["bluesky"])
        slot["schedules"]["bluesky_account_ids"] = ["bsky-1", "bsky-2"]
        store = _MemoryStore(slot)
        calls: list[str] = []

        def publish(**kwargs):
            calls.append("bluesky")
            return {
                "success": False,
                "results": [{
                    "accountId": "",
                    "success": False,
                    "error": "Caption is required",
                    "errorCode": "publish_rejected",
                }],
            }

        scheduler = self._scheduler(store, publish)
        scheduler.publish_due(NOW)
        outcomes = store.slot["publish_outcomes"]
        self.assertEqual(sorted(item["accountId"] for item in outcomes), ["bsky-1", "bsky-2"])
        for item in outcomes:
            self.assertEqual(item["code"], "publish_rejected")
            self.assertEqual(item["error"], "Caption is required")
            self.assertEqual(item["status"], "failed")
        self.assertEqual(store.slot["status"], "failed")
        scheduler.publish_due(NOW + timedelta(minutes=5))
        self.assertEqual(calls, ["bluesky"])


    def test_resumes_do_not_fire_publish_started_again(self) -> None:
        store = _MemoryStore(self._slot(["youtube"]))

        def publish(**kwargs):
            raise PublishError("upload API returned HTTP 503", status_code=503)

        scheduler = self._scheduler(store, publish)
        with patch.object(publish_module, "track_event") as track:
            scheduler.publish_due(NOW)
            scheduler.publish_due(NOW + timedelta(seconds=30))
            scheduler.publish_due(NOW + timedelta(seconds=150))
        started = [c for c in track.call_args_list if c.args[0] == "video_publish_started"]
        self.assertEqual(len(started), 1)
        self.assertEqual(store.slot["status"], "failed")

    def test_unknown_publish_parks_the_account_without_retry(self) -> None:
        slot = self._slot(["instagram"])
        slot["schedules"]["instagram_account_ids"] = ["ig-1"]
        store = _MemoryStore(slot)
        notify = MagicMock()

        def publish(**kwargs):
            return {
                "success": False,
                "results": [{
                    "accountId": "ig-1",
                    "success": False,
                    "error": "Publish result could not be recorded",
                    "errorCode": "publish_unknown",
                }],
            }

        scheduler = self._scheduler(store, publish, notify=notify)
        scheduler.publish_due(NOW)
        outcome = store.slot["publish_outcomes"][0]
        self.assertEqual((outcome["status"], outcome["code"]), ("failed", "publish_unknown"))
        self.assertTrue(outcome["requiresUser"])
        self.assertIn("may already have published", outcome["notice"])
        self.assertIsNone(outcome["retryAt"])
        self.assertEqual(store.slot["status"], "failed")

        messages = [str(call.args[0]) for call in notify.call_args_list]
        self.assertTrue(any("may already have published" in message for message in messages))

        scheduler.publish_due(NOW + timedelta(seconds=30))
        self.assertEqual(store.slot["status"], "failed")


    def test_delay_and_classification_trust_the_code_not_the_text(self) -> None:
        self.assertEqual(next_delay_seconds(1), 30)
        self.assertEqual(next_delay_seconds(2), 120)
        self.assertIsNone(next_delay_seconds(3))
        self.assertEqual(classify_failure("email_not_verified", 200), ("email_not_verified", True))
        self.assertEqual(classify_failure("token_missing", 200), ("token_missing", True))
        self.assertEqual(classify_failure("publish_rejected", 200), ("publish_rejected", False))
        self.assertEqual(classify_failure("transient", 200), ("transient", False))
        self.assertEqual(classify_failure("publish_in_progress", 200), ("publish_in_progress", False))
        self.assertEqual(classify_failure("publish_unknown", 200), ("publish_unknown", True))
        self.assertEqual(classify_failure(None, 400), ("publish_rejected", False))
        self.assertEqual(classify_failure(None, 503), ("transient", False))
        self.assertEqual(classify_failure(None, 429), ("transient", False))
        self.assertEqual(classify_failure(None, None), ("transient", False))
        self.assertEqual(classify_failure(None, 200), ("transient", False))
        self.assertEqual(classify_failure(None, 401), ("disconnected", True))
        self.assertEqual(classify_failure(None, 403), ("disconnected", True))
        self.assertEqual(classify_failure("  ", 422), ("publish_rejected", False))
