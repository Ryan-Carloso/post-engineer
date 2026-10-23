"""POST /videos (create_task) rejects non-English video languages.

English-only launch: web and MCP gate the same rule upstream; this is the
engine backstop for callers that reach the public video-job boundary
directly. An empty video_language keeps the historical auto-detect
default and is not rejected.
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
from app.services import state as sm


class CreateTaskLanguageGateTests(unittest.TestCase):
    def _call_create_task(self, body):
        auth = SimpleNamespace(user_id="user-1")
        with (
            patch.object(
                video_controller.base, "get_task_id", return_value="req-1"
            ),
            patch.object(
                video_controller.base, "get_auth_context", return_value=auth
            ),
            patch.object(video_controller.task_manager, "add_task") as add_task,
        ):
            response = video_controller.create_task(
                MagicMock(), body, stop_at="video"
            )
        return response, add_task

    def test_rejects_non_english_video_language(self):
        for language in ("pt", "pt-BR", "es", "fr"):
            with self.subTest(language=language):
                body = TaskVideoRequest(
                    video_subject="subject",
                    video_script="script",
                    video_language=language,
                )
                auth = SimpleNamespace(user_id="user-1")
                with (
                    patch.object(
                        video_controller.base,
                        "get_task_id",
                        return_value="req-1",
                    ),
                    patch.object(
                        video_controller.base,
                        "get_auth_context",
                        return_value=auth,
                    ),
                    patch.object(
                        video_controller.task_manager, "add_task"
                    ) as add_task,
                ):
                    with self.assertRaises(HttpException) as ctx:
                        video_controller.create_task(
                            MagicMock(), body, stop_at="video"
                        )
                self.assertEqual(ctx.exception.status_code, 400)
                self.assertIn(
                    "Only English videos are supported for now",
                    ctx.exception.message,
                )
                add_task.assert_not_called()

    def test_accepts_english_and_unset_video_language(self):
        for language in ("en", "en-US", "EN", ""):
            with self.subTest(language=language):
                body = TaskVideoRequest(
                    video_subject="subject",
                    video_script="script",
                    video_language=language,
                )
                response, add_task = self._call_create_task(body)
                add_task.assert_called_once()
                task_id = response["body"]["task_id"]
                self.assertTrue(task_id)
                sm.state.delete_task(task_id)


if __name__ == "__main__":
    unittest.main()
