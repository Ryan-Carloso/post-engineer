"""The direct dispatch persists the publish plan for boot-time recovery.

Task params are otherwise in-process only, so a restart would lose the
publish destination. Persisting ``publish_params`` on the task row lets the
boot orphan triage finish an interrupted publish (orphan_requeue).
"""

import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from starlette.requests import Request

from app.controllers import base
from app.controllers.v1 import video as video_controller
from app.models.schema import PublishParams, TaskVideoRequest


def _request(user_id: str = "u-1") -> Request:
    request = Request({"type": "http", "headers": [], "query_string": b""})
    request.state.auth = base.AuthContext(user_id=user_id)
    return request


def _body(with_publish: bool) -> TaskVideoRequest:
    publish = (
        PublishParams(
            providers=["youtube"],
            youtube={
                "title": "t",
                "description": "d",
                "tags": ["shorts"],
                "privacy_status": "public",
                "account_ids": ["acc-1"],
            },
        )
        if with_publish
        else None
    )
    return TaskVideoRequest(video_subject="hello world", publish=publish)


class PublishParamsPersistenceTests(unittest.TestCase):
    def _create(self, with_publish: bool):
        with (
            patch("app.utils.utils.get_uuid", return_value="task-1"),
            patch.object(video_controller.sm.state, "update_task") as update_task,
            patch.object(video_controller, "task_manager"),
        ):
            video_controller.create_task(_request(), _body(with_publish), stop_at="video")
        return update_task

    def test_publish_params_persisted_when_present(self):
        update_task = self._create(with_publish=True)
        _, kwargs = update_task.call_args
        params = kwargs.get("publish_params")
        self.assertIsInstance(params, dict)
        self.assertEqual(params["providers"], ["youtube"])
        self.assertEqual(params["youtube"]["account_ids"], ["acc-1"])

    def test_no_publish_params_key_when_absent(self):
        update_task = self._create(with_publish=False)
        _, kwargs = update_task.call_args
        self.assertNotIn("publish_params", kwargs)


if __name__ == "__main__":
    unittest.main()
