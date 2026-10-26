"""Continue-on-provider-failure in the fill-schedule publish path.

One provider failing must not cancel the others: the failure is recorded,
the loop continues, and the slot is marked published when at least one
provider succeeded. Only when every provider failed does the slot go
through the retry/fail path. Partial success emits video_publish_partial_failure.
"""

from __future__ import annotations

import os
import tempfile
import unittest
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

from app.services import fill_schedule as fs
from app.services.fill_schedule import publish as pub_module
from app.services.upload_publisher import PublishError

UTC = timezone.utc


class _FakeStore:
    def __init__(self):
        self.updates = []

    def recover_stale_publishing(self):
        pass

    def claim_ready_slot(self, slot_id):
        return True

    def update_slot(self, slot_id, **fields):
        self.updates.append((slot_id, fields))

    def refund_batch_tokens(self, *args, **kwargs):
        return True


class ContinueOnProviderFailureTests(unittest.TestCase):
    def setUp(self) -> None:
        from app.services import video_storage

        storage_patcher = patch.object(
            video_storage, "read_final_video_r2", return_value=b"fake-video-bytes"
        )
        storage_patcher.start()
        self.addCleanup(storage_patcher.stop)
        handle, self.video_path = tempfile.mkstemp(suffix=".mp4")
        with os.fdopen(handle, "wb") as video_file:
            video_file.write(b"fake-video-bytes")
        self.addCleanup(os.unlink, self.video_path)

    def _slot(self, providers=("youtube", "bluesky")):
        return {
            "id": "slot-1",
            "topic": "Porto food",
            "task_id": "t-1",
            "schedules": {
                "id": "sched-1",
                "user_id": "user-1",
                "providers": list(providers),
                "personas": {"name": "Porto Guide"},
            },
        }

    def _scheduler(self, store, state, publish):
        scheduler = fs.FillScheduleScheduler(
            store=store, task_state=state,
            publish_video=publish,
        )
        scheduler.publisher.base_url = "https://post-engineer.com"
        scheduler.publisher.api_secret = "secret"
        return scheduler

    def _task_state(self):
        state = MagicMock()
        state.get_task.return_value = {
            "state": 1, "videos": [self.video_path],
            "video_storage_path": "user-1/faceless/t-1/final-1.mp4",
        }
        return state

    def test_one_provider_fails_other_still_publishes(self):
        """YouTube 401 does not cancel the Bluesky post."""
        store = _FakeStore()
        store.ready_due_slots = lambda now: [self._slot()]

        def fake_publish(**kwargs):
            if kwargs["metadata"].__class__.__name__ == "YouTubeMetadata":
                raise PublishError(
                    "upload API returned HTTP 401",
                    status_code=401,
                    response_body='{"error": "unauthorized"}',
                )
            return {"postId": "at://did/post/abc"}

        with patch.object(pub_module, "track_event") as track:
            scheduler = self._scheduler(store, self._task_state(), fake_publish)
            published = scheduler.publish_due(
                datetime(2026, 9, 7, 12, 0, tzinfo=UTC)
            )

        # Slot published (partial success), not failed.
        self.assertEqual(published, 1)
        self.assertEqual(store.updates[0][1]["status"], "published")
        # Per-provider failure event fired for youtube.
        failed_calls = [
            c for c in track.call_args_list
            if c[0][0] == "publish_provider_failed"
        ]
        self.assertEqual(len(failed_calls), 1)
        self.assertEqual(failed_calls[0][0][1]["provider"], "youtube")
        self.assertEqual(failed_calls[0][0][1]["status_code"], 401)
        # Partial failure event fired.
        partial_calls = [
            c for c in track.call_args_list
            if c[0][0] == "video_publish_partial_failure"
        ]
        self.assertEqual(len(partial_calls), 1)
        props = partial_calls[0][0][1]
        self.assertEqual(props["failed_providers"], ["youtube"])
        self.assertEqual(props["published_providers"], ["bluesky"])
        self.assertTrue(props["reason"])

    def test_all_providers_fail_goes_through_retry_path(self):
        """Every provider down: slot back to ready (retryable), not published."""
        store = _FakeStore()
        store.ready_due_slots = lambda now: [self._slot()]

        def fake_publish(**kwargs):
            raise PublishError("upload API returned HTTP 500", status_code=500)

        with patch.object(pub_module, "track_event"):
            scheduler = self._scheduler(store, self._task_state(), fake_publish)
            published = scheduler.publish_due(
                datetime(2026, 9, 7, 12, 0, tzinfo=UTC)
            )

        self.assertEqual(published, 0)
        # Back to ready for retry (attempt 1 of 3).
        self.assertEqual(store.updates[0][1]["status"], "ready")
        self.assertEqual(store.updates[0][1]["publish_attempts"], 1)

    def test_partial_failure_does_not_retry(self):
        """Partial success is terminal: no retry, no refund."""
        store = _FakeStore()
        store.ready_due_slots = lambda now: [self._slot()]

        def fake_publish(**kwargs):
            if kwargs["metadata"].__class__.__name__ == "YouTubeMetadata":
                raise PublishError("boom", status_code=400)
            return {"postId": "ok"}

        scheduler = self._scheduler(store, self._task_state(), fake_publish)
        scheduler.publish_due(datetime(2026, 9, 7, 12, 0, tzinfo=UTC))

        # Published, not back to ready — no retry scheduled.
        statuses = [u[1]["status"] for u in store.updates]
        self.assertIn("published", statuses)
        self.assertNotIn("ready", statuses)


if __name__ == "__main__":
    unittest.main()
