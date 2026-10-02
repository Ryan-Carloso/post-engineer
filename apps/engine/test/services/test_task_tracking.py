"""PostHog lifecycle tracking for the direct video pipeline.

Covers the funnel the user watches in PostHog to compute the failure %:
video_generation_requested (before the pipeline starts) ->
video_generation_started -> video_generation_progress (every 10%) ->
video_generation_failed / video_generated.
"""

import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from app.models import const
from app.models.schema import VideoParams
from app.services import task as tm
from app.services import state as sm


def _params():
    return VideoParams(video_subject="test subject", video_script="script")


class RequestedTests(unittest.TestCase):
    def test_track_generation_requested_emits_event_with_context(self):
        with patch.object(tm, "track_event") as track:
            tm.track_generation_requested(
                "task-1", user_id="user-1", flow="direct", pipeline="video"
            )
        track.assert_called_once_with(
            "video_generation_requested",
            {
                "task_id": "task-1",
                "user_id": "user-1",
                "flow": "direct",
                "pipeline": "video",
            },
        )

    def test_track_generation_requested_carries_extra_context(self):
        with patch.object(tm, "track_event") as track:
            tm.track_generation_requested(
                "task-1",
                user_id="user-1",
                flow="batch",
                pipeline="video",
                slot_id="slot-9",
            )
        _, props = track.call_args[0]
        self.assertEqual(props["slot_id"], "slot-9")
        self.assertEqual(props["flow"], "batch")


class StartedTests(unittest.TestCase):
    def setUp(self):
        self.task_id = "started-task-1"
        sm.state.update_task(
            self.task_id, user_id="user-1", flow="direct", pipeline="video"
        )

    def tearDown(self):
        sm.state.delete_task(self.task_id)

    def test_track_generation_started_emits_event(self):
        with patch.object(tm, "track_event") as track:
            tm.track_generation_started(self.task_id)
        track.assert_called_once_with(
            "video_generation_started",
            {
                "task_id": self.task_id,
                "user_id": "user-1",
                "flow": "direct",
                "pipeline": "video",
            },
        )


class ProgressMilestoneTests(unittest.TestCase):
    def setUp(self):
        tm._progress_milestones.clear()
        self.task_id = "progress-task-1"
        sm.state.update_task(
            self.task_id, user_id="user-1", flow="direct", pipeline="video"
        )
        self.track = patch.object(tm, "track_event").start()

    def tearDown(self):
        patch.stopall()
        tm._progress_milestones.clear()
        sm.state.delete_task(self.task_id)

    def _milestones(self):
        return [c[0][1]["milestone"] for c in self.track.call_args_list]

    def test_no_milestone_below_ten_percent(self):
        tm._update_task(self.task_id, progress=5)
        self.track.assert_not_called()

    def test_milestone_at_ten_percent(self):
        tm._update_task(self.task_id, progress=10)
        self.assertEqual(self._milestones(), [10])

    def test_each_milestone_reported_once(self):
        tm._update_task(self.task_id, progress=10)
        tm._update_task(self.task_id, progress=10)
        tm._update_task(self.task_id, progress=20)
        self.assertEqual(self._milestones(), [10, 20])

    def test_jump_reports_every_crossed_milestone(self):
        tm._update_task(self.task_id, progress=35)
        self.assertEqual(self._milestones(), [10, 20, 30])

    def test_milestone_props_carry_task_context(self):
        tm._update_task(self.task_id, progress=40)
        _, props = self.track.call_args[0]
        self.assertEqual(props["task_id"], self.task_id)
        self.assertEqual(props["user_id"], "user-1")
        self.assertEqual(props["progress"], 40)

    def test_update_without_progress_reports_nothing(self):
        tm._update_task(self.task_id, music_mood="calm")
        self.track.assert_not_called()

    def test_milestones_are_per_task(self):
        other = "progress-task-2"
        sm.state.update_task(other, user_id="user-1", flow="direct", pipeline="video")
        try:
            tm._update_task(self.task_id, progress=10)
            tm._update_task(other, progress=10)
            self.assertEqual(self._milestones(), [10, 10])
        finally:
            sm.state.delete_task(other)


class CompleteTaskTests(unittest.TestCase):
    def setUp(self):
        tm._progress_milestones.clear()
        self.task_id = "complete-task-1"
        sm.state.update_task(
            self.task_id, user_id="user-1", flow="direct", pipeline="video"
        )

    def tearDown(self):
        tm._progress_milestones.clear()
        sm.state.delete_task(self.task_id)

    def test_complete_task_tracks_video_generated(self):
        with (
            patch.object(tm, "track_event") as track,
            patch.object(tm.task_webhook, "notify_terminal_task"),
        ):
            tm._complete_task(self.task_id, _params())
        track.assert_called_once_with(
            "video_generated",
            {
                "task_id": self.task_id,
                "user_id": "user-1",
                "flow": "direct",
                "pipeline": "video",
            },
        )

    def test_complete_task_clears_milestone_cache(self):
        tm._progress_milestones[self.task_id] = 50
        with (
            patch.object(tm, "track_event"),
            patch.object(tm.task_webhook, "notify_terminal_task"),
        ):
            tm._complete_task(self.task_id, _params())
        self.assertNotIn(self.task_id, tm._progress_milestones)

    def test_complete_task_skips_generated_for_batch_flow(self):
        """Batch completions are reported by the fill_schedule reconciler
        (which also attaches cost_usd); reporting here too would double
        count every batch video."""
        sm.state.update_task(self.task_id, flow="batch")
        with (
            patch.object(tm, "track_event") as track,
            patch.object(tm.task_webhook, "notify_terminal_task"),
        ):
            tm._complete_task(self.task_id, _params())
        track.assert_not_called()

    def test_complete_task_skips_generated_for_unknown_flow(self):
        """A degraded context (flow unknown, e.g. the row was deleted
        mid-flight) must not emit video_generated here: it may be a batch
        task, and the reconciler already reports those."""
        sm.state.delete_task(self.task_id)
        with (
            patch.object(tm, "track_event") as track,
            patch.object(tm.task_webhook, "notify_terminal_task"),
        ):
            tm._complete_task(self.task_id, _params())
        track.assert_not_called()


class FailTaskTests(unittest.TestCase):
    def setUp(self):
        tm._progress_milestones.clear()
        tm._failed_event_emitted_tasks.clear()
        self.task_id = "fail-task-1"
        sm.state.update_task(
            self.task_id, user_id="user-1", flow="direct", pipeline="video"
        )

    def tearDown(self):
        tm._progress_milestones.clear()
        tm._failed_event_emitted_tasks.clear()
        sm.state.delete_task(self.task_id)

    def _fail(self):
        with (
            patch.object(tm, "track_event") as track,
            patch.object(tm.task_webhook, "notify_terminal_task"),
            patch.object(tm, "send_discord", return_value=True),
        ):
            tm._fail_task(self.task_id, "boom", _params(), stage="audio")
        return track

    def test_fail_task_tracks_video_generation_failed_once(self):
        track = self._fail()
        track.assert_called_once()
        name, props = track.call_args[0]
        self.assertEqual(name, "video_generation_failed")
        self.assertEqual(props["task_id"], self.task_id)
        self.assertEqual(props["user_id"], "user-1")
        self.assertEqual(props["flow"], "direct")
        self.assertEqual(props["stage"], "audio")
        self.assertIn("boom", props["reason"])

    def test_failed_reason_scrubs_full_message_before_truncation(self):
        # Regression: truncate-then-scrub lets a secret fragmented by the
        # 200-char cut slip past the key-anchored pattern. The scrubber must
        # see the full message; truncation happens after.
        from app.services import analytics as analytics_module

        error = "E" * 150 + " api_key=TOPSECRET123" + "F" * 150
        with (
            patch.object(tm, "track_event") as track,
            patch.object(tm.task_webhook, "notify_terminal_task"),
            patch.object(tm, "send_discord", return_value=True),
            patch.object(
                tm, "scrub_secret_values", wraps=analytics_module.scrub_secret_values
            ) as scrub,
        ):
            tm._fail_task(self.task_id, error, _params(), stage="audio")
        # The scrubber received the whole message, not the truncated slice.
        scrub.assert_called_once_with(str(error))
        _, props = track.call_args[0]
        self.assertIn("[redacted]", props["reason"])
        self.assertNotIn("TOPSECRET123", props["reason"])
        self.assertLessEqual(len(str(props["reason"])), 200)

    def test_second_failure_notice_does_not_retrack(self):
        self._fail()
        track = self._fail()
        track.assert_not_called()

    def test_fail_task_clears_milestone_cache(self):
        tm._progress_milestones[self.task_id] = 30
        self._fail()
        self.assertNotIn(self.task_id, tm._progress_milestones)

    def test_failed_task_state_is_failed(self):
        self._fail()
        task = sm.state.get_task(self.task_id)
        self.assertEqual(task["state"], const.TASK_STATE_FAILED)


class PublishFailureTests(unittest.TestCase):
    """A publish-stage failure emits exactly one terminal funnel event.

    The publish stage pre-writes FAILED before raising PublishFailedError;
    the pipeline's generic handler then calls _fail_task, which must still
    emit video_generation_failed on this FIRST notice (dedup is by notice,
    not by state) and pop the milestone cache.
    """

    def setUp(self):
        tm._progress_milestones.clear()
        tm._failed_event_emitted_tasks.clear()
        self.task_id = "publish-fail-1"
        sm.state.update_task(
            self.task_id, user_id="user-1", flow="direct", pipeline="video"
        )
        tm._progress_milestones[self.task_id] = 70

    def tearDown(self):
        tm._progress_milestones.clear()
        tm._failed_event_emitted_tasks.clear()
        sm.state.delete_task(self.task_id)

    def test_publish_failure_emits_failed_event_once(self):
        from app.services import notify as notify_module
        from app.services import task_publish as publish_module

        # Mirror task_publish: FAILED is pre-written, then the error raises
        # into the pipeline's generic handler.
        sm.state.update_task(
            self.task_id,
            state=const.TASK_STATE_FAILED,
            error="publish failed for clip.mp4: HTTP 500",
        )
        exc = publish_module.PublishFailedError("publish failed for clip.mp4: HTTP 500")
        with (
            patch.object(tm, "track_event") as track,
            patch.object(tm.task_webhook, "notify_terminal_task"),
            patch.object(tm, "send_discord", return_value=True),
        ):
            # The generic handler's call: safe_reason(exc), stage="publish".
            tm._fail_task(
                self.task_id,
                notify_module.safe_reason(exc),
                _params(),
                stage="publish",
            )
        track.assert_called_once()
        name, props = track.call_args[0]
        self.assertEqual(name, "video_generation_failed")
        self.assertEqual(props["task_id"], self.task_id)
        self.assertEqual(props["stage"], "publish")
        self.assertIn("publish failed", props["reason"])
        # The pre-written publish error survives (first failure wins).
        task = sm.state.get_task(self.task_id)
        self.assertIn("publish failed", task["error"])
        # Terminal either way: the milestone entry is popped.
        self.assertNotIn(self.task_id, tm._progress_milestones)

    def test_second_notice_after_publish_failure_stays_deduped(self):
        from app.services import notify as notify_module
        from app.services import task_publish as publish_module

        sm.state.update_task(
            self.task_id,
            state=const.TASK_STATE_FAILED,
            error="publish failed for clip.mp4: HTTP 500",
        )
        exc = publish_module.PublishFailedError("publish failed for clip.mp4: HTTP 500")
        with (
            patch.object(tm, "track_event") as track,
            patch.object(tm.task_webhook, "notify_terminal_task"),
            patch.object(tm, "send_discord", return_value=True),
        ):
            tm._fail_task(
                self.task_id, notify_module.safe_reason(exc), _params(), stage="publish"
            )
            tm._fail_task(
                self.task_id, "generic follow-up notice", _params(), stage="publish"
            )
        track.assert_called_once()


class CreateTaskControllerTests(unittest.TestCase):
    """POST /videos (and siblings) report requested via add_task's on_accepted."""

    def test_create_task_tracks_requested_and_stores_flow(self):
        from types import SimpleNamespace

        from app.controllers.v1 import video as video_controller
        from app.models.schema import TaskVideoRequest

        body = TaskVideoRequest(video_subject="subject", video_script="script")
        auth = SimpleNamespace(user_id="user-1")
        with (
            patch.object(
                video_controller.base, "get_task_id", return_value="req-1"
            ),
            patch.object(
                video_controller.base, "get_auth_context", return_value=auth
            ),
            patch.object(video_controller.task_manager, "add_task") as add_task,
            patch.object(tm, "track_generation_requested") as requested,
        ):
            def fake_add_task(func, *args, **kwargs):
                # Mirror TaskManager: the on_accepted callback fires on
                # acceptance, strictly before the worker could start.
                on_accepted = kwargs.get("on_accepted")
                assert on_accepted is not None
                on_accepted()

            add_task.side_effect = fake_add_task
            resp = video_controller.create_task(MagicMock(), body, stop_at="video")
            task_id = resp["data"]["task_id"]
            # Requested fires from the on_accepted callback: after the task
            # is accepted, strictly before the worker thread starts, and
            # never on a 429 queue-full rejection.
            requested.assert_called_once_with(
                task_id, user_id="user-1", flow="direct", pipeline="video"
            )
            add_task.assert_called_once()
            _, kwargs = add_task.call_args
            self.assertIn("on_accepted", kwargs)
        try:
            task = sm.state.get_task(task_id)
            self.assertEqual(task["flow"], "direct")
            self.assertEqual(task["pipeline"], "video")
        finally:
            sm.state.delete_task(task_id)

    def test_queue_full_rejection_does_not_track_requested(self):
        from types import SimpleNamespace

        from app.controllers.manager.base_manager import TaskQueueFullError
        from app.controllers.v1 import video as video_controller
        from app.models.exception import HttpException
        from app.models.schema import TaskVideoRequest

        body = TaskVideoRequest(video_subject="subject", video_script="script")
        auth = SimpleNamespace(user_id="user-1")
        with (
            patch.object(
                video_controller.base, "get_task_id", return_value="req-2"
            ),
            patch.object(
                video_controller.base, "get_auth_context", return_value=auth
            ),
            patch.object(
                video_controller.utils, "get_uuid", return_value="task-429-1"
            ),
            patch.object(
                video_controller.task_manager,
                "add_task",
                side_effect=TaskQueueFullError("task queue is full"),
            ),
            patch.object(tm, "track_generation_requested") as requested,
        ):
            with self.assertRaises(HttpException) as ctx:
                video_controller.create_task(MagicMock(), body, stop_at="video")
        # Admission refused: 429, the task row is rolled back, and the
        # refused request never enters the requested -> failed funnel.
        self.assertEqual(ctx.exception.status_code, 429)
        requested.assert_not_called()
        self.assertIsNone(sm.state.get_task("task-429-1"))


class BatchRequestedTests(unittest.TestCase):
    """Batch dispatch reports requested before the pipeline starts."""

    def _slot(self):
        return {
            "id": "slot-batch-req-1",
            "slot_at": "2026-09-08T09:00:00+00:00",
            "topic": "Batch topic one",
            "schedules": {
                "id": "sched-batch-1",
                "user_id": "user-1",
                "providers": ["youtube"],
                "youtube_account_ids": ["yt-1"],
                "personas": {
                    "id": "persona-1",
                    "name": "Ana",
                    "niche": "travel",
                    "script_prompt": "",
                    "language": "en",
                    "video_aspect": "9:16",
                    "photo_path": "user-1/foto.png",
                    "avatar_url": None,
                    "voice_id": "calm",
                    "voice_audio_path": None,
                    "paragraph_number": 1,
                    "face_mix_percent": 50,
                    "face_quality": "ok",
                },
            },
        }

    def test_generate_slot_tracks_requested_before_dispatch(self):
        from app.services.fill_schedule import generate as gen_module

        store = MagicMock()
        store.signed_url = MagicMock(return_value="https://signed/foto.png")
        generator = gen_module.BatchGenerator(
            store=store, task_state=MagicMock(), notify=MagicMock()
        )
        with (
            patch("threading.Thread") as thread_cls,
            patch.object(gen_module.tm, "track_generation_requested") as requested,
        ):
            order = MagicMock()
            order.attach_mock(requested, "requested")
            order.attach_mock(thread_cls, "thread_cls")
            label = generator._generate_slot(self._slot())
            self.assertIsNotNone(label)
            task_id = thread_cls.call_args.kwargs["kwargs"]["task_id"]
            requested.assert_called_once_with(
                task_id,
                user_id="user-1",
                flow="batch",
                pipeline="video",
                slot_id="slot-batch-req-1",
                persona_id="persona-1",
            )
            # The funnel entry fires before the worker thread is spawned.
            call_order = [c[0] for c in order.mock_calls]
            self.assertLess(
                call_order.index("requested"), call_order.index("thread_cls")
            )
            # The batch task state carries the funnel context.
            _, kwargs = generator.task_state.update_task.call_args
            self.assertEqual(kwargs["flow"], "batch")
            self.assertEqual(kwargs["pipeline"], "video")


class BatchFailedTests(unittest.TestCase):
    """Batch dispatch failures carry the full funnel context."""

    def _slot(self):
        return {
            "id": "slot-batch-fail-1",
            "slot_at": "2026-09-08T09:00:00+00:00",
            "topic": "Batch topic one",
            "schedules": {
                "id": "sched-batch-1",
                "user_id": "user-1",
                "providers": ["youtube"],
                "youtube_account_ids": ["yt-1"],
                "personas": {
                    "id": "persona-1",
                    "name": "Ana",
                    "niche": "travel",
                    "script_prompt": "",
                    "language": "en",
                    "video_aspect": "9:16",
                    "photo_path": "user-1/foto.png",
                    "avatar_url": None,
                    "voice_id": "calm",
                    "voice_audio_path": None,
                    "paragraph_number": 1,
                    "face_mix_percent": 50,
                    "face_quality": "ok",
                },
            },
        }

    def test_dispatch_failure_tracks_failed_with_funnel_context(self):
        from app.services.fill_schedule import generate as gen_module

        store = MagicMock()
        store.signed_url = MagicMock(return_value="https://signed/foto.png")
        generator = gen_module.BatchGenerator(
            store=store, task_state=MagicMock(), notify=MagicMock()
        )
        boom = RuntimeError("dispatch exploded: api_key=TOPSECRET123")
        with (
            patch.object(gen_module.tm, "track_generation_requested"),
            patch.object(gen_module, "track_event") as track,
            patch.object(
                generator, "_dispatch_generation", side_effect=boom
            ),
        ):
            label = generator._generate_slot(self._slot())
        self.assertIsNone(label)
        failed_calls = [
            c for c in track.call_args_list if c[0][0] == "video_generation_failed"
        ]
        self.assertEqual(len(failed_calls), 1)
        _, props = failed_calls[0][0]
        self.assertEqual(props["flow"], "batch")
        self.assertEqual(props["pipeline"], "video")
        self.assertEqual(props["user_id"], "user-1")
        self.assertEqual(props["slotId"], "slot-batch-fail-1")
        self.assertIn("task_id", props)
        self.assertIn("[redacted]", props["reason"])
        self.assertNotIn("TOPSECRET123", props["reason"])


    def test_dispatch_failure_scrubs_full_message_before_truncation(self):
        # The batch call site must pin the scrub-then-truncate order too:
        # a short message makes [:200] a no-op, so only a >200-char
        # secret-bearing message guards against a truncate-first revert.
        from app.services import analytics as analytics_module
        from app.services.fill_schedule import generate as gen_module

        store = MagicMock()
        store.signed_url = MagicMock(return_value="https://signed/foto.png")
        generator = gen_module.BatchGenerator(
            store=store, task_state=MagicMock(), notify=MagicMock()
        )
        error = RuntimeError("E" * 150 + " api_key=TOPSECRET123" + "F" * 150)
        with (
            patch.object(gen_module.tm, "track_generation_requested"),
            patch.object(gen_module, "track_event") as track,
            patch.object(
                gen_module,
                "scrub_secret_values",
                wraps=analytics_module.scrub_secret_values,
            ) as scrub,
            patch.object(generator, "_dispatch_generation", side_effect=error),
        ):
            label = generator._generate_slot(self._slot())
        self.assertIsNone(label)
        # The scrubber received the whole message, not the truncated slice.
        scrub.assert_called_once_with(str(error))
        failed_calls = [
            c for c in track.call_args_list if c[0][0] == "video_generation_failed"
        ]
        self.assertEqual(len(failed_calls), 1)
        _, props = failed_calls[0][0]
        self.assertIn("[redacted]", props["reason"])
        self.assertNotIn("TOPSECRET123", props["reason"])
        self.assertLessEqual(len(str(props["reason"])), 200)


if __name__ == "__main__":
    unittest.main()
