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

    def _run(  # type: ignore[no-untyped-def]
        self,
        providers,
        publish_mock,
        events=None,
        task_extra=None,
        update_task_side_effect=None,
    ):
        from app.services.fill_schedule import scheduler as scheduler_module

        store = _FakeStore()
        store.ready_due_slots = lambda now: [self._slot(providers)]  # type: ignore[method-assign]
        state = MagicMock()
        state.get_task.return_value = {
            "state": 1,
            "videos": [self.video_path],
            "video_storage_path": "user-1/faceless/t-1/final-1.mp4",
            **(task_extra or {}),
        }
        if update_task_side_effect is not None:
            state.update_task.side_effect = update_task_side_effect
        if events is not None:
            record_update_slot = store.update_slot

            def _update_slot(slot_id, **kwargs):  # type: ignore[no-untyped-def]
                events.append(("slot", kwargs.get("status")))
                record_update_slot(slot_id, **kwargs)

            store.update_slot = _update_slot  # type: ignore[method-assign]
            record_update_task = state.update_task

            def _update_task(task_id, **kwargs):  # type: ignore[no-untyped-def]
                events.append(("state", "publish_results" in kwargs))
                return record_update_task(task_id, **kwargs)

            state.update_task = _update_task
        sched = scheduler_module.FillScheduleScheduler(
            store=store, task_state=state, publish_video=publish_mock
        )
        sched.publisher.base_url = "https://post-engineer.com"
        sched.publisher.api_secret = "secret"
        with patch.object(publish_module, "track_event") as track_mock:
            self.track_mock = track_mock
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

    def test_mixed_account_results_record_only_successful_accounts(self) -> None:
        # One account posted, another failed inside the same 2xx body:
        # only the successful account becomes an entry.
        publish_mock = MagicMock(
            return_value={
                "success": True,
                "results": [
                    {
                        "accountId": "chan-1",
                        "success": True,
                        "videoUrl": "https://youtu.be/abc",
                    },
                    {"accountId": "chan-2", "success": False},
                ],
            }
        )
        _store, state = self._run(["youtube"], publish_mock)
        self.assertEqual(
            self._recorded_results(state),
            [
                {
                    "provider": "youtube",
                    "video": self.video_name,
                    "status": "published",
                    "accountId": "chan-1",
                    "videoUrl": "https://youtu.be/abc",
                }
            ],
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

    def test_failed_entry_error_is_scrubbed_before_recording(self) -> None:
        # The recorded error is client-visible: publish_results ride the
        # task state the web reads back, so the persisted text must have
        # gone through scrub_error_text — a secret-shaped fragment in the
        # exception message must never reach the task row raw.
        from app.services.upload_publisher import PublishError

        secret = "abcdefghijklmnopqrstuvwxyz0123456789"

        def _publish(**kwargs):  # type: ignore[no-untyped-def]
            metadata = kwargs["metadata"]
            if type(metadata).__name__ == "BlueskyMetadata":
                raise PublishError(
                    f"upload failed with Bearer {secret}", status_code=401
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
        error = by_provider["bluesky"]["error"]
        self.assertNotIn(secret, error)
        self.assertIn("[redacted]", error)

    def test_failed_entry_error_is_truncated_to_500_chars(self) -> None:
        from app.services.upload_publisher import PublishError

        publish_mock = MagicMock(
            side_effect=PublishError("upload failed: " + "x" * 600, status_code=500)
        )
        _store, state = self._run(["youtube"], publish_mock)
        results = self._recorded_results(state)
        self.assertIsNotNone(results)
        self.assertLessEqual(len(results[0]["error"]), 500)

    def test_publish_results_written_before_slot_flips_published(self) -> None:
        # The web only reads publish_results for slots already showing
        # 'published', so the state write must land BEFORE the slot flip —
        # otherwise the published-without-links race this PR closes is
        # still open.
        publish_mock = MagicMock(
            return_value={
                "success": True,
                "results": [
                    {"accountId": "chan-1", "success": True, "videoUrl": "https://youtu.be/abc"}
                ],
            }
        )
        events: list = []
        self._run(["youtube"], publish_mock, events=events)
        write_index = next(
            i for i, event in enumerate(events) if event == ("state", True)
        )
        flip_index = next(
            i for i, event in enumerate(events) if event == ("slot", "published")
        )
        self.assertLess(write_index, flip_index)

    def test_no_successful_account_records_failed_entry_and_retries(self) -> None:
        # A 2xx body whose results carry no success flag at all (renamed
        # field, partial payload) raises nothing in publish_video and
        # yields no published entry — the attempt must still be recorded
        # as a failed entry and the provider must take the retry path,
        # not silently vanish from both provider lists.
        publish_mock = MagicMock(
            return_value={"success": True, "results": [{"accountId": "chan-1"}]}
        )
        store, state = self._run(["youtube"], publish_mock)
        results = self._recorded_results(state)
        self.assertIsNotNone(results)
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["provider"], "youtube")
        self.assertEqual(results[0]["status"], "failed")
        self.assertIn("error", results[0])
        statuses = [kw.get("status") for _slot_id, kw in store.updates]
        self.assertNotIn("published", statuses)
        self.assertIn("ready", statuses)

    def test_empty_results_list_records_no_published_entry(self) -> None:
        # A 2xx body with an explicitly empty results list attempted no
        # account: nothing was posted, so no entry may claim a publish —
        # and the provider must not count as published either, or the
        # slot flips to published with zero links (the regression this
        # PR exists to close) and no retry ever happens.
        publish_mock = MagicMock(return_value={"success": True, "results": []})
        store, state = self._run(["youtube"], publish_mock)
        self.assertIsNone(self._recorded_results(state))
        statuses = [kw.get("status") for _slot_id, kw in store.updates]
        self.assertNotIn("published", statuses)
        # Every provider yielded nothing: the slot takes the retry path.
        self.assertIn("ready", statuses)

    def test_lost_state_write_fires_partial_failure_event(self) -> None:
        # persist_state_update reports a lost write by returning False;
        # the slot still flips to published (the video really posted), so
        # the lost links must surface as a partial failure, not just a log.
        def _fail_publish_results_write(task_id, **kwargs):  # type: ignore[no-untyped-def]
            if "publish_results" in kwargs:
                raise RuntimeError("supabase unreachable")
            return None

        publish_mock = MagicMock(
            return_value={
                "success": True,
                "results": [
                    {"accountId": "chan-1", "success": True, "videoUrl": "https://youtu.be/abc"}
                ],
            }
        )
        store, _state = self._run(
            ["youtube"],
            publish_mock,
            update_task_side_effect=_fail_publish_results_write,
        )
        partial_calls = [
            call
            for call in self.track_mock.call_args_list
            if call.args and call.args[0] == "video_publish_partial_failure"
        ]
        self.assertEqual(len(partial_calls), 1)
        props = partial_calls[0].args[1]
        self.assertEqual(props["failed_providers"], ["state-write"])
        self.assertEqual(props["published_providers"], ["youtube"])
        # The slot itself still lands on published.
        self.assertIn(
            ("slot-1", {"status": "published", "published_at": "2026-10-20T12:00:00+00:00"}),
            [(slot_id, {k: v for k, v in kw.items() if k in ("status", "published_at")}) for slot_id, kw in store.updates],
        )

    def test_prior_published_entries_survive_for_untouched_providers(self) -> None:
        # A retry rewrites publish_results wholesale; links recorded by an
        # earlier attempt for a provider this attempt does not touch must
        # be preserved — that post is live, its link is the only record.
        prior = [
            {
                "provider": "bluesky",
                "video": "final-0.mp4",
                "status": "published",
                "postId": "at://did:plc:abc/app.bsky.feed.post/xyz",
            }
        ]
        publish_mock = MagicMock(
            return_value={
                "success": True,
                "results": [
                    {"accountId": "chan-1", "success": True, "videoUrl": "https://youtu.be/abc"}
                ],
            }
        )
        _store, state = self._run(
            ["youtube"], publish_mock, task_extra={"publish_results": prior}
        )
        results = self._recorded_results(state)
        self.assertIsNotNone(results)
        by_provider = {entry["provider"]: entry for entry in results}
        self.assertEqual(by_provider["bluesky"], prior[0])
        self.assertEqual(by_provider["youtube"]["status"], "published")
        self.assertEqual(by_provider["youtube"]["videoUrl"], "https://youtu.be/abc")

    def test_prior_published_entry_survives_when_retry_fails_again(self) -> None:
        # Crash window: attempt 1 posted YouTube and recorded the link,
        # then the slot flip itself failed, putting the slot back to
        # ready. On the retry YouTube fails transiently — the recorded
        # link is the only trace of the live post and must survive
        # alongside the new failed entry.
        from app.services.upload_publisher import PublishError

        prior = [
            {
                "provider": "youtube",
                "video": self.video_name,
                "status": "published",
                "videoUrl": "https://youtu.be/abc",
            }
        ]
        publish_mock = MagicMock(
            side_effect=PublishError("upload API returned HTTP 503", status_code=503)
        )
        _store, state = self._run(
            ["youtube"], publish_mock, task_extra={"publish_results": prior}
        )
        results = self._recorded_results(state)
        self.assertIsNotNone(results)
        published = [e for e in results if e["status"] == "published"]
        failed = [e for e in results if e["status"] == "failed"]
        self.assertEqual(published, prior)
        self.assertEqual(len(failed), 1)
        self.assertEqual(failed[0]["provider"], "youtube")
