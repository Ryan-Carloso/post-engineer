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
from unittest.mock import MagicMock, patch

from app.services import video_storage
from app.services.fill_schedule import FillScheduleScheduler
from app.services.fill_schedule import publish as publish_module
from app.services.fill_schedule.account_outcomes import classify_failure, next_delay_seconds
from app.services.upload_publisher import PublishError

UTC = timezone.utc
NOW = datetime(2026, 9, 7, 12, 0, tzinfo=UTC)
EMAIL = (
    "Bluesky did not publish because the email on this account is not verified. "
    "This is a problem with your account. Only you can fix it: verify the email on Bluesky."
)


class _MemoryStore:
    def __init__(self, slot: dict):
        self.slot = slot
        self.updates: list[tuple[str, dict]] = []
        self.refund_batch_calls: list[tuple] = []

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
            "description": "Porto coffee description.",
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

    def test_in_progress_result_waits_for_the_first_attempt_then_replays_its_success(self) -> None:
        # The web route is still publishing under the first request, which
        # outlived the engine's 600s timeout. The engine re-asks; the web
        # answers "in progress" instead of publishing again. The retry
        # must not spend the account's 3-try budget, and the recorded
        # success ends the slot with no refund and no second post.
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
        self.assertEqual(store.refund_batch_calls, [])

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
        self.assertEqual(store.refund_batch_calls, [])

        # Every call carries the same deterministic scope key, so the web
        # route can tell the re-asks apart from a new publish.
        expected_key = f"slot:slot-1:video:{os.path.basename(self.video_path)}"
        self.assertEqual(len(calls), 3)
        self.assertTrue(all(item.get("publish_scope_key") == expected_key for item in calls))

    def test_in_progress_wait_capped_as_unknown_without_refund(self) -> None:
        # The wait for an in-flight publish is bounded: the web answers
        # publish_in_progress while the first request still holds the
        # ledger claim, and the heartbeat renews that claim indefinitely
        # while the handler lives — so without a cap the engine would
        # re-ask (re-uploading the full video) every 60s forever. Past
        # the cap the account fails terminally as publish_unknown: the
        # first post may already be live, so the token is not refunded
        # and only a human who checked the provider may post again.
        # The cap is patched small here so two waits reach it.
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
            self.assertIn("token was not refunded", outcome["notice"])
            self.assertEqual(store.slot["status"], "failed")
            self.assertEqual(store.refund_batch_calls, [])
            # Two notices: the per-account unknown warning, then the
            # slot-failed summary — the same pair the web-parked
            # publish_unknown path already sends.
            self.assertEqual(notify.call_count, 2)
            self.assertIn("may already have published", notify.call_args_list[0].args[0])
            self.assertIn("❌ Slot failed", notify.call_args_list[1].args[0])

            # The engine stopped re-asking: no third full-video upload.
            self.assertEqual(len(calls), 2)

    def test_transient_account_failure_inside_a_200_is_retried_then_exhausted(self) -> None:
        # A provider 503 reported per account inside a 200 response carries
        # errorCode transient: it gets the 30s / 2min retries, not one shot.
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
        # A request-level rejection ("Caption is required") comes back as one
        # result with no accountId. Each DID keeps its real code instead of a
        # generic transient failure, so nothing is re-uploaded 3 times.
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

    def test_video_read_failure_on_resume_never_fails_a_slot_with_a_live_account(self) -> None:
        store = _MemoryStore(self._slot(["youtube", "bluesky"]))
        calls: list[str] = []

        def publish(**kwargs):
            name = type(kwargs["metadata"]).__name__
            calls.append(name)
            if name == "YouTubeMetadata":
                return {"success": True, "results": [{"success": True, "videoUrl": "https://youtu.be/abc"}]}
            raise PublishError("upload API returned HTTP 503", status_code=503)

        scheduler = self._scheduler(store, publish)
        scheduler.publish_due(NOW)
        self.assertEqual(store.slot["status"], "publishing")

        calls.clear()
        with patch.object(video_storage, "read_final_video_r2", side_effect=OSError("r2 down")):
            scheduler.publish_due(NOW + timedelta(seconds=30))
            self.assertEqual(store.slot["status"], "publishing")
            scheduler.publish_due(NOW + timedelta(seconds=150))
        self.assertEqual(calls, [])
        self.assertEqual(store.slot["status"], "published")
        self.assertEqual(store.refund_batch_calls, [])
        by_provider = {item["provider"]: item for item in store.slot["publish_outcomes"]}
        self.assertEqual(by_provider["youtube"]["status"], "published")
        self.assertEqual(by_provider["bluesky"]["code"], "retries_exhausted")
        self.assertEqual(by_provider["bluesky"]["attempts"], 3)

    def test_video_read_failure_before_any_account_uses_the_account_budget(self) -> None:
        store = _MemoryStore(self._slot(["youtube"]))
        publish = MagicMock()
        scheduler = self._scheduler(store, publish)
        with patch.object(video_storage, "read_final_video_r2", side_effect=OSError("r2 down")):
            scheduler.publish_due(NOW)
            outcome = store.slot["publish_outcomes"][0]
            self.assertEqual((outcome["status"], outcome["attempts"]), ("retrying", 1))
            scheduler.publish_due(NOW + timedelta(seconds=30))
            scheduler.publish_due(NOW + timedelta(seconds=150))
        publish.assert_not_called()
        self.assertEqual(store.slot["status"], "failed")
        self.assertEqual(store.slot["publish_outcomes"][0]["code"], "retries_exhausted")
        self.assertEqual(len(store.refund_batch_calls), 1)

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

    def test_unknown_publish_parks_the_account_without_refund_or_retry(self) -> None:
        # The web route parked the claim as unknown: the post may already be
        # live, but its ledger record was lost. The account must never be
        # re-posted, and the slot must fail WITHOUT refunding the token:
        # money must not move on an unknown outcome — if the post is live
        # the user already got it, and if it is not, support refunds it
        # after the human check. The user is told to verify first.
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
        self.assertEqual(store.refund_batch_calls, [])

        # The user is told to check the provider before posting again.
        messages = [str(call.args[0]) for call in notify.call_args_list]
        self.assertTrue(any("may already have published" in message for message in messages))

        # A later tick never re-posts the parked account.
        scheduler.publish_due(NOW + timedelta(seconds=30))
        self.assertEqual(store.slot["status"], "failed")
        self.assertEqual(store.refund_batch_calls, [])

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
        # No code: the status decides.
        self.assertEqual(classify_failure(None, 400), ("publish_rejected", False))
        self.assertEqual(classify_failure(None, 503), ("transient", False))
        self.assertEqual(classify_failure(None, 429), ("transient", False))
        self.assertEqual(classify_failure(None, None), ("transient", False))
        self.assertEqual(classify_failure(None, 200), ("transient", False))
        self.assertEqual(classify_failure(None, 401), ("disconnected", True))
        self.assertEqual(classify_failure(None, 403), ("disconnected", True))
        self.assertEqual(classify_failure("  ", 422), ("publish_rejected", False))
