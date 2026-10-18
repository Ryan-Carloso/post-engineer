"""PostHog publish_provider_failed event in the fill-schedule publish path.

The fill-schedule publisher (apps/engine/app/services/fill_schedule/publish.py)
has its own publish loop with slot-level retries, separate from
app.services.task_publish. A provider failure here must emit the same
publish_provider_failed diagnostic event (provider, status_code,
response_body) so failures are visible in PostHog no matter which path
published the slot.
"""

from __future__ import annotations

import os
import tempfile
from datetime import UTC, datetime
from unittest import TestCase
from unittest.mock import MagicMock, patch

from app.services.fill_schedule import publish as publish_module


class _FakeStore:
    def __init__(self) -> None:
        self.updates: list[tuple[str, dict]] = []
        self.claimed: list[str] = []

    def ready_due_slots(self, now):  # type: ignore[no-untyped-def]
        return []

    def claim_ready_slot(self, slot_id: str) -> bool:
        self.claimed.append(slot_id)
        return True

    def update_slot(self, slot_id: str, **kwargs) -> None:  # type: ignore[no-untyped-def]
        self.updates.append((slot_id, kwargs))


class FillSchedulePublishPostHogTests(TestCase):
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

    def _slot(self, **overrides):  # type: ignore[no-untyped-def]
        slot = {
            "id": "slot-1",
            "topic": "Porto coffee",
            "task_id": "t-1",
            "faceless": True,
            "publish_attempts": 0,
            "schedules": {
                "id": "sched-1",
                "user_id": "user-1",
                "providers": ["youtube"],
                "post_voice_id": "energetic",
                "post_face_quality": "ok",
            },
        }
        slot.update(overrides)
        return slot

    def _scheduler(self, store, publish_mock):  # type: ignore[no-untyped-def]
        from app.services.fill_schedule import scheduler as scheduler_module

        state = MagicMock()
        state.get_task.return_value = {
            "state": 1,
            "videos": [self.video_path],
            "video_storage_path": "user-1/faceless/t-1/final-1.mp4",
        }
        sched = scheduler_module.FillScheduleScheduler(
            store=store,
            task_state=state,
            publish_video=publish_mock,
        )
        sched.publisher.base_url = "https://post-engineer.com"
        sched.publisher.api_secret = "secret"
        return sched

    def test_publish_error_emits_provider_failed_event(self) -> None:
        from app.services.upload_publisher import PublishError

        store = _FakeStore()
        store.ready_due_slots = lambda now: [self._slot()]  # type: ignore[method-assign]
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
        self.assertEqual(props["task_id"], "t-1")
        self.assertEqual(props["user_id"], "user-1")

    def test_response_body_truncated_to_500_chars(self) -> None:
        from app.services.upload_publisher import PublishError

        store = _FakeStore()
        store.ready_due_slots = lambda now: [self._slot()]  # type: ignore[method-assign]
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

    def test_publish_video_oserror_emits_event(self) -> None:
        # OSError from publish_video (inside the provider loop) has no
        # status_code/response_body; the event still fires with safe
        # defaults and the bound provider.
        store = _FakeStore()
        store.ready_due_slots = lambda now: [self._slot()]  # type: ignore[method-assign]
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

    def test_r2_read_failure_emits_event_with_unknown_provider(self) -> None:
        # read_final_video_r2 raising BEFORE the provider loop is the case
        # the provider=None initialization guards: the event must fire with
        # provider="unknown" and the handler must not raise UnboundLocalError.
        from app.services import video_storage

        store = _FakeStore()
        store.ready_due_slots = lambda now: [self._slot()]  # type: ignore[method-assign]
        scheduler = self._scheduler(store, MagicMock())
        with (
            patch.object(
                video_storage, "read_final_video_r2", side_effect=OSError("r2 down")
            ),
            patch.object(publish_module, "track_event") as track_mock,
        ):
            scheduler.publish_due(datetime(2026, 10, 18, 12, 0, tzinfo=UTC))
        failed_calls = [
            c for c in track_mock.call_args_list if c[0][0] == "publish_provider_failed"
        ]
        self.assertEqual(len(failed_calls), 1)
        props = failed_calls[0][0][1]
        self.assertEqual(props["provider"], "unknown")
        self.assertIsNone(props["status_code"])
        self.assertEqual(props["response_body"], "")

    def test_success_emits_no_provider_failed_event(self) -> None:
        store = _FakeStore()
        store.ready_due_slots = lambda now: [self._slot()]  # type: ignore[method-assign]
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
