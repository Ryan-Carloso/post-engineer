"""Lifecycle tests for publishing finished task videos through the internal API.

Red-first: defines ``app.services.task_publish.publish_task_videos`` before it
exists. The engine's own publish_video client is mocked at its boundary; state
effects are asserted through the real MemoryState backend.
"""

import os
import tempfile
import unittest
from unittest.mock import patch

from app.models import const
from app.models.publish import PublishParams, YouTubePublish
from app.models.schema import TaskVideoRequest
from app.services import state as sm
from app.services import task_publish


class PublishTaskVideosTest(unittest.TestCase):
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
            "task_1", state=const.TASK_STATE_PROCESSING, user_id="user-1",
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
                    "providers": ["youtube"],
                    "youtube": {
                        "title": "t",
                        "description": "d",
                        "tags": ["a"],
                        "privacy_status": "public",
                        "account_ids": ["acc_1"],
                    },
                },
            }
        )

    def test_missing_base_url_fails_explicitly(self) -> None:
        del os.environ["MPT_UPLOAD_API_BASE_URL"]
        with self.assertRaises(RuntimeError):
            task_publish.publish_task_videos(
                task_id="task_1",
                params=self._request(),
                video_paths=["/tmp/final.mp4"],
            )

    def test_missing_service_key_fails_explicitly(self) -> None:
        del os.environ["MONEYPRINT_API_SECRET"]
        with self.assertRaises(RuntimeError):
            task_publish.publish_task_videos(
                task_id="task_1",
                params=self._request(),
                video_paths=["/tmp/final.mp4"],
            )

    def test_missing_task_owner_fails_explicitly(self) -> None:
        self._state.update_task("task_1", user_id=None)
        with self.assertRaises(RuntimeError):
            task_publish.publish_task_videos(
                task_id="task_1",
                params=self._request(),
                video_paths=["/tmp/final.mp4"],
            )

    def test_missing_r2_archive_fails_without_reading_local_video(self) -> None:
        self._state.update_task("task_1", video_storage_path=None)
        with patch.object(task_publish.video_storage, "read_final_video_r2") as read_mock:
            with self.assertRaisesRegex(RuntimeError, "no verified R2 video archive"):
                task_publish.publish_task_videos(
                    task_id="task_1",
                    params=self._request(),
                    video_paths=["/does/not/exist/final.mp4"],
                )
        read_mock.assert_not_called()

    def test_publishes_and_records_results(self) -> None:
        with tempfile.NamedTemporaryFile(suffix=".mp4") as video_file:
            video_file.write(b"mp4-bytes")
            video_file.flush()
            with patch.object(
                task_publish.upload_publisher,
                "publish_video",
                return_value={"success": True},
            ) as publish_mock:
                results = task_publish.publish_task_videos(
                    task_id="task_1",
                    params=self._request(),
                    video_paths=[video_file.name],
                )
        self.assertEqual(results[0]["success"], True)
        publish_mock.assert_called_once()
        kwargs = publish_mock.call_args.kwargs
        self.assertEqual(kwargs["base_url"], "https://post-engineer.com")
        self.assertEqual(kwargs["api_secret"], "test-shared-secret")
        self.assertEqual(kwargs["owner_user_id"], "user-1")
        self.assertEqual(kwargs["video_path"], os.path.basename(video_file.name))
        task = self._state.get_task("task_1")
        assert task is not None
        self.assertEqual(task["publish_results"], results)

    def test_publish_failure_updates_task_state(self) -> None:
        with tempfile.NamedTemporaryFile(suffix=".mp4") as video_file:
            video_file.write(b"mp4-bytes")
            video_file.flush()
            with patch.object(
                task_publish.upload_publisher,
                "publish_video",
                side_effect=task_publish.upload_publisher.PublishError(
                    "upload API returned HTTP 401: no", status_code=401
                ),
            ):
                with self.assertRaises(task_publish.PublishFailedError):
                    task_publish.publish_task_videos(
                        task_id="task_1",
                        params=self._request(),
                        video_paths=[video_file.name],
                    )
        task = self._state.get_task("task_1")
        assert task is not None
        self.assertEqual(task["state"], const.TASK_STATE_FAILED)
        self.assertIn("401", str(task["error"]))

    def test_publish_failure_error_uses_basename_not_full_path(self) -> None:
        # The error string reaches the Discord alert via start()'s generic
        # handler — the server's local path layout must not go with it.
        with tempfile.NamedTemporaryFile(suffix=".mp4") as video_file:
            video_file.write(b"mp4-bytes")
            video_file.flush()
            with patch.object(
                task_publish.upload_publisher,
                "publish_video",
                side_effect=task_publish.upload_publisher.PublishError(
                    "upload API returned HTTP 401: no", status_code=401
                ),
            ):
                with self.assertRaises(task_publish.PublishFailedError) as ctx:
                    task_publish.publish_task_videos(
                        task_id="task_1",
                        params=self._request(),
                        video_paths=[video_file.name],
                    )
        raised = str(ctx.exception)
        self.assertIn(os.path.basename(video_file.name), raised)
        self.assertNotIn(os.path.dirname(video_file.name), raised)

    def test_idempotent_skip_when_already_published(self) -> None:
        self._state.update_task("task_1", publish_results=[{"success": True}])
        with patch.object(task_publish.upload_publisher, "publish_video") as publish_mock:
            results = task_publish.publish_task_videos(
                task_id="task_1",
                params=self._request(),
                video_paths=["/tmp/final.mp4"],
            )
        publish_mock.assert_not_called()
        self.assertEqual(results, [{"success": True}])


class MaybePublishHookTest(unittest.TestCase):
    def _request(self) -> TaskVideoRequest:
        return TaskVideoRequest.model_validate(
            {
                "video_subject": "s",
                "platform_ids": ["p1"],
                "publish": {
                    "providers": ["youtube"],
                    "youtube": {
                        "title": "t",
                        "description": "d",
                        "tags": ["a"],
                        "privacy_status": "public",
                        "account_ids": ["acc_1"],
                    },
                },
            }
        )

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
            "task_1", state=const.TASK_STATE_PROCESSING, user_id="user-1",
            video_storage_path="user-1/faceless/task_1/final-1.mp4",
        )

    def tearDown(self) -> None:
        os.environ.pop("MPT_UPLOAD_API_BASE_URL", None)
        os.environ.pop("MONEYPRINT_API_SECRET", None)
    def test_publishes_without_remote_publish_flag(self) -> None:
        with tempfile.NamedTemporaryFile(suffix=".mp4") as video_file, patch.object(
            task_publish.upload_publisher,
            "publish_video",
            return_value={"success": True},
        ) as publish_mock:
            results = task_publish.maybe_publish_finished_videos(
                task_id="task_1",
                params=self._request(),
                video_paths=[video_file.name],
            )
        publish_mock.assert_called_once()
        self.assertEqual(len(results), 1)
        self.assertTrue(results[0]["success"])

    def test_noop_without_publish_metadata(self) -> None:
        request = TaskVideoRequest.model_validate(
            {"video_subject": "s", "platform_ids": ["p1"]}
        )
        with patch.object(
            task_publish.upload_publisher, "publish_video"
        ) as publish_mock:
            results = task_publish.maybe_publish_finished_videos(
                task_id="task_1",
                params=request,
                video_paths=["/tmp/final.mp4"],
            )
        publish_mock.assert_not_called()
        self.assertEqual(results, [])

    def test_publishes_when_enabled(self) -> None:
        with tempfile.NamedTemporaryFile(suffix=".mp4") as video_file:
            video_file.write(b"mp4-bytes")
            video_file.flush()
            with patch.object(
                task_publish.upload_publisher,
                "publish_video",
                return_value={"success": True},
            ) as publish_mock:
                results = task_publish.maybe_publish_finished_videos(
                    task_id="task_1",
                    params=self._request(),
                    video_paths=[video_file.name],
                )
        publish_mock.assert_called_once()
        self.assertEqual(results[0]["success"], True)


class PublishParamsConversionTest(unittest.TestCase):
    def test_converts_youtube_publish_to_client_metadata(self) -> None:
        params = PublishParams(
            providers=["youtube"],
            youtube=YouTubePublish(
                title="t",
                description="d",
                tags=["a"],
                privacy_status="public",
                account_ids=["acc_1"],
            ),
        )
        metadata = task_publish.to_client_metadata(params)
        assert metadata is not None
        self.assertEqual(metadata.providers, ("youtube",))
        assert metadata.youtube is not None
        self.assertEqual(metadata.youtube.account_ids, ("acc_1",))

    def test_returns_none_without_publish(self) -> None:
        self.assertIsNone(task_publish.to_client_metadata(None))


if __name__ == "__main__":
    unittest.main()
