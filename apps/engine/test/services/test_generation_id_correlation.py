"""generation_id x task_id correlation for engine telemetry.

The web's video_generations row id (``generation_id``) and the engine's task
id (``task_id``) name the same unit of work. The engine accepts the optional
``generation_id`` on TaskVideoRequest, stores it on the task row, and stamps
it on every PostHog lifecycle event (requested/started/progress/generated/
failed) plus the 404 $exception — without unifying the two IDs (the engine
stays a generic task system: video/subtitle/audio share one namespace).
"""

import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from app.models.exception import HttpException
from app.models.schema import TaskVideoRequest
from app.services import state as sm
from app.services import task as tm


class SchemaTests(unittest.TestCase):
    def test_generation_id_is_optional_and_defaults_to_none(self):
        body = TaskVideoRequest(video_subject="subject", video_script="script")
        self.assertIsNone(body.generation_id)

    def test_generation_id_parses_when_provided(self):
        body = TaskVideoRequest(
            video_subject="subject",
            video_script="script",
            generation_id="gen-123",
        )
        self.assertEqual(body.generation_id, "gen-123")

    def test_generation_id_is_included_in_model_dump(self):
        # create_task stores body.model_dump() as the task params, so the
        # correlation id must survive serialization.
        body = TaskVideoRequest(
            video_subject="subject",
            video_script="script",
            generation_id="gen-123",
        )
        self.assertEqual(body.model_dump()["generation_id"], "gen-123")


class RequestedEventTests(unittest.TestCase):
    def setUp(self):
        tm._requested_event_emitted_tasks.clear()

    def test_requested_event_carries_generation_id(self):
        with patch.object(tm, "track_event") as track:
            tm.track_generation_requested(
                "task-1",
                user_id="user-1",
                flow="direct",
                pipeline="video",
                generation_id="gen-123",
            )
        _, props = track.call_args[0]
        self.assertEqual(props["generation_id"], "gen-123")

    def test_requested_event_omits_generation_id_when_absent(self):
        with patch.object(tm, "track_event") as track:
            tm.track_generation_requested(
                "task-2", user_id="user-1", flow="direct", pipeline="video"
            )
        _, props = track.call_args[0]
        self.assertNotIn("generation_id", props)

    def test_requested_event_omits_blank_generation_id(self):
        # Blank is not a correlation id: the event must not carry noise.
        with patch.object(tm, "track_event") as track:
            tm.track_generation_requested(
                "task-3",
                user_id="user-1",
                flow="direct",
                pipeline="video",
                generation_id="",
            )
        _, props = track.call_args[0]
        self.assertNotIn("generation_id", props)


class TrackingContextTests(unittest.TestCase):
    def setUp(self):
        self.task_id = "corr-ctx-task-1"

    def tearDown(self):
        sm.state.delete_task(self.task_id)

    def test_tracking_context_reads_generation_id_from_task_row(self):
        sm.state.update_task(
            self.task_id,
            user_id="user-1",
            flow="direct",
            pipeline="video",
            generation_id="gen-123",
        )
        context = tm._task_tracking_context(self.task_id)
        self.assertEqual(context["generation_id"], "gen-123")

    def test_tracking_context_omits_generation_id_when_row_has_none(self):
        sm.state.update_task(
            self.task_id, user_id="user-1", flow="direct", pipeline="video"
        )
        context = tm._task_tracking_context(self.task_id)
        self.assertNotIn("generation_id", context)


class LifecycleEventTests(unittest.TestCase):
    """Progress, started and terminal events inherit generation_id from the
    task row via _task_tracking_context."""

    def setUp(self):
        self.task_id = "corr-life-task-1"
        sm.state.update_task(
            self.task_id,
            user_id="user-1",
            flow="direct",
            pipeline="video",
            generation_id="gen-123",
        )

    def tearDown(self):
        sm.state.delete_task(self.task_id)
        tm._progress_milestones.pop(self.task_id, None)

    def test_started_event_carries_generation_id(self):
        with patch.object(tm, "track_event") as track:
            tm.track_generation_started(self.task_id)
        _, props = track.call_args[0]
        self.assertEqual(props["generation_id"], "gen-123")

    def test_progress_event_carries_generation_id(self):
        with patch.object(tm, "track_event") as track:
            tm._update_task(self.task_id, progress=25)
        progress_calls = [
            c for c in track.call_args_list if c[0][0] == "video_generation_progress"
        ]
        self.assertTrue(progress_calls)
        for c in progress_calls:
            self.assertEqual(c[0][1]["generation_id"], "gen-123")

    def test_failed_event_carries_generation_id(self):
        with patch.object(tm, "track_event") as track:
            tm._fail_task(self.task_id, error="boom")
        failed_calls = [
            c
            for c in track.call_args_list
            if c[0][0] == "video_generation_failed"
        ]
        self.assertTrue(failed_calls)
        self.assertEqual(failed_calls[0][0][1]["generation_id"], "gen-123")


class CreateTaskPassthroughTests(unittest.TestCase):
    """POST /videos body.generation_id -> task row + requested event."""

    def test_body_generation_id_reaches_state_and_requested_event(self):
        from app.controllers.v1 import video as video_controller

        body = TaskVideoRequest(
            video_subject="subject",
            video_script="script",
            generation_id="gen-123",
        )
        auth = SimpleNamespace(user_id="user-1")
        with (
            patch.object(video_controller.base, "get_task_id", return_value="req-1"),
            patch.object(video_controller.base, "get_auth_context", return_value=auth),
            patch.object(video_controller.task_manager, "add_task") as add_task,
            patch.object(tm, "track_generation_requested") as requested,
        ):
            add_task.side_effect = lambda func, *a, **kw: kw["on_accepted"]()
            resp = video_controller.create_task(MagicMock(), body, stop_at="video")
            task_id = resp["data"]["task_id"]
        try:
            task = sm.state.get_task(task_id)
            self.assertEqual(task["generation_id"], "gen-123")
            _, kwargs = requested.call_args
            self.assertEqual(kwargs["generation_id"], "gen-123")
        finally:
            sm.state.delete_task(task_id)

    def test_absent_generation_id_stays_absent(self):
        from app.controllers.v1 import video as video_controller

        body = TaskVideoRequest(video_subject="subject", video_script="script")
        auth = SimpleNamespace(user_id="user-1")
        with (
            patch.object(video_controller.base, "get_task_id", return_value="req-2"),
            patch.object(video_controller.base, "get_auth_context", return_value=auth),
            patch.object(video_controller.task_manager, "add_task") as add_task,
            patch.object(tm, "track_generation_requested") as requested,
        ):
            add_task.side_effect = lambda func, *a, **kw: kw["on_accepted"]()
            resp = video_controller.create_task(MagicMock(), body, stop_at="video")
            task_id = resp["data"]["task_id"]
        try:
            task = sm.state.get_task(task_id)
            self.assertNotIn("generation_id", task)
            _, kwargs = requested.call_args
            self.assertNotIn("generation_id", kwargs)
        finally:
            sm.state.delete_task(task_id)


class NotFoundExceptionTests(unittest.TestCase):
    """The 404 'task not found' $exception binds generation_id when the task
    row is still known to state (e.g. invisible to the user-scoped lookup),
    so the failing poll can be joined back to the video_generations row."""

    def test_http_exception_binds_generation_id(self):
        with patch("app.models.exception.logger") as mock_logger:
            HttpException(
                task_id="task-1",
                status_code=404,
                message="task not found",
                generation_id="gen-123",
            )
        mock_logger.bind.assert_called_once_with(
            task_id="task-1", http_status_code=404, generation_id="gen-123"
        )

    def test_http_exception_omits_generation_id_when_absent(self):
        with patch("app.models.exception.logger") as mock_logger:
            HttpException(task_id="task-1", status_code=404, message="task not found")
        mock_logger.bind.assert_called_once_with(
            task_id="task-1", http_status_code=404
        )

    def test_get_task_404_recovers_generation_id_from_unscoped_row(self):
        from app.controllers.v1 import video as video_controller

        task_id = "corr-404-task-1"
        sm.state.update_task(
            task_id,
            user_id="other-user",
            flow="direct",
            pipeline="video",
            generation_id="gen-123",
        )
        auth = SimpleNamespace(user_id="user-1")
        try:
            with (
                patch.object(
                    video_controller.base, "get_task_id", return_value="req-404"
                ),
                patch.object(
                    video_controller.base, "get_auth_context", return_value=auth
                ),
                patch("app.models.exception.logger") as mock_logger,
            ):
                with self.assertRaises(HttpException):
                    video_controller.get_task(MagicMock(), task_id=task_id)
            bind_kwargs = mock_logger.bind.call_args[1]
            self.assertEqual(bind_kwargs["generation_id"], "gen-123")
        finally:
            sm.state.delete_task(task_id)

    def test_get_task_404_omits_generation_id_when_row_is_gone(self):
        from app.controllers.v1 import video as video_controller

        auth = SimpleNamespace(user_id="user-1")
        with (
            patch.object(video_controller.base, "get_task_id", return_value="req-404b"),
            patch.object(video_controller.base, "get_auth_context", return_value=auth),
            patch("app.models.exception.logger") as mock_logger,
        ):
            with self.assertRaises(HttpException):
                video_controller.get_task(MagicMock(), task_id="ghost-task-404")
        bind_kwargs = mock_logger.bind.call_args[1]
        self.assertNotIn("generation_id", bind_kwargs)


if __name__ == "__main__":
    unittest.main()
