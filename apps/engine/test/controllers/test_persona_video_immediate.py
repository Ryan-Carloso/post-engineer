"""The daily 6am persona batch is gone: every video generates immediately.

/persona-videos must start generation right away for every persona type
(face, avatar, or faceless) — no daily batch queue, no 6am cutoff.
Single videos go through the same request-batching core (batch of one)
as POST /persona-videos/batch.
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

    def test_single_video_delegates_to_batch_core_as_batch_of_one(self) -> None:
        """POST /persona-videos is a thin wrapper: batch of one, same response."""
        body = _persona_video_request(avatar_url="https://example.com/a.png")
        params = object()
        with patch.object(
            video_controller,
            "process_persona_videos",
            return_value=[("task-1", params)],
        ) as process:
            result = video_controller.create_persona_video(_request(), body)
        process.assert_called_once()
        user_id, batch_body = process.call_args.args
        self.assertEqual(user_id, "internal")
        self.assertEqual(len(batch_body.items), 1)
        item = batch_body.items[0]
        self.assertEqual(item.topic, "test topic")
        self.assertEqual(item.goal, "teach")
        self.assertEqual(item.platform_ids, ["youtube"])
        self.assertEqual(item.video_quality, body.content.video_quality)
        self.assertEqual(batch_body.persona, body.persona)
        # External contract unchanged: 200 + TaskResponse shape {data: {task_id}}.
        self.assertEqual(
            result, {"status": 200, "data": {"task_id": "task-1"}}
        )

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
