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


class TestVoiceSampleLanguages:
    @pytest.fixture(autouse=True)
    def clean_sample_cache(self):
        persona_service._voice_sample_cache.clear()
        yield
        persona_service._voice_sample_cache.clear()

    def test_supported_languages_are_exposed(self):
        languages = persona_service.get_sample_languages()

        codes = [lang["code"] for lang in languages]
        for expected in ["pt", "en-us", "en-uk", "es", "fr"]:
            assert expected in codes
        for lang in languages:
            assert lang["label"]

    def test_unknown_voice_raises(self, monkeypatch):
        monkeypatch.setattr(persona_service.voice_service, "tts", lambda *a, **k: None)
        with pytest.raises(persona_service.PersonaValidationError):
            persona_service.synthesize_voice_sample("house-unknown", "pt")

    def test_unsupported_language_raises(self, monkeypatch):
        monkeypatch.setattr(persona_service.voice_service, "tts", lambda *a, **k: None)
        with pytest.raises(persona_service.PersonaValidationError):
            persona_service.synthesize_voice_sample("calm", "jp")

    def test_synthesizes_once_and_reuses_cached_audio(self, monkeypatch):
        calls = []

        def fake_tts(text, voice_name, rate, voice_file, *args, **kwargs):
            calls.append(voice_name)
            with open(voice_file, "wb") as f:
                f.write(b"fake-mp3-bytes")

        monkeypatch.setattr(persona_service.voice_service, "tts", fake_tts)

        first = persona_service.synthesize_voice_sample("calm", "pt")
        second = persona_service.synthesize_voice_sample("calm", "pt")

        assert first == b"fake-mp3-bytes"
        assert second == b"fake-mp3-bytes"
        assert len(calls) == 1

    def test_same_voice_different_language_synthesizes_again(self, monkeypatch):
        calls = []

        def fake_tts(text, voice_name, rate, voice_file, *args, **kwargs):
            calls.append(voice_name)
            with open(voice_file, "wb") as f:
                f.write(f"mp3:{voice_name}".encode())

        monkeypatch.setattr(persona_service.voice_service, "tts", fake_tts)

        pt = persona_service.synthesize_voice_sample("calm", "pt")
        en = persona_service.synthesize_voice_sample("calm", "en-us")

        assert pt != en
        assert len(calls) == 2


class TestVoiceSampleScripts:
    def test_every_sample_language_has_script(self):
        languages = [lang["code"] for lang in persona_service.get_sample_languages()]

        for code in languages:
            script = persona_service.VOICE_SAMPLE_TEXTS.get(code)
            assert script, f"missing sample script for language: {code}"

    def test_scripts_sound_like_video_intro(self):
        for code, script in persona_service.VOICE_SAMPLE_TEXTS.items():
            assert len(script.split()) >= 10, f"script too short for {code}"

    def test_scripts_are_short_enough_for_a_20s_video(self):
        for code, script in persona_service.VOICE_SAMPLE_TEXTS.items():
            assert len(script.split()) <= 20, f"script too long for {code}"

    def test_scripts_have_no_greeting_cliche(self):
        banned = ["fala, pessoal", "hey everyone", "hello everyone",
                  "hola a todos", "salut à tous"]
        for code, script in persona_service.VOICE_SAMPLE_TEXTS.items():
            low = script.lower()
            for phrase in banned:
                assert phrase not in low, f"greeting cliche '{phrase}' in {code}"


class TestVoiceSampleStyles:
    def test_no_generic_en_language(self):
        codes = [lang["code"] for lang in persona_service.get_sample_languages()]
        assert "en" not in codes

    def test_every_house_voice_has_config_for_every_language(self):
        codes = [lang["code"] for lang in persona_service.get_sample_languages()]
        for voice in persona_service.HOUSE_VOICES:
            for code in codes:
                config = persona_service.sample_config_for(voice["id"], code)
                assert config["voice"]
                assert config["rate"]

    def test_female_peers_sound_different(self):
        # calm e young devem soar diferentes: voz OU rate
        for code in ["pt", "en-us", "en-uk", "es", "fr"]:
            calm = persona_service.sample_config_for("calm", code)
            young = persona_service.sample_config_for("young", code)
            assert calm["voice"] != young["voice"] or calm["rate"] != young["rate"], (
                f"calm e young iguais em {code}"
            )

    def test_male_peers_differ_by_rate_when_only_one_male_voice(self):
        for code in ["pt", "es", "fr"]:
            energetic = persona_service.sample_config_for("energetic", code)
            deep = persona_service.sample_config_for("deep", code)
            sounds_different = energetic["voice"] != deep["voice"] or energetic["rate"] != deep["rate"]
            assert sounds_different, f"energetic e deep iguais em {code}"

    def test_all_chosen_voices_exist_in_azure_catalog(self):
        available = set(persona_service.voice_service.get_all_azure_voices())
        codes = [lang["code"] for lang in persona_service.get_sample_languages()]
        for voice in persona_service.HOUSE_VOICES:
            for code in codes:
                chosen = persona_service.sample_config_for(voice["id"], code)["voice"]
                assert any(v.startswith(chosen + "-") for v in available), (
                    f"{chosen} ({voice['id']}/{code}) nao existe no catalogo"
                )

    def test_deep_is_lower_with_lower_pitch(self):
        # deep is "low/deep": needs a lowered pitch to sound different
        # from energetic when they share the same male voice in a locale
        assert persona_service.HOUSE_VOICE_STYLES["energetic"]["rate"] == 1.2
        assert persona_service.HOUSE_VOICE_STYLES["energetic"]["pitch"] == "+5Hz"
        assert persona_service.HOUSE_VOICE_STYLES["deep"]["rate"] == 1.4
        assert persona_service.HOUSE_VOICE_STYLES["deep"]["pitch"] == "-5Hz"

    def test_synthesize_uses_persona_voice_and_rate(self, monkeypatch):
        persona_service._voice_sample_cache.clear()
        captured = {}

        def fake_tts(text, voice_name, rate, voice_file, volume=1.0, voice_pitch=""):
            captured["voice_name"] = voice_name
            captured["rate"] = rate
            captured["pitch"] = voice_pitch
            with open(voice_file, "wb") as f:
                f.write(b"mp3")

        monkeypatch.setattr(persona_service.voice_service, "tts", fake_tts)
        persona_service.synthesize_voice_sample("calm", "pt")

        assert captured["voice_name"] == "pt-BR-FranciscaNeural"
        assert captured["rate"] == persona_service.HOUSE_VOICE_STYLES["calm"]["rate"]
        assert captured["pitch"] == persona_service.HOUSE_VOICE_STYLES["calm"]["pitch"]
        persona_service._voice_sample_cache.clear()


class TestResolveHouseVoiceName:
    def test_house_id_resolves_to_video_language_voice(self):
        assert persona_service.resolve_house_voice_name("energetic", "pt") == "pt-BR-AntonioNeural"
        assert persona_service.resolve_house_voice_name("calm", "en") == "en-US-JennyNeural"
        assert persona_service.resolve_house_voice_name("young", "es") == "es-ES-XimenaNeural"

    def test_qualified_voice_name_passes_through(self):
        assert (
            persona_service.resolve_house_voice_name("pt-BR-FranciscaNeural", "pt")
            == "pt-BR-FranciscaNeural"
        )
        assert (
            persona_service.resolve_house_voice_name("en-US-GuyNeural", "pt")
            == "en-US-GuyNeural"
        )

    def test_unknown_language_falls_back_to_legacy_map(self):
        assert persona_service.resolve_house_voice_name("energetic", "xx") == "en-US-GuyNeural-Male"
        assert persona_service.resolve_house_voice_name("energetic", "") == "en-US-GuyNeural-Male"
