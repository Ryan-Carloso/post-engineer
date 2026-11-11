"""Direct publish_slot_accounts coverage for the per-account budget.

The scheduler-level tests in test_publish_accounts.py drive the same code
through the store, but the attempt budget and the state-write flag are only
observable on the returned AccountPublishResult, so these tests call the
loop directly.
"""

from __future__ import annotations

import os
import tempfile
import unittest
from datetime import datetime, timezone
from unittest.mock import patch

from app.services.upload_publisher import PublishError

UTC = timezone.utc
NOW = datetime(2026, 9, 7, 12, 0, tzinfo=UTC)


class PublishSlotAccountsDirectTests(unittest.TestCase):
    """Direct publish_slot_accounts coverage for the per-account budget.

    The scheduler-level tests above drive the same code through the store,
    but the attempt budget and the state-write flag are only observable
    on the returned AccountPublishResult, so these tests call the loop
    directly.
    """

    def setUp(self) -> None:
        handle, self.video_path = tempfile.mkstemp(suffix=".mp4")
        with os.fdopen(handle, "wb") as video_file:
            video_file.write(b"fake-video-bytes")
        self.addCleanup(os.unlink, self.video_path)

    def _run(self, slot, schedule, publish, record_results=None, metadata_error=False):
        from app.services.fill_schedule import publish_accounts as accounts_module
        from app.services.fill_schedule.publish_accounts import publish_slot_accounts

        def persist(saved, fields):
            slot["publish_outcomes"] = [dict(item) for item in saved]
            slot.update(fields)

        kwargs = {
            "base_url": "https://post-engineer.com",
            "api_secret": "s3cr3t",
            "publish_video": publish,
            "persist_outcomes": persist,
            "record_results": record_results,
        }
        if metadata_error:
            with patch.object(accounts_module, "_metadata", side_effect=RuntimeError("metadata boom")):
                return publish_slot_accounts(
                    slot, schedule, [self.video_path], lambda: b"fake-video-bytes",
                    NOW, "Porto coffee", "Porto coffee description.", **kwargs,
                )
        return publish_slot_accounts(
            slot, schedule, [self.video_path], lambda: b"fake-video-bytes",
            NOW, "Porto coffee", "Porto coffee description.", **kwargs,
        )

    def _slot(self, providers, publish_attempts=0, outcomes=None):
        schedule = {
            "id": "sched-1",
            "user_id": "user-1",
            "providers": providers,
            "bluesky_account_ids": ["bsky-1"],
            "threads_account_ids": ["th-1"],
            "personas": {"name": "Ana"},
        }
        slot = {
            "id": "slot-1",
            "title": "Porto coffee",
            "description": "Porto coffee description.",
            "task_id": "t-1",
            "publish_attempts": publish_attempts,
            "schedules": schedule,
        }
        if outcomes is not None:
            slot["publish_outcomes"] = outcomes
        return slot, schedule

    def _ok(self, **kwargs):
        return {
            "results": [
                {"accountId": "bsky-1", "success": True, "url": "https://bsky.invalid/x"},
                {"accountId": "th-1", "success": True, "url": "https://threads.invalid/x"},
            ],
        }

    def test_new_account_starts_at_attempt_one_not_the_slot_counter(self) -> None:
        # The slot counter holds other accounts' failures (3 = at the cap):
        # YouTube already spent its 3 tries. A brand-new Bluesky account
        # must get its own 3 tries, not inherit YouTube's.
        video = os.path.basename(self.video_path)
        youtube_spent = {
            "provider": "youtube", "accountId": "yt-1", "video": video,
            "status": "failed", "code": "retries_exhausted", "attempts": 3,
        }
        slot, schedule = self._slot(
            ["youtube", "bluesky"], publish_attempts=3, outcomes=[youtube_spent]
        )
        schedule["youtube_account_ids"] = ["yt-1"]

        def publish(**kwargs):
            raise PublishError("upload API returned HTTP 503", status_code=503)

        result = self._run(slot, schedule, publish)
        outcome = [o for o in slot["publish_outcomes"] if o["provider"] == "bluesky"][0]
        self.assertEqual(outcome["attempts"], 1)
        self.assertEqual(outcome["status"], "retrying")
        self.assertTrue(result.any_retrying)

    def test_legacy_slot_without_outcomes_keeps_the_slot_counter(self) -> None:
        # A slot that never recorded per-account outcomes is still on the
        # legacy slot-level counter: its accounts keep counting from it.
        slot, schedule = self._slot(["bluesky"], publish_attempts=2)

        def publish(**kwargs):
            raise PublishError("upload API returned HTTP 503", status_code=503)

        self._run(slot, schedule, publish)
        outcome = slot["publish_outcomes"][0]
        self.assertEqual(outcome["attempts"], 3)
        self.assertEqual(outcome["status"], "failed")
        self.assertEqual(outcome["code"], "retries_exhausted")

    def test_legacy_outcome_without_attempts_keeps_the_slot_counter(self) -> None:
        # An outcome recorded before per-account attempts existed has no
        # attempts field: the slot counter is the only budget it has.
        video = os.path.basename(self.video_path)
        legacy = {
            "provider": "bluesky", "accountId": "bsky-1", "video": video,
            "status": "retrying", "code": "transient",
        }
        slot, schedule = self._slot(["bluesky"], publish_attempts=3, outcomes=[legacy])

        def publish(**kwargs):
            raise PublishError("upload API returned HTTP 503", status_code=503)

        self._run(slot, schedule, publish)
        outcome = slot["publish_outcomes"][0]
        self.assertEqual(outcome["attempts"], 4)

    def test_state_write_failed_clears_when_a_later_write_succeeds(self) -> None:
        slot, schedule = self._slot(["bluesky", "threads"])
        calls: list[bool] = []

        def record_results(entries):
            calls.append(True)
            return len(calls) > 1  # First write fails, second succeeds.

        result = self._run(slot, schedule, self._ok, record_results=record_results)
        self.assertEqual(len(calls), 2)
        self.assertFalse(result.state_write_failed)
        self.assertTrue(result.any_published)

    def test_state_write_failed_stays_when_every_write_fails(self) -> None:
        slot, schedule = self._slot(["bluesky", "threads"])
        result = self._run(slot, schedule, self._ok, record_results=lambda entries: False)
        self.assertTrue(result.state_write_failed)

    def test_partial_publish_names_the_retrying_accounts_in_the_reason(self) -> None:
        slot, schedule = self._slot(["bluesky", "threads"])
        calls: list[str] = []

        def publish(**kwargs):
            provider = "threads" if len(calls) else "bluesky"
            calls.append(provider)
            if provider == "threads":
                raise PublishError("upload API returned HTTP 503", status_code=503)
            return {"results": [{"accountId": "bsky-1", "success": True, "url": "https://bsky.invalid/x"}]}

        result = self._run(slot, schedule, publish)
        self.assertTrue(result.any_published)
        self.assertTrue(result.any_retrying)
        self.assertNotEqual(result.failure_reason, "")
        self.assertIn("retrying", result.failure_reason)

    def test_metadata_error_is_not_a_provider_exception(self) -> None:
        slot, schedule = self._slot(["bluesky"])
        result = self._run(slot, schedule, self._ok, metadata_error=True)
        self.assertEqual(result.provider_exceptions, [])
        self.assertEqual(result.first_error, "metadata boom")
        self.assertEqual(slot["publish_outcomes"][0]["status"], "failed")
