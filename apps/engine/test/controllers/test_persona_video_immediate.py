"""The daily 6am persona batch is gone: every video generates immediately.

/persona-videos must start generation right away for every persona type
(face, avatar, or faceless) — no batch queue, no daily cutoff.
"""

import inspect
import types
import unittest
from typing import Optional
from unittest.mock import patch

from app.controllers.v1 import video as video_controller
from app.models.schema import (
    ContentParams,
    PersonaParams,
    PersonaVideoRequest,
    TaskVideoRequest,
)
from app.services import task as task_service


def _video_params(
    photo_url: Optional[str] = None,
    avatar_url: Optional[str] = None,
    lipsync_enabled: bool = True,
) -> TaskVideoRequest:
    persona = PersonaParams(
        voice_id="voice-1", photo_url=photo_url, avatar_url=avatar_url
    )
    return TaskVideoRequest(
        video_subject="test topic",
        persona=persona,
        lipsync_enabled=lipsync_enabled,
    )


def _persona_video_request(
    photo_url: Optional[str] = None, avatar_url: Optional[str] = None
) -> PersonaVideoRequest:
    persona = PersonaParams(
        voice_id="voice-1",
        photo_url=photo_url,
        avatar_url=avatar_url,
        niche="tech",
        speaking_style="casual",
        audience="devs",
        language="pt-BR",
    )
    content = ContentParams(
        topic="test topic", goal="teach", platform_ids=["youtube"]
    )
    return PersonaVideoRequest(persona=persona, content=content)


def _request() -> object:
    return type(
        "Request",
        (),
        {
            "headers": {"x-task-id": "request"},
            "state": types.SimpleNamespace(
                auth=video_controller.base.AuthContext(
                    user_id="internal", auth_type="internal"
                )
            ),
        },
    )()


class PersonaVideoImmediateTest(unittest.TestCase):
    def test_batch_machinery_is_gone(self) -> None:
        for name in (
            "_use_daily_persona_batch",
            "_persona_batch_queue",
            "_persona_batch_enabled",
            "fill_schedule_queue",
            "start_persona_batch_scheduler",
            "_dispatch_persona_batch_task",
        ):
            self.assertFalse(
                hasattr(video_controller, name), f"{name} should not exist"
            )

    def test_create_task_has_no_daily_batch_param(self) -> None:
        params = inspect.signature(video_controller.create_task).parameters
        self.assertNotIn("daily_batch", params)

    def test_persona_video_route_does_not_request_batching(self) -> None:
        body = _persona_video_request(avatar_url="https://example.com/a.png")
        with patch.object(
            video_controller, "create_task", return_value="task"
        ) as create_task:
            result = video_controller.create_persona_video(object(), body)
        self.assertEqual(result, "task")
        self.assertNotIn("daily_batch", create_task.call_args.kwargs)

    def test_face_persona_starts_immediately(self) -> None:
        body = _video_params(avatar_url="https://example.com/a.png")
        with (
            patch.object(video_controller.sm.state, "update_task") as update_task,
            patch.object(video_controller, "task_manager") as task_manager,
        ):
            video_controller.create_task(_request(), body, "video")
        update_task.assert_called_once()
        task_manager.add_task.assert_called_once()
        args, kwargs = task_manager.add_task.call_args
        self.assertIs(args[0], task_service.start)
        self.assertEqual(kwargs["params"], body)
        self.assertEqual(kwargs["stop_at"], "video")

    def test_faceless_persona_starts_immediately(self) -> None:
        body = _video_params(lipsync_enabled=False)
        with (
            patch.object(video_controller.sm.state, "update_task") as update_task,
            patch.object(video_controller, "task_manager") as task_manager,
        ):
            video_controller.create_task(_request(), body, "video")
        update_task.assert_called_once()
        task_manager.add_task.assert_called_once()
