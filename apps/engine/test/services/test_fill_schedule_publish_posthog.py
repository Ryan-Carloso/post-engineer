"""PostHog publish_provider_failed event in the fill-schedule publish path.

The fill-schedule publisher (apps/engine/app/services/fill_schedule/publish.py)
is the single publish path. A provider failure here emits the
publish_provider_failed diagnostic event (provider, status_code,
response_body) so failures are visible in PostHog.
"""

from __future__ import annotations

from datetime import UTC, datetime
from unittest import TestCase
from unittest.mock import MagicMock, patch

from app.services.fill_schedule import publish as publish_module


UPLOAD_ID = "22222222-2222-4222-8222-222222222222"

class _FakeStore:
    def __init__(self) -> None:
        self.updates: list[tuple[str, dict]] = []
        self.claimed: list[str] = []
        self.upload = {
            "id": UPLOAD_ID,
            "user_id": "user-1",
            "storage_path": f"user-1/direct-uploads/{UPLOAD_ID}.mp4",
            "declared_content_type": "video/mp4",
            "status": "ready",
            "consumed_at": None,
        }

    def ready_due_slots(self, now):
        return []

    def claim_ready_slot(self, slot_id: str, now_utc=None) -> bool:
        self.claimed.append(slot_id)
        return True

    def update_slot(self, slot_id: str, **kwargs) -> None:
        self.updates.append((slot_id, kwargs))

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


class FillSchedulePublishPostHogTests(TestCase):
    def _slot(self, **overrides):
        slot = {
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
                "providers": ["youtube"],
            },
        }
        slot.update(overrides)
        return slot

    def _scheduler(self, store, publish_mock):
        from app.services.fill_schedule import scheduler as scheduler_module

        sched = scheduler_module.FillScheduleScheduler(
            store=store,
            publish_video=publish_mock,
        )
        sched.publisher.base_url = "https://post-engineer.com"
        sched.publisher.api_secret = "secret"
        return sched

    def test_publish_error_emits_provider_failed_event(self) -> None:
        from app.services.upload_publisher import PublishError

        store = _FakeStore()
        store.ready_due_slots = lambda now: [self._slot()]
        publish_mock = MagicMock(
            side_effect=PublishError(
                "upload API returned HTTP 400",
                status_code=400,
                response_body='{"error": "bad request"}',
            )
        )
        scheduler = self._scheduler(store, publish_mock)
        with patch.object(
            publish_module, "track_event"
        ) as track_mock:
            scheduler.publish_due(datetime(2026, 10, 18, 12, 0, tzinfo=UTC))
        failed_calls = [
            c for c in track_mock.call_args_list if c[0][0] == "publish_provider_failed"
        ]
        self.assertEqual(len(failed_calls), 1)
        props = failed_calls[0][0][1]
        self.assertEqual(props["provider"], "youtube")
        self.assertEqual(props["status_code"], 400)
        self.assertEqual(props["response_body"], '{"error": "bad request"}')
        self.assertEqual(props["slotId"], "slot-1")
        self.assertNotIn("task_id", props)
        self.assertEqual(props["slotId"], "slot-1")
        self.assertEqual(props["user_id"], "user-1")
        self.assertTrue(props["reason"])
        self.assertNotIn("<redacted>", props["reason"])

    def test_response_body_truncated_to_500_chars(self) -> None:
        from app.services.upload_publisher import PublishError

        store = _FakeStore()
        store.ready_due_slots = lambda now: [self._slot()]
        publish_mock = MagicMock(
            side_effect=PublishError(
                "upload API returned HTTP 500",
                status_code=500,
                response_body="E" * 600,
            )
        )
        scheduler = self._scheduler(store, publish_mock)
        with patch.object(
            publish_module, "track_event"
        ) as track_mock:
            scheduler.publish_due(datetime(2026, 10, 18, 12, 0, tzinfo=UTC))
        failed_calls = [
            c for c in track_mock.call_args_list if c[0][0] == "publish_provider_failed"
        ]
        self.assertEqual(len(failed_calls), 1)
        self.assertEqual(len(failed_calls[0][0][1]["response_body"]), 500)

    def test_response_body_secrets_are_scrubbed(self) -> None:
        from app.services.upload_publisher import PublishError

        store = _FakeStore()
        store.ready_due_slots = lambda now: [self._slot()]
        publish_mock = MagicMock(
            side_effect=PublishError(
                "upload API returned HTTP 400",
                status_code=400,
                response_body='{"error": "bad api_key=<redacted>"}',
            )
        )
        scheduler = self._scheduler(store, publish_mock)
        with patch.object(publish_module, "track_event") as track_mock:
            scheduler.publish_due(datetime(2026, 10, 18, 12, 0, tzinfo=UTC))
        props = [
            c for c in track_mock.call_args_list if c[0][0] == "publish_provider_failed"
        ][0][0][1]
        self.assertNotIn("<redacted>", props["response_body"])

    def test_publish_video_oserror_emits_event(self) -> None:
        store = _FakeStore()
        store.ready_due_slots = lambda now: [self._slot()]
        publish_mock = MagicMock(side_effect=OSError("disk gone"))
        scheduler = self._scheduler(store, publish_mock)
        with patch.object(
            publish_module, "track_event"
        ) as track_mock:
            scheduler.publish_due(datetime(2026, 10, 18, 12, 0, tzinfo=UTC))
        failed_calls = [
            c for c in track_mock.call_args_list if c[0][0] == "publish_provider_failed"
        ]
        self.assertEqual(len(failed_calls), 1)
        props = failed_calls[0][0][1]
        self.assertEqual(props["provider"], "youtube")
        self.assertIsNone(props["status_code"])
        self.assertEqual(props["response_body"], "")
        self.assertTrue(props["reason"])


    def test_success_emits_no_provider_failed_event(self) -> None:
        store = _FakeStore()
        store.ready_due_slots = lambda now: [self._slot()]
        publish_mock = MagicMock(return_value={"postId": "yt-123"})
        scheduler = self._scheduler(store, publish_mock)
        with patch.object(
            publish_module, "track_event"
        ) as track_mock:
            scheduler.publish_due(datetime(2026, 10, 18, 12, 0, tzinfo=UTC))
        failed_calls = [
            c for c in track_mock.call_args_list if c[0][0] == "publish_provider_failed"
        ]
        self.assertEqual(len(failed_calls), 0)
