"""Engine dispatch: a segments-origin job reaches the worker with the joined
script in video_script, so the script-generation step takes the supplied
script path and never calls the LLM for it."""

import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from app.controllers.v1 import video as video_controller
from app.models.schema import TaskVideoRequest
from app.services import state as sm
from test.controllers.test_task_segments_request import (
    BODY,
    CTA,
    HOOK,
    valid_segments,
)


class CreateTaskSegmentsDispatchTests(unittest.TestCase):
    def test_segments_job_dispatches_joined_script(self):
        body = TaskVideoRequest(video_subject="Porto", segments=valid_segments())
        auth = SimpleNamespace(user_id="user-1")
        with (
            patch.object(video_controller.base, "get_task_id", return_value="req-1"),
            patch.object(video_controller.base, "get_auth_context", return_value=auth),
            patch.object(video_controller.task_manager, "add_task") as add_task,
        ):
            response = video_controller.create_task(MagicMock(), body, stop_at="video")
        add_task.assert_called_once()
        dispatched = add_task.call_args.kwargs["params"]
        self.assertEqual(dispatched.video_script, f"{HOOK}\n\n{BODY}\n\n{CTA}")
        task_id = response["body"]["task_id"]
        self.assertTrue(task_id)
        sm.state.delete_task(task_id)


if __name__ == "__main__":
    unittest.main()
