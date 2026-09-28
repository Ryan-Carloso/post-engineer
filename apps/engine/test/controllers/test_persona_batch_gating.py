"""Gating for the daily persona batch: faceless videos skip the 6am queue."""

import unittest
from typing import Optional
from unittest.mock import patch

from app.controllers.v1 import video as video_controller
from app.models.schema import PersonaParams, TaskVideoRequest


def _video_params(
    photo_url: Optional[str] = None, avatar_url: Optional[str] = None
) -> TaskVideoRequest:
    persona = PersonaParams(
        voice_id="voice-1", photo_url=photo_url, avatar_url=avatar_url
    )
    return TaskVideoRequest(
        video_subject="test topic", persona=persona, lipsync_enabled=True
    )


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
