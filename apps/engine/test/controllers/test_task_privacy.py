"""Operator-private task fields are never exposed through the API.

cost_usd (the Modal GPU cost, tracked for PostHog unit economics) is
persisted on the task row, but GET /api/v1/tasks and
GET /api/v1/tasks/{task_id} must strip it: the web forwards task bodies
to browsers wholesale, and the cost is the operator's private metric.
"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from starlette.requests import Request

from app.controllers import base
from app.controllers.v1 import video as video_controller
from app.models import const
from app.models.schema import TaskQueryRequest
from app.services import state as sm


def _request(user_id: str = "u-1") -> Request:
    request = Request({"type": "http", "headers": [], "query_string": b""})
    request.state.auth = base.AuthContext(user_id=user_id)
    return request


class TaskPrivacyTests(unittest.TestCase):
    def setUp(self):
        self.task_id = "privacy-task-1"
        sm.state.update_task(
            self.task_id,
            user_id="u-1",
            state=const.TASK_STATE_COMPLETE,
            progress=100,
            cost_usd=0.1,
            videos=["/tmp/final.mp4"],
        )

    def tearDown(self):
        sm.state.delete_task(self.task_id)

    def test_get_task_strips_cost_usd(self):
        response = video_controller.get_task(
            _request(), self.task_id, TaskQueryRequest()
        )
        body = response["body"]
        self.assertNotIn("cost_usd", body)
        # Everything else still comes through.
        self.assertEqual(body["task_id"], self.task_id)
        self.assertEqual(body["state"], const.TASK_STATE_COMPLETE)

    def test_get_all_tasks_strips_cost_usd(self):
        response = video_controller.get_all_tasks(_request(), 1, 10)
        tasks = response["body"]["tasks"]
        self.assertEqual(len(tasks), 1)
        self.assertNotIn("cost_usd", tasks[0])
        self.assertEqual(tasks[0]["task_id"], self.task_id)

    def test_public_task_view_returns_a_copy(self):
        task = {"task_id": "t", "cost_usd": 0.1}
        view = video_controller._public_task_view(task)
        self.assertNotIn("cost_usd", view)
        # The stored row is untouched.
        self.assertIn("cost_usd", task)


if __name__ == "__main__":
    unittest.main()
