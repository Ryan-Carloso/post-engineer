"""A newly created direct task reads queued until the worker starts it.

The engine renders one video at a time, so a task behind a busy slot
waits in the FIFO queue. Its row must say queued (state 3) at progress
0, not processing — otherwise a waiter cannot tell "queued behind
other renders" from "stuck at 0%". ``start()`` flips the row to
processing when the worker begins, so an immediately started task
still passes through queued momentarily.
"""

import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from app.controllers.v1 import video as video_controller
from app.models import const
from app.models.schema import TaskVideoRequest
from app.services import state as sm


class CreateTaskQueuedStateTests(unittest.TestCase):
    def _call_create_task(self, body):
        auth = SimpleNamespace(user_id="user-1")
        with (
            patch.object(video_controller.base, "get_task_id", return_value="req-1"),
            patch.object(video_controller.base, "get_auth_context", return_value=auth),
            patch.object(video_controller.task_manager, "add_task") as add_task,
        ):
            response = video_controller.create_task(MagicMock(), body, stop_at="video")
        return response, add_task

    def test_created_task_is_queued_at_progress_zero(self):
        body = TaskVideoRequest(
            video_title="subject",
            video_description="Test description.",
            video_type="voiceover",
            video_script="script",
        )
        response, _ = self._call_create_task(body)
        task_id = response["body"]["task_id"]
        try:
            task = sm.state.get_task(task_id, user_id="user-1")
            self.assertIsNotNone(task)
            self.assertEqual(task["state"], const.TASK_STATE_QUEUED)
            self.assertEqual(task["progress"], 0)
        finally:
            sm.state.delete_task(task_id)


if __name__ == "__main__":
    unittest.main()
