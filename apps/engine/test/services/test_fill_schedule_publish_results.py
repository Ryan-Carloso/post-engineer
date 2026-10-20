"""The fill-schedule publisher must record publish_results on the task.

Regression (flight 2026-10-20): the slot reached 'published' — YouTube had
really posted — yet no link was visible anywhere. PR #231 deleted
task_publish.py, which used to write ``publish_results`` into the task
state, and the unified publisher discarded ``publish_video()``'s return
value. The web builds a published post's links ONLY from the task state's
``publish_results`` (apps/web/lib/post-detail.ts -> publish-links.ts), so
every slot published since then showed zero links.
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


class FillSchedulePublishResultsTests(TestCase):
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
        self.video_name = os.path.basename(self.video_path)

    def _slot(self, providers):  # type: ignore[no-untyped-def]
        return {
            "id": "slot-1",
            "topic": "Porto coffee",
            "task_id": "t-1",
            "faceless": True,
            "publish_attempts": 0,
            "schedules": {
                "id": "sched-1",
                "user_id": "user-1",
                "providers": providers,
                "post_voice_id": "energetic",
                "post_face_quality": "ok",
            },
        }

    def _run(self, providers, publish_mock):  # type: ignore[no-untyped-def]
        from app.services.fill_schedule import scheduler as scheduler_module

        store = _FakeStore()
        store.ready_due_slots = lambda now: [self._slot(providers)]  # type: ignore[method-assign]
        state = MagicMock()
        state.get_task.return_value = {
            "state": 1,
            "videos": [self.video_path],
            "video_storage_path": "user-1/faceless/t-1/final-1.mp4",
        }
        sched = scheduler_module.FillScheduleScheduler(
            store=store, task_state=state, publish_video=publish_mock
        )
        sched.publisher.base_url = "https://post-engineer.com"
        sched.publisher.api_secret = "secret"
        with patch.object(publish_module, "track_event"):
            sched.publish_due(datetime(2026, 10, 20, 12, 0, tzinfo=UTC))
        return store, state

    def _recorded_results(self, state):  # type: ignore[no-untyped-def]
        for call in state.update_task.call_args_list:
            if "publish_results" in call.kwargs:
                return call.kwargs["publish_results"]
        return None

    def test_success_records_per_account_link_entries(self) -> None:
        publish_mock = MagicMock(
            return_value={
                "success": True,
                "results": [
                    {
                        "accountId": "chan-1",
                        "success": True,
                        "videoId": "yt-123",
                        "videoUrl": "https://www.youtube.com/watch?v=yt-123",
                    }
                ],
            }
        )
        store, state = self._run(["youtube"], publish_mock)
        self.assertEqual(
            self._recorded_results(state),
            [
                {
                    "provider": "youtube",
                    "video": self.video_name,
                    "status": "published",
                    "accountId": "chan-1",
                    "videoUrl": "https://www.youtube.com/watch?v=yt-123",
                }
            ],
        )
        # The slot itself still lands on published.
        self.assertIn(
            ("slot-1", {"status": "published", "published_at": "2026-10-20T12:00:00+00:00"}),
            [(slot_id, {k: v for k, v in kw.items() if k in ("status", "published_at")}) for slot_id, kw in store.updates],
        )

    def test_top_level_link_fields_become_one_entry(self) -> None:
        publish_mock = MagicMock(
            return_value={"postId": "at://did:plc:abc/app.bsky.feed.post/xyz"}
        )
        _store, state = self._run(["bluesky"], publish_mock)
        self.assertEqual(
            self._recorded_results(state),
            [
                {
                    "provider": "bluesky",
                    "video": self.video_name,
                    "status": "published",
                    "postId": "at://did:plc:abc/app.bsky.feed.post/xyz",
                }
            ],
        )

    def test_partial_failure_records_failed_and_published_entries(self) -> None:
        from app.services.upload_publisher import PublishError

        def _publish(**kwargs):  # type: ignore[no-untyped-def]
            metadata = kwargs["metadata"]
            if type(metadata).__name__ == "BlueskyMetadata":
                raise PublishError(
                    "upload API reported failure",
                    status_code=200,
                    response_body='{"success": false}',
                )
            return {
                "success": True,
                "results": [
                    {"accountId": "chan-1", "success": True, "videoUrl": "https://youtu.be/abc"}
                ],
            }

        _store, state = self._run(["bluesky", "youtube"], MagicMock(side_effect=_publish))
        results = self._recorded_results(state)
        self.assertIsNotNone(results)
        by_provider = {entry["provider"]: entry for entry in results}
        self.assertEqual(by_provider["bluesky"]["status"], "failed")
        self.assertIn("error", by_provider["bluesky"])
        self.assertEqual(by_provider["youtube"]["status"], "published")
        self.assertEqual(by_provider["youtube"]["videoUrl"], "https://youtu.be/abc")

    def test_all_providers_failed_still_records_failed_entries(self) -> None:
        from app.services.upload_publisher import PublishError

        publish_mock = MagicMock(
            side_effect=PublishError("upload API returned HTTP 500", status_code=500)
        )
        _store, state = self._run(["youtube"], publish_mock)
        results = self._recorded_results(state)
        self.assertIsNotNone(results)
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["provider"], "youtube")
        self.assertEqual(results[0]["status"], "failed")
