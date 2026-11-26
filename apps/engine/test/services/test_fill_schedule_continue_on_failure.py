"""Continue-on-provider-failure in the fill-schedule publish path.

One provider failing must not cancel the others: the failure is recorded,
the loop continues, and the slot is marked published when at least one
provider succeeded. Only when every provider failed does the slot go
through the retry/fail path. Partial success emits video_publish_partial_failure.
"""

from __future__ import annotations

import unittest
from datetime import datetime, timezone
from unittest.mock import patch

from app.services import publisher as fs
from app.services.publisher import publish as pub_module
from app.services.upload_publisher import PublishError

UTC = timezone.utc
UPLOAD_ID = "22222222-2222-4222-8222-222222222222"


class _FakeStore:
    def __init__(self):
        self.updates = []
        self.upload = {
            "id": UPLOAD_ID,
            "user_id": "user-1",
            "storage_path": f"user-1/direct-uploads/{UPLOAD_ID}.mp4",
            "declared_content_type": "video/mp4",
            "status": "ready",
            "consumed_at": None,
        }

    def claim_ready_slot(self, slot_id, now_utc=None):
        return True

    def update_slot(self, slot_id, **fields):
        self.updates.append((slot_id, fields))

    def get_video_upload(self, upload_id):
        return dict(self.upload) if upload_id == self.upload["id"] else None

    def claim_video_upload(self, upload_id):
        if upload_id != self.upload["id"] or self.upload["status"] != "ready":
            return None
        self.upload.update(status="consumed", consumed_at="2026-09-07T12:00:00+00:00")
        return dict(self.upload)

    def download_storage_object(self, bucket, path):
        return b"fake-video-bytes"

    def remove_storage_object(self, bucket, path):
        return True



class ContinueOnProviderFailureTests(unittest.TestCase):
    def _slot(self, providers=("youtube", "bluesky")):
        return {
            "id": "slot-1",
            "title": "Porto food",
            "description": "Porto food description.",
            "user_id": "user-1",
            "media_kind": "upload",
            "media_ref": UPLOAD_ID,
            "schedules": {
                "id": "sched-1",
                "user_id": "user-1",
                "providers": list(providers),
                "personas": {"name": "Porto Guide"},
            },
        }

    def _scheduler(self, store, publish):
        scheduler = fs.PublishScheduler(
            store=store,
            publish_video=publish,
        )
        scheduler.publisher.base_url = "https://post-engineer.com"
        scheduler.publisher.api_secret = "secret"
        return scheduler

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
            scheduler = self._scheduler(store, fake_publish)
            published = scheduler.publish_due(
                datetime(2026, 9, 7, 12, 0, tzinfo=UTC)
            )

        self.assertEqual(published, 1)
        self.assertEqual(store.updates[-1][1]["status"], "published")
        failed_calls = [
            c for c in track.call_args_list
            if c[0][0] == "publish_provider_failed"
        ]
        self.assertEqual(len(failed_calls), 1)
        self.assertEqual(failed_calls[0][0][1]["provider"], "youtube")
        self.assertEqual(failed_calls[0][0][1]["status_code"], 401)
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
        """Every provider down: slot stays publishing for the next try."""
        store = _FakeStore()
        store.ready_due_slots = lambda now: [self._slot()]

        def fake_publish(**kwargs):
            raise PublishError("upload API returned HTTP 500", status_code=500)

        with patch.object(pub_module, "track_event"):
            scheduler = self._scheduler(store, fake_publish)
            published = scheduler.publish_due(
                datetime(2026, 9, 7, 12, 0, tzinfo=UTC)
            )

        self.assertEqual(published, 0)
        self.assertEqual(store.updates[-1][1]["status"], "publishing")
        self.assertEqual(store.updates[-1][1]["publish_attempts"], 1)
        self.assertEqual(store.updates[-1][1]["publish_not_before"], "2026-09-07T12:00:30+00:00")

    def test_partial_failure_does_not_retry(self):
        """Partial success is terminal: no retry, no refund."""
        store = _FakeStore()
        store.ready_due_slots = lambda now: [self._slot()]

        def fake_publish(**kwargs):
            if kwargs["metadata"].__class__.__name__ == "YouTubeMetadata":
                raise PublishError("boom", status_code=400)
            return {"postId": "ok"}

        scheduler = self._scheduler(store, fake_publish)
        scheduler.publish_due(datetime(2026, 9, 7, 12, 0, tzinfo=UTC))

        statuses = [u[1]["status"] for u in store.updates if "status" in u[1]]
        self.assertIn("published", statuses)
        self.assertNotIn("ready", statuses)


if __name__ == "__main__":
    unittest.main()
