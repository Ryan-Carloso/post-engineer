"""Gating for the daily persona batch: faceless videos skip the 6am queue."""

import unittest
from typing import Optional
from unittest.mock import Mock, patch

from app.controllers.v1 import video as video_controller
from app.models.schema import (
    ContentParams,
    PersonaParams,
    PersonaVideoRequest,
    TaskVideoRequest,
)


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


class PersonaBatchGatingTest(unittest.TestCase):
    def test_faceless_persona_skips_daily_batch(self) -> None:
        params = _video_params()
        with patch.object(video_controller, "_persona_batch_enabled", True):
            self.assertFalse(video_controller._use_daily_persona_batch(params))

    def test_avatar_persona_uses_daily_batch(self) -> None:
        params = _video_params(avatar_url="https://example.com/avatar.png")
        with patch.object(video_controller, "_persona_batch_enabled", True):
            self.assertTrue(video_controller._use_daily_persona_batch(params))

    def test_photo_persona_uses_daily_batch(self) -> None:
        params = _video_params(photo_url="https://example.com/face.png")
        with patch.object(video_controller, "_persona_batch_enabled", True):
            self.assertTrue(video_controller._use_daily_persona_batch(params))

    def test_batch_disabled_skips_daily_batch_even_with_face(self) -> None:
        params = _video_params(photo_url="https://example.com/face.png")
        with patch.object(video_controller, "_persona_batch_enabled", False):
            self.assertFalse(video_controller._use_daily_persona_batch(params))

    def test_face_with_lipsync_disabled_skips_daily_batch(self) -> None:
        params = _video_params(
            photo_url="https://example.com/face.png", lipsync_enabled=False
        )
        with patch.object(video_controller, "_persona_batch_enabled", True):
            self.assertFalse(video_controller._use_daily_persona_batch(params))


class PersonaBatchRouteTest(unittest.TestCase):
    """Pin the daily_batch wiring at the /persona-videos route boundary."""

    def test_faceless_persona_video_skips_batch_at_route(self) -> None:
        body = _persona_video_request()
        with (
            patch.object(video_controller, "_persona_batch_enabled", True),
            patch.object(video_controller, "create_task") as create_task,
        ):
            video_controller.create_persona_video(request=Mock(), body=body)
        _, kwargs = create_task.call_args
        self.assertFalse(kwargs["daily_batch"])

    def test_face_persona_video_uses_batch_at_route(self) -> None:
        body = _persona_video_request(photo_url="https://example.com/face.png")
        with (
            patch.object(video_controller, "_persona_batch_enabled", True),
            patch.object(video_controller, "create_task") as create_task,
        ):
            video_controller.create_persona_video(request=Mock(), body=body)
        _, kwargs = create_task.call_args
        self.assertTrue(kwargs["daily_batch"])
