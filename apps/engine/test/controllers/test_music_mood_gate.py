"""POST /videos (create_task) rejects unknown BGM moods with 400.

The mood travels with the request (``VideoParams.music_mood``) and must
name a catalogued mood: an unknown mood is a client error, never a
silent render without music. ``"none"`` (explicit no-music choice) and
an omitted mood always pass — the pipeline resolves the default.
"""

import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from app.controllers.v1 import video as video_controller
from app.models.exception import HttpException
from app.models.schema import TaskVideoRequest
from app.services import music_mood as mm
from app.services import state as sm


class CreateTaskMusicMoodGateTests(unittest.TestCase):
    def _call_create_task(self, body):
        auth = SimpleNamespace(user_id="user-1")
        with (
            patch.object(
                video_controller.base, "get_task_id", return_value="req-1"
            ),
            patch.object(
                video_controller.base, "get_auth_context", return_value=auth
            ),
            patch.object(
                mm, "get_available_music_moods", return_value=("calm", "upbeat")
            ),
            patch.object(video_controller.task_manager, "add_task") as add_task,
        ):
            response = video_controller.create_task(
                MagicMock(), body, stop_at="video"
            )
        return response, add_task

    def test_rejects_unknown_music_mood(self):
        body = TaskVideoRequest(
            video_subject="subject",
            video_script="script",
            music_mood="finance",
        )
        auth = SimpleNamespace(user_id="user-1")
        with (
            patch.object(
                video_controller.base, "get_task_id", return_value="req-1"
            ),
            patch.object(
                video_controller.base, "get_auth_context", return_value=auth
            ),
            patch.object(
                mm, "get_available_music_moods", return_value=("calm", "upbeat")
            ),
            patch.object(
                video_controller.task_manager, "add_task"
            ) as add_task,
        ):
            with self.assertRaises(HttpException) as ctx:
                video_controller.create_task(MagicMock(), body, stop_at="video")
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("unknown music mood", ctx.exception.message)
        self.assertIn("finance", ctx.exception.message)
        add_task.assert_not_called()

    def test_accepts_known_none_and_unset_music_mood(self):
        for music_mood in ("calm", "none", None):
            with self.subTest(music_mood=music_mood):
                body = TaskVideoRequest(
                    video_subject="subject",
                    video_script="script",
                    music_mood=music_mood,
                )
                response, add_task = self._call_create_task(body)
                add_task.assert_called_once()
                task_id = response["body"]["task_id"]
                self.assertTrue(task_id)
                sm.state.delete_task(task_id)


if __name__ == "__main__":
    unittest.main()
