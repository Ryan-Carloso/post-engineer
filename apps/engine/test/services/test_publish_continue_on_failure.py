"""Per-provider publish resilience: one provider failing must not cancel the rest.

publish_videos used to fail fast — the first PublishError raised
PublishFailedError immediately, so the remaining providers were never
attempted. Now a provider failure is recorded in the results and the loop
continues; PublishFailedError is raised only when every provider failed.
"""

import os
import unittest
from unittest.mock import patch

from app.models import const
from app.models.schema import TaskVideoRequest
from app.services import state as sm
from app.services import task_publish
from app.services import upload_publisher


class PublishContinueOnFailureTest(unittest.TestCase):
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

    def test_one_provider_fails_other_still_publishes(self) -> None:
        # YouTube rejects the upload; Bluesky must still be attempted and
        # the task must NOT raise — partial success is a success.
        def fake_publish_video(**kwargs):  # type: ignore[no-untyped-def]
            metadata = kwargs["metadata"]
            if isinstance(metadata, upload_publisher.YouTubeMetadata):
                raise upload_publisher.PublishError(
                    "upload API returned HTTP 400",
                    status_code=400,
                    response_body='{"error": "bad request"}',
                )
            return {"postId": "at://did/app.bsky.feed.post/abc"}

        with patch.object(
            task_publish.upload_publisher, "publish_video", side_effect=fake_publish_video
        ):
            results = task_publish.publish_videos(
                task_id="task_1",
                publish=self._request().publish,  # type: ignore[arg-type]
                video_paths=["/tmp/final.mp4"],
            )

        self.assertEqual(len(results), 2)
        by_provider = {r["provider"]: r for r in results}
        # The failed provider is recorded, not raised.
        self.assertEqual(by_provider["youtube"]["status"], "failed")
        self.assertIn("400", str(by_provider["youtube"]["error"]))
        # The healthy provider published normally.
        self.assertEqual(by_provider["bluesky"]["status"], "published")
        self.assertEqual(by_provider["bluesky"]["postId"], "at://did/app.bsky.feed.post/abc")
        # The task is NOT failed: partial publish is a completed publish.
        task = self._state.get_task("task_1")
        assert task is not None
        self.assertNotEqual(task["state"], const.TASK_STATE_FAILED)
        self.assertEqual(task["publish_results"], results)

    def test_failed_entry_keeps_upstream_body_out_of_error(self) -> None:
        # The recorded error must stay safe for user-facing surfaces: no
        # upstream response body, no local path.
        def fake_publish_video(**kwargs):  # type: ignore[no-untyped-def]
            raise upload_publisher.PublishError(
                "upload API returned HTTP 400",
                status_code=400,
                response_body="SECRET-UPSTREAM-BODY",
            )

        with patch.object(
            task_publish.upload_publisher, "publish_video", side_effect=fake_publish_video
        ):
            # Bluesky succeeds so the task completes; youtube fails.
            def mixed_publish(**kwargs):  # type: ignore[no-untyped-def]
                metadata = kwargs["metadata"]
                if isinstance(metadata, upload_publisher.YouTubeMetadata):
                    return fake_publish_video(**kwargs)
                return {"postId": "ok"}

            with patch.object(
                task_publish.upload_publisher, "publish_video", side_effect=mixed_publish
            ):
                results = task_publish.publish_videos(
                    task_id="task_1",
                    publish=self._request().publish,  # type: ignore[arg-type]
                    video_paths=["/videos/final.mp4"],
                )

        failed = next(r for r in results if r["provider"] == "youtube")
        self.assertNotIn("SECRET-UPSTREAM-BODY", str(failed["error"]))
        self.assertNotIn("/videos/final.mp4", str(failed["error"]))
        self.assertIn("final.mp4", str(failed["error"]))

    def test_all_providers_fail_raises_and_marks_task_failed(self) -> None:
        with patch.object(
            task_publish.upload_publisher,
            "publish_video",
            side_effect=upload_publisher.PublishError(
                "upload API returned HTTP 500", status_code=500
            ),
        ):
            with self.assertRaises(task_publish.PublishFailedError):
                task_publish.publish_videos(
                    task_id="task_1",
                    publish=self._request().publish,  # type: ignore[arg-type]
                    video_paths=["/tmp/final.mp4"],
                )
        task = self._state.get_task("task_1")
        assert task is not None
        self.assertEqual(task["state"], const.TASK_STATE_FAILED)
        self.assertIn("500", str(task["error"]))
