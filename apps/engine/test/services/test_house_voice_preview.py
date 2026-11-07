"""House voice preview synthesis (service-level tests).

The preview renders through voice.tts — the same path video jobs use —
so the tests pin the exact call (parsed voice name, rate 1.0, English,
caller user id) rather than only the returned bytes.
"""

import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from app.services import persona as persona_service
from app.services.cloned_voices.preview_text import PREVIEW_TEXT_INVALID_MESSAGE
from app.services.persona import VOICE_SAMPLE_TEXTS
from app.services.voice_providers import SubMaker, TtsResult


def _ok_tts(write_bytes: bytes = b"fake-mp3"):
    """A fake voice.tts that writes bytes and reports success."""

    def fake_tts(text, voice_name, voice_rate, voice_file, **kwargs):
        Path(voice_file).write_bytes(write_bytes)
        return TtsResult(sub_maker=SubMaker())

    return fake_tts


class PreviewHouseVoiceTests(unittest.TestCase):
    def test_custom_text_reaches_video_tts_path(self):
        with patch("app.services.persona.voice_service.tts", side_effect=_ok_tts()) as mock_tts:
            audio = persona_service.preview_house_voice_mp3(
                "user-1", "chatterbox:phonon_zoey", text="Hello world"
            )
        self.assertEqual(audio, b"fake-mp3")
        mock_tts.assert_called_once()
        call = mock_tts.call_args
        self.assertEqual(call.args[0], "Hello world")
        self.assertEqual(call.args[1], "chatterbox:phonon_zoey")
        self.assertEqual(call.args[2], 1.0)
        self.assertEqual(call.kwargs.get("language"), "en")
        self.assertEqual(call.kwargs.get("user_id"), "user-1")

    def test_bare_catalog_name_is_accepted(self):
        with patch("app.services.persona.voice_service.tts", side_effect=_ok_tts()) as mock_tts:
            persona_service.preview_house_voice_mp3("user-1", "kokoro_af_heart", text="Hello world")
        self.assertEqual(mock_tts.call_args.args[1], "kokoro_af_heart")

    def test_legacy_alias_resolves_to_catalog_voice(self):
        with patch("app.services.persona.voice_service.tts", side_effect=_ok_tts()) as mock_tts:
            persona_service.preview_house_voice_mp3(
                "user-1", "chatterbox:en_us_male_01", text="Hello world"
            )
        # The alias still renders under the caller's id: the TTS path, not
        # the catalog, owns the final name resolution.
        self.assertEqual(mock_tts.call_args.args[1], "chatterbox:en_us_male_01")

    def test_no_text_renders_fixed_english_sample(self):
        with patch("app.services.persona.voice_service.tts", side_effect=_ok_tts()) as mock_tts:
            persona_service.preview_house_voice_mp3("user-1", "chatterbox:phonon_zoey")
        self.assertEqual(mock_tts.call_args.args[0], VOICE_SAMPLE_TEXTS["en-us"])

    def test_custom_text_is_trimmed_not_truncated(self):
        with patch("app.services.persona.voice_service.tts", side_effect=_ok_tts()) as mock_tts:
            persona_service.preview_house_voice_mp3(
                "user-1", "chatterbox:phonon_zoey", text="  Hello world  "
            )
        self.assertEqual(mock_tts.call_args.args[0], "Hello world")

    def test_unknown_voice_is_404(self):
        for voice_id in (
            "chatterbox:no_such_voice",
            "no_such_voice",
            "openrouter:groq:eve",
            "elevenlabs:abc:Voice",
            "chatterbox_nano:u0123456789ab_0123456789ab",
            "no-voice",
        ):
            with self.subTest(voice_id=voice_id):
                with (
                    patch(
                        "app.services.persona.voice_service.tts",
                        side_effect=_ok_tts(),
                    ) as mock_tts,
                    self.assertRaises(persona_service.HouseVoicePreviewError) as ctx,
                ):
                    persona_service.preview_house_voice_mp3("user-1", voice_id, text="hi")
                self.assertEqual(ctx.exception.status_code, 404)
                self.assertEqual(ctx.exception.message, "voice not found")
                mock_tts.assert_not_called()

    def test_overlong_text_is_400_without_synthesis(self):
        with (
            patch("app.services.persona.voice_service.tts", side_effect=_ok_tts()) as mock_tts,
            self.assertRaises(persona_service.HouseVoicePreviewError) as ctx,
        ):
            persona_service.preview_house_voice_mp3(
                "user-1", "chatterbox:phonon_zoey", text="x" * 301
            )
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertEqual(ctx.exception.message, PREVIEW_TEXT_INVALID_MESSAGE)
        mock_tts.assert_not_called()

    def test_blank_text_is_400_without_synthesis(self):
        with (
            patch("app.services.persona.voice_service.tts", side_effect=_ok_tts()) as mock_tts,
            self.assertRaises(persona_service.HouseVoicePreviewError) as ctx,
        ):
            persona_service.preview_house_voice_mp3("user-1", "chatterbox:phonon_zoey", text="   ")
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertEqual(ctx.exception.message, PREVIEW_TEXT_INVALID_MESSAGE)
        mock_tts.assert_not_called()

    def test_tts_failure_is_502(self):
        def failing_tts(text, voice_name, voice_rate, voice_file, **kwargs):
            return TtsResult(error="local TTS server is down")

        with (
            patch("app.services.persona.voice_service.tts", side_effect=failing_tts),
            self.assertRaises(persona_service.HouseVoicePreviewError) as ctx,
        ):
            persona_service.preview_house_voice_mp3(
                "user-1", "chatterbox:phonon_zoey", text="Hello world"
            )
        self.assertEqual(ctx.exception.status_code, 502)
        self.assertEqual(ctx.exception.message, "voice preview failed")

    def test_empty_audio_is_502(self):
        with (
            patch("app.services.persona.voice_service.tts", side_effect=_ok_tts(b"")),
            self.assertRaises(persona_service.HouseVoicePreviewError) as ctx,
        ):
            persona_service.preview_house_voice_mp3(
                "user-1", "chatterbox:phonon_zoey", text="Hello world"
            )
        self.assertEqual(ctx.exception.status_code, 502)

    def test_custom_text_is_never_cached(self):
        with patch("app.services.persona.voice_service.tts", side_effect=_ok_tts()) as mock_tts:
            persona_service.preview_house_voice_mp3(
                "user-1", "chatterbox:phonon_zoey", text="Hello world"
            )
            persona_service.preview_house_voice_mp3(
                "user-1", "chatterbox:phonon_zoey", text="Hello world"
            )
        self.assertEqual(mock_tts.call_count, 2)
