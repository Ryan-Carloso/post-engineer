"""Tests for the persona payload validator (stateless).

The service does NOT persist anything: personas live in the caller's
database (Supabase). This module only validates and normalizes the
persona payload that arrives inline on a video job.
"""

import pytest

from app.services import persona as persona_service


class TestValidatePersona:
    def test_valid_payload_with_photo_url_and_house_voice(self):
        payload = persona_service.validate_persona(
            name="Ana",
            photo_url="https://cdn.example.test/foto.png",
            voice_id="calm",
        )

        assert payload == {
            "name": "Ana",
            "photo_url": "https://cdn.example.test/foto.png",
            "avatar_url": None,
            "voice_id": "calm",
            "voice_audio_url": None,
        }

    def test_valid_payload_with_avatar_url_and_own_voice(self):
        payload = persona_service.validate_persona(
            name="Robo",
            avatar_url="data:image/png;base64,IA",
            voice_audio_url="https://supabase.test/signed/voz.mp3",
        )

        assert payload["avatar_url"].startswith("data:image")
        assert payload["voice_audio_url"].endswith(".mp3")
        assert payload["voice_id"] is None

    def test_name_is_stripped(self):
        payload = persona_service.validate_persona(
            name="  Ana  ",
            photo_url="https://cdn.example.test/f.png",
            voice_id="v1",
        )

        assert payload["name"] == "Ana"

    def test_missing_name_raises(self):
        with pytest.raises(persona_service.PersonaValidationError):
            persona_service.validate_persona(
                name="  ",
                photo_url="https://cdn.example.test/f.png",
                voice_id="v1",
            )

    def test_missing_visual_identity_raises(self):
        with pytest.raises(persona_service.PersonaValidationError):
            persona_service.validate_persona(name="Ana", voice_id="v1")

    def test_both_photo_and_avatar_raises(self):
        with pytest.raises(persona_service.PersonaValidationError):
            persona_service.validate_persona(
                name="Ana",
                photo_url="https://cdn.example.test/f.png",
                avatar_url="https://cdn.example.test/a.png",
                voice_id="v1",
            )

    def test_missing_voice_raises(self):
        with pytest.raises(persona_service.PersonaValidationError):
            persona_service.validate_persona(
                name="Ana",
                photo_url="https://cdn.example.test/f.png",
            )

    def test_both_voice_kinds_raises(self):
        with pytest.raises(persona_service.PersonaValidationError):
            persona_service.validate_persona(
                name="Ana",
                photo_url="https://cdn.example.test/f.png",
                voice_id="v1",
                voice_audio_url="https://supabase.test/signed/voz.mp3",
            )


class TestHouseVoices:
    def test_house_voices_are_available(self):
        voices = persona_service.get_house_voices()

        assert len(voices) > 0
        for voice in voices:
            assert voice["id"]








