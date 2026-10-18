"""Per-provider publish resilience: one provider failing must not cancel the rest.

publish_videos used to fail fast — the first PublishError raised
PublishFailedError immediately, so the remaining providers were never
attempted. Now a provider failure is recorded in the results and the loop
continues; PublishFailedError is raised only when every attempted provider
failed. An empty result list is persisted and returned. HTTP 200 with
success:false (or every per-account result unsuccessful) is a failed
provider, not a published one. A partial failure emits
video_publish_partial_failure and a Discord alert naming the failed
providers.
"""

import json
import os
import unittest
from unittest.mock import MagicMock, patch

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
        # Telemetry must not leave this process. Stub both sinks for every
        # test so a partial-failure alert cannot hit PostHog or Discord.
        track_patcher = patch.object(task_publish, "track_event")
        self.track = track_patcher.start()
        self.addCleanup(track_patcher.stop)
        discord_patcher = patch.object(task_publish, "send_discord")
        self.discord = discord_patcher.start()
        self.addCleanup(discord_patcher.stop)
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
        called_providers: list[str] = []

        def fake_publish_video(**kwargs):  # type: ignore[no-untyped-def]
            metadata = kwargs["metadata"]
            if isinstance(metadata, upload_publisher.YouTubeMetadata):
                called_providers.append("youtube")
                raise upload_publisher.PublishError(
                    "upload API returned HTTP 400",
                    status_code=400,
                    response_body='{"error": "bad request"}',
                )
            called_providers.append("bluesky")
            return {"postId": "at://did/app.bsky.feed.post/abc"}

        with patch.object(
            task_publish.upload_publisher, "publish_video", side_effect=fake_publish_video
        ):
            results = task_publish.publish_videos(
                task_id="task_1",
                publish=self._request().publish,  # type: ignore[arg-type]
                video_paths=["/tmp/final.mp4"],
            )

        # The second provider is invoked after the first one raises.
        self.assertEqual(called_providers, ["youtube", "bluesky"])
        self.assertEqual(len(results), 2)
        by_provider = {r["provider"]: r for r in results}
        # The failed provider is recorded, not raised. Video is the basename.
        self.assertEqual(by_provider["youtube"]["status"], "failed")
        self.assertEqual(by_provider["youtube"]["video"], "final.mp4")
        self.assertIn("400", str(by_provider["youtube"]["error"]))
        self.assertIn("youtube:", str(by_provider["youtube"]["error"]))
        # The healthy provider published normally.
        self.assertEqual(by_provider["bluesky"]["status"], "published")
        self.assertEqual(by_provider["bluesky"]["postId"], "at://did/app.bsky.feed.post/abc")
        # The task is NOT failed: partial publish is a completed publish.
        task = self._state.get_task("task_1")
        assert task is not None
        self.assertNotEqual(task["state"], const.TASK_STATE_FAILED)
        self.assertEqual(task["publish_results"], results)
        partial_calls = [c for c in self.track.call_args_list if c[0][0] == "video_publish_partial_failure"]
        self.assertEqual(len(partial_calls), 1)
        self.assertEqual(
            partial_calls[0][0][1],
            {
                "task_id": "task_1",
                "user_id": "user-1",
                "failed_providers": ["youtube"],
                "published_providers": ["bluesky"],
            },
        )
        self.discord.assert_called_once()
        alert = self.discord.call_args.args[0]
        self.assertIn("youtube", alert)
        self.assertNotIn("bad request", alert)

    def test_failed_entry_keeps_upstream_body_out_of_error(self) -> None:
        # The recorded error must stay safe for user-facing surfaces: no
        # upstream response body, no local path. Bluesky succeeds so the
        # task completes; youtube fails.
        def mixed_publish(**kwargs):  # type: ignore[no-untyped-def]
            metadata = kwargs["metadata"]
            if isinstance(metadata, upload_publisher.YouTubeMetadata):
                raise upload_publisher.PublishError(
                    "upload API returned HTTP 400",
                    status_code=400,
                    response_body="SECRET-UPSTREAM-BODY",
                )
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
        self.assertNotIn("/videos/final.mp4", str(failed["video"]))
        self.assertEqual(failed["video"], "final.mp4")
        self.assertIn("final.mp4", str(failed["error"]))
        alert = self.discord.call_args.args[0]
        self.assertNotIn("SECRET-UPSTREAM-BODY", alert)

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
        # The aggregate names each provider; the basename stays, the path does not.
        self.assertIn("youtube: publish failed for final.mp4:", str(task["error"]))
        self.assertIn("bluesky: publish failed for final.mp4:", str(task["error"]))
        self.assertNotIn("/tmp/final.mp4", str(task["error"]))
        # publish_provider_failed fires per failed provider; the partial
        # event is for partial success only.
        failed_calls = [c for c in self.track.call_args_list if c[0][0] == "publish_provider_failed"]
        self.assertEqual(len(failed_calls), 2)
        partial_calls = [c for c in self.track.call_args_list if c[0][0] == "video_publish_partial_failure"]
        self.assertEqual(len(partial_calls), 0)
        self.discord.assert_not_called()

    def test_empty_results_are_persisted_without_failing(self) -> None:
        # No video means no provider entry. Before continue-on-failure this
        # persisted [] and returned; not any([]) must not mark the task FAILED.
        with patch.object(task_publish.upload_publisher, "publish_video") as publish_mock:
            results = task_publish.publish_videos(
                task_id="task_1",
                publish=self._request().publish,  # type: ignore[arg-type]
                video_paths=[],
            )
        publish_mock.assert_not_called()
        self.assertEqual(results, [])
        task = self._state.get_task("task_1")
        assert task is not None
        self.assertEqual(task["publish_results"], [])
        self.assertNotEqual(task["state"], const.TASK_STATE_FAILED)
        self.assertFalse(task.get("error"))
        self.track.assert_not_called()
        self.discord.assert_not_called()

    def test_http_200_success_false_is_a_failed_provider(self) -> None:
        # The upload route returns HTTP 200 with success:false (error /
        # errorType). That must not be stamped published, and the sibling
        # provider must still be called. The upstream body stays out of the
        # stored error and the Discord alert.
        secret = "SECRET-UPSTREAM-BODY"
        responses = [
            self._json_response(
                {"success": False, "error": secret, "errorType": "Error"}
            ),
            self._json_response(
                {
                    "success": True,
                    "postId": "at://did/app.bsky.feed.post/abc",
                    "results": [{"accountId": "did:plc:test", "success": True}],
                }
            ),
        ]
        with patch("requests.post", side_effect=responses) as post:
            results = task_publish.publish_videos(
                task_id="task_1",
                publish=self._request().publish,  # type: ignore[arg-type]
                video_paths=["/tmp/final.mp4"],
            )

        self.assertEqual(post.call_count, 2)
        by_provider = {r["provider"]: r for r in results}
        self.assertEqual(by_provider["youtube"]["status"], "failed")
        self.assertEqual(by_provider["youtube"]["video"], "final.mp4")
        self.assertNotIn(secret, str(by_provider["youtube"]["error"]))
        self.assertNotIn("errorType", str(by_provider["youtube"]["error"]))
        self.assertIn("youtube: publish failed for final.mp4:", str(by_provider["youtube"]["error"]))
        self.assertEqual(by_provider["bluesky"]["status"], "published")
        self.assertEqual(by_provider["bluesky"]["provider"], "bluesky")
        task = self._state.get_task("task_1")
        assert task is not None
        self.assertNotEqual(task["state"], const.TASK_STATE_FAILED)
        self.assertEqual(task["publish_results"], results)
        partial_calls = [c for c in self.track.call_args_list if c[0][0] == "video_publish_partial_failure"]
        self.assertEqual(len(partial_calls), 1)
        self.assertEqual(
            partial_calls[0][0][1],
            {
                "task_id": "task_1",
                "user_id": "user-1",
                "failed_providers": ["youtube"],
                "published_providers": ["bluesky"],
            },
        )
        alert = self.discord.call_args.args[0]
        self.assertIn("youtube", alert)
        self.assertNotIn(secret, alert)

    def test_http_200_all_accounts_unsuccessful_fails_the_task(self) -> None:
        # YouTube/Instagram keep top-level success true and report each
        # account in results. When every account failed, the provider failed.
        secret = "QUOTA-SECRET-BODY"
        body = {
            "success": True,
            "provider": "from-upstream",
            "status": "published",
            "results": [{"accountId": "acc", "success": False, "error": secret}],
        }
        with patch("requests.post", side_effect=[self._json_response(body), self._json_response(body)]):
            with self.assertRaises(task_publish.PublishFailedError) as ctx:
                task_publish.publish_videos(
                    task_id="task_1",
                    publish=self._request().publish,  # type: ignore[arg-type]
                    video_paths=["/tmp/final.mp4"],
                )
        self.assertNotIn(secret, str(ctx.exception))
        task = self._state.get_task("task_1")
        assert task is not None
        self.assertEqual(task["state"], const.TASK_STATE_FAILED)
        self.assertIn("youtube: publish failed for final.mp4:", str(task["error"]))
        self.assertIn("bluesky: publish failed for final.mp4:", str(task["error"]))
        self.assertNotIn(secret, str(task["error"]))
        self.assertIsNone(task.get("publish_results"))
        # publish_provider_failed fires per failed provider even on total failure.
        failed_calls = [c for c in self.track.call_args_list if c[0][0] == "publish_provider_failed"]
        self.assertEqual(len(failed_calls), 2)

    def test_engine_provider_and_status_win_over_upstream_fields(self) -> None:
        def fake_publish_video(**kwargs):  # type: ignore[no-untyped-def]
            metadata = kwargs["metadata"]
            if isinstance(metadata, upload_publisher.YouTubeMetadata):
                return {
                    "provider": "evil",
                    "status": "failed",
                    "video": "/secret/path.mp4",
                    "success": True,
                    "videoUrl": "https://www.youtube.com/watch?v=abc",
                }
            return {"success": True, "postId": "ok"}

        with patch.object(
            task_publish.upload_publisher, "publish_video", side_effect=fake_publish_video
        ):
            results = task_publish.publish_videos(
                task_id="task_1",
                publish=self._request().publish,  # type: ignore[arg-type]
                video_paths=["/tmp/final.mp4"],
            )

        youtube = next(r for r in results if r["provider"] == "youtube")
        self.assertEqual(youtube["status"], "published")
        self.assertEqual(youtube["provider"], "youtube")
        self.assertEqual(youtube["video"], "/tmp/final.mp4")
        self.track.assert_not_called()

    @staticmethod
    def _json_response(payload: dict[str, object]) -> MagicMock:
        response = MagicMock()
        response.status_code = 200
        response.json.return_value = payload
        response.text = json.dumps(payload)
        return response
