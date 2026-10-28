"""Direct tests for the extracted persona_lipsync_active helper."""

from app.models.schema import PersonaParams, VideoParams
from app.services.lipsync_active import persona_lipsync_active


def _params(**overrides):
    values = {"video_subject": "x"}
    values.update(overrides)
    return VideoParams(**values)


def test_photo_persona_with_lipsync_is_active():
    persona = PersonaParams(name="P", photo_url="https://e.com/p.jpg", voice_id="v")
    assert persona_lipsync_active(_params(persona=persona)) is True


def test_avatar_persona_with_lipsync_is_active():
    persona = PersonaParams(name="P", avatar_url="https://e.com/a.jpg", voice_id="v")
    assert persona_lipsync_active(_params(persona=persona)) is True


def test_no_persona_is_inactive():
    assert persona_lipsync_active(_params()) is False


def test_lipsync_disabled_is_inactive_even_with_a_photo():
    persona = PersonaParams(name="P", photo_url="https://e.com/p.jpg", voice_id="v")
    assert persona_lipsync_active(_params(persona=persona, lipsync_enabled=False)) is False
