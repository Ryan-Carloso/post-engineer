"""PostHog telemetry for per-provider publish failures.

When a provider rejects an upload, the failure must reach PostHog (not just
the VPS logs) so the cause is diagnosable without SSH: provider name, HTTP
status, and the upstream error body.
"""

import os
import unittest
from unittest.mock import patch

from app.models import const
from app.models.schema import TaskVideoRequest
from app.services import state as sm
from app.services import task_publish
from app.services import upload_publisher


class PublishFailurePosthogTest(unittest.TestCase):
    def setUp(self) -> None:
        os.environ["MPT_UPLOAD_API_BASE_URL"] = "https://post-engineer.com"
        os.environ["MONEYPRINT_API_SECRET"] = "test-shared-secret"
        self._state = sm.MemoryState()
        storage_patcher = patch.object(
            task_publish.video_storage, "read_final_video_r2", return_value=b"mp4-bytes"
        )
        storage_patcher.start()
        self.addCleanup(storage_patcher.stop)
        patcher = patch.object(sm, "state", self._state)
        patcher.start()
        self.addCleanup(patcher.stop)
        self._state.update_task(
            "task_1",
            state=const.TASK_STATE_PROCESSING,
            user_id="user-1",
            video_storage_path="user-1/faceless/task_1/final-1.mp4",
        )

    def tearDown(self) -> None:
        os.environ.pop("MPT_UPLOAD_API_BASE_URL", None)
        os.environ.pop("MONEYPRINT_API_SECRET", None)

    def _request(self) -> TaskVideoRequest:
        return TaskVideoRequest.model_validate(
            {
                "video_subject": "s",
                "platform_ids": ["p1"],
                "publish": {
                    "providers": ["youtube", "bluesky"],
                    "youtube": {
                        "title": "t",
                        "description": "d",
                        "tags": ["a"],
                        "privacy_status": "public",
                        "account_ids": ["acc_1"],
                    },
                    "bluesky": {
                        "caption": "hello",
                        "account_ids": ["did:plc:test"],
                    },
                },
            }
        )

    def test_provider_failure_emits_posthog_event(self) -> None:
        def fake_publish_video(**kwargs):  # type: ignore[no-untyped-def]
            metadata = kwargs["metadata"]
            if isinstance(metadata, upload_publisher.YouTubeMetadata):
                raise upload_publisher.PublishError(
                    "upload API returned HTTP 400",
                    status_code=400,
                    response_body='{"error": {"message": "invalid video"}}',
                )
            return {"postId": "at://did/app.bsky.feed.post/abc"}

        with (
            patch.object(
                task_publish.upload_publisher, "publish_video", side_effect=fake_publish_video
            ),
            patch.object(task_publish, "track_event") as track_mock,
        ):
            task_publish.publish_videos(
                task_id="task_1",
                publish=self._request().publish,  # type: ignore[arg-type]
                video_paths=["/tmp/final.mp4"],
            )

        # One event for the failed provider; the healthy one emits nothing.
        provider_failed_calls = [c for c in track_mock.call_args_list if c[0][0] == 'publish_provider_failed']
        self.assertEqual(len(provider_failed_calls), 1)
        event_name, props = provider_failed_calls[0][0]
        self.assertEqual(event_name, "publish_provider_failed")
        self.assertEqual(props["provider"], "youtube")
        self.assertEqual(props["status_code"], 400)
        self.assertEqual(props["task_id"], "task_1")
        self.assertEqual(props["user_id"], "user-1")
        self.assertIn("invalid video", props["response_body"])

    def test_posthog_event_truncates_long_response_body(self) -> None:
        long_body = "x" * 2000
        with (
            patch.object(
                task_publish.upload_publisher,
                "publish_video",
                side_effect=upload_publisher.PublishError(
                    "upload API returned HTTP 500",
                    status_code=500,
                    response_body=long_body,
                ),
            ),
            patch.object(task_publish, "track_event") as track_mock,
        ):
            # Bluesky succeeds so the task completes; youtube fails twice
            # (two providers, both fail → still raises, but events fire).
            def mixed(**kwargs):  # type: ignore[no-untyped-def]
                metadata = kwargs["metadata"]
                if isinstance(metadata, upload_publisher.YouTubeMetadata):
                    raise upload_publisher.PublishError(
                        "upload API returned HTTP 500",
                        status_code=500,
                        response_body=long_body,
                    )
                return {"postId": "ok"}

            with patch.object(
                task_publish.upload_publisher, "publish_video", side_effect=mixed
            ):
                task_publish.publish_videos(
                    task_id="task_1",
                    publish=self._request().publish,  # type: ignore[arg-type]
                    video_paths=["/tmp/final.mp4"],
                )

        provider_failed_calls = [c for c in track_mock.call_args_list if c[0][0] == 'publish_provider_failed']
        self.assertEqual(len(provider_failed_calls), 1)
        props = provider_failed_calls[0][0][1]
        self.assertLessEqual(len(props["response_body"]), 500)

    def test_no_posthog_event_when_all_providers_succeed(self) -> None:
        with (
            patch.object(
                task_publish.upload_publisher,
                "publish_video",
                return_value={"videoUrl": "https://youtu.be/abc"},
            ),
            patch.object(task_publish, "track_event") as track_mock,
        ):
            task_publish.publish_videos(
                task_id="task_1",
                publish=self._request().publish,  # type: ignore[arg-type]
                video_paths=["/tmp/final.mp4"],
            )

        track_mock.assert_not_called()
