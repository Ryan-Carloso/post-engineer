"""Direct tests for the extracted persona_lipsync_active helper."""

from app.models.schema import PersonaParams, VideoParams
from app.services.lipsync_active import persona_lipsync_active


def _params(**overrides):
    values = {
        "video_title": "x",
        "video_description": "Test description.",
        "video_type": "hook_lipsync" if overrides.get("persona") is not None else "faceless",
    }
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


def test_faceless_is_inactive_even_with_a_photo():
    persona = PersonaParams(name="P", photo_url="https://e.com/p.jpg", voice_id="v")
    assert persona_lipsync_active(_params(persona=persona, video_type="faceless")) is False


def test_hook_cap_is_the_configured_duration(monkeypatch):
    from app.config import config
    from app.services.lipsync_active import lip_sync_cap_seconds

    monkeypatch.setitem(config.app, "max_video_duration_seconds", 10)
    persona = PersonaParams(name="P", photo_url="https://e.com/p.jpg", voice_id="v")
    assert lip_sync_cap_seconds(_params(persona=persona)) == 10.0


def test_full_lipsync_cap_is_the_sixty_second_ceiling():
    from app.services import full_lipsync
    from app.services.lipsync_active import lip_sync_cap_seconds

    persona = PersonaParams(name="P", photo_url="https://e.com/p.jpg", voice_id="v")
    params = _params(persona=persona, video_type="full_lipsync")
    assert lip_sync_cap_seconds(params) == 60.0
    assert lip_sync_cap_seconds(params) == float(full_lipsync.MAX_FULL_LIPSYNC_SECONDS)


def test_hook_cap_defaults_to_forty_seconds(monkeypatch):
    from app.config import config
    from app.services.lipsync_active import lip_sync_cap_seconds

    monkeypatch.delitem(config.app, "max_video_duration_seconds", raising=False)
    persona = PersonaParams(name="P", photo_url="https://e.com/p.jpg", voice_id="v")
    assert lip_sync_cap_seconds(_params(persona=persona)) == 40.0
