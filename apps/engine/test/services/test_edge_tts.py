"""Edge TTS fallback provider.

Edge TTS is the free fallback used when Chatterbox (Modal) fails, for test
accounts only. Pinned behaviours:

* ``is_test_account`` reads TEST_ACCOUNT_USER_IDS (comma-separated), never
  hardcoded IDs;
* the fallback only triggers for test accounts — production keeps the loud
  Chatterbox failure;
* a ``tts_fallback_used`` PostHog event fires on every fallback (ids and
  reason only, never audio text);
* when Edge TTS also fails, the Edge error is returned (not the original).
"""

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from app.services import edge_tts as et
from app.services import voice as voice_service
from app.services.voice_providers import TtsResult


def _clip(duration=3.0):
    clip = MagicMock()
    clip.duration = duration
    return clip


class TestIsTestAccount(unittest.TestCase):
    def test_matches_id_in_comma_separated_list(self):
        with patch.dict(os.environ, {"TEST_ACCOUNT_USER_IDS": "aaa,bbb, ccc "}):
            self.assertTrue(et.is_test_account("bbb"))
            self.assertTrue(et.is_test_account("ccc"))

    def test_rejects_unknown_id(self):
        with patch.dict(os.environ, {"TEST_ACCOUNT_USER_IDS": "aaa,bbb"}):
            self.assertFalse(et.is_test_account("zzz"))

    def test_empty_env_means_nobody_is_test(self):
        with patch.dict(os.environ, {"TEST_ACCOUNT_USER_IDS": ""}):
            self.assertFalse(et.is_test_account("aaa"))

    def test_missing_env_means_nobody_is_test(self):
        with patch.dict(os.environ, {}, clear=True):
            # keep MUTANT_UNDER_TEST for the mutmut trampoline (see AGENTS.md)
            if "MUTANT_UNDER_TEST" in os.environ:
                pass
            self.assertFalse(et.is_test_account("aaa"))

    def test_empty_user_id_is_never_test(self):
        with patch.dict(os.environ, {"TEST_ACCOUNT_USER_IDS": "aaa"}):
            self.assertFalse(et.is_test_account(""))
            self.assertFalse(et.is_test_account(None))


class _VoiceFileTestCase(unittest.TestCase):
    """Shared fixture: an isolated tmp dir holding the voice-file path."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.voice_file = str(Path(self.tmp.name) / "audio.mp3")

    def tearDown(self):
        self.tmp.cleanup()

class TestEdgeTts(_VoiceFileTestCase):
    def test_empty_text_fails_fast(self):
        result = et.edge_tts("", self.voice_file)
        self.assertFalse(result.ok)
        self.assertIn("empty", result.error)

    @patch("app.services.edge_tts._run_edge_tts")
    @patch("app.services.edge_tts.AudioFileClip")
    def test_success_returns_sub_maker(self, mock_clip_cls, mock_run):
        mock_clip_cls.return_value = _clip(4.5)
        result = et.edge_tts("hello world", self.voice_file)
        self.assertTrue(result.ok)
        self.assertIsNotNone(result.sub_maker)
        mock_run.assert_called_once()

    @patch("app.services.edge_tts._run_edge_tts", side_effect=RuntimeError("no network"))
    def test_network_failure_returns_error(self, _mock_run):
        result = et.edge_tts("hello world", self.voice_file)
        self.assertFalse(result.ok)
        self.assertIn("Edge TTS failed", result.error)

    @patch("app.services.edge_tts._run_edge_tts")
    @patch("app.services.edge_tts.AudioFileClip")
    def test_voice_comes_from_env(self, mock_clip_cls, mock_run):
        mock_clip_cls.return_value = _clip(2.0)
        with patch.dict(os.environ, {"EDGE_TTS_VOICE": "en-US-AriaNeural"}):
            et.edge_tts("hi", self.voice_file)
        _text, voice, _path = mock_run.call_args[0]
        self.assertEqual(voice, "en-US-AriaNeural")

    @patch("app.services.edge_tts._run_edge_tts")
    @patch("app.services.edge_tts.AudioFileClip")
    def test_default_voice_is_brazilian_portuguese(self, mock_clip_cls, mock_run):
        mock_clip_cls.return_value = _clip(2.0)
        with patch.dict(os.environ, {}, clear=True):
            et.edge_tts("oi", self.voice_file)
        _text, voice, _path = mock_run.call_args[0]
        self.assertEqual(voice, et.DEFAULT_EDGE_TTS_VOICE)


class TestChatterboxFallback(_VoiceFileTestCase):
    """voice.tts falls back to Edge TTS for test accounts on Chatterbox failure."""

    def _chatterbox_fails(self):
        return TtsResult(error="Chatterbox TTS failed after 3 attempts (status 404)")

    @patch("app.services.edge_tts.maybe_fallback_to_edge_tts")
    @patch("app.services.edge_tts.chatterbox_tts")
    def test_test_account_falls_back_on_chatterbox_failure(
        self, mock_chatterbox, mock_fallback
    ):
        mock_chatterbox.return_value = self._chatterbox_fails()
        fallback_result = TtsResult(sub_maker=MagicMock())
        mock_fallback.return_value = fallback_result
        with patch.dict(os.environ, {"TEST_ACCOUNT_USER_IDS": "user-123"}):
            result = voice_service.tts(
                "hello",
                "chatterbox:en_us_male_01",
                1.0,
                self.voice_file,
                user_id="user-123",
                task_id="task-1",
            )
        self.assertIs(result, fallback_result)
        mock_fallback.assert_called_once()

    @patch("app.services.edge_tts.maybe_fallback_to_edge_tts")
    @patch("app.services.edge_tts.chatterbox_tts")
    def test_production_account_keeps_original_error(
        self, mock_chatterbox, mock_fallback
    ):
        original = self._chatterbox_fails()
        mock_chatterbox.return_value = original
        mock_fallback.return_value = None  # not a test account
        with patch.dict(os.environ, {"TEST_ACCOUNT_USER_IDS": "user-123"}):
            result = voice_service.tts(
                "hello",
                "chatterbox:en_us_male_01",
                1.0,
                self.voice_file,
                user_id="someone-else",
                task_id="task-1",
            )
        self.assertIs(result, original)

    @patch("app.services.edge_tts.chatterbox_tts")
    def test_chatterbox_success_never_falls_back(self, mock_chatterbox):
        ok_result = TtsResult(sub_maker=MagicMock())
        mock_chatterbox.return_value = ok_result
        with patch.dict(os.environ, {"TEST_ACCOUNT_USER_IDS": "user-123"}):
            with patch(
                "app.services.edge_tts.maybe_fallback_to_edge_tts"
            ) as mock_fallback:
                result = voice_service.tts(
                    "hello",
                    "chatterbox:en_us_male_01",
                    1.0,
                    self.voice_file,
                    user_id="user-123",
                )
        self.assertIs(result, ok_result)
        mock_fallback.assert_not_called()


class TestMaybeFallback(_VoiceFileTestCase):
    @patch("app.services.edge_tts.track_event")
    @patch("app.services.edge_tts.edge_tts")
    def test_emits_posthog_event_with_ids_only(self, mock_edge, mock_track):
        mock_edge.return_value = TtsResult(sub_maker=MagicMock())
        with patch.dict(os.environ, {"TEST_ACCOUNT_USER_IDS": "user-123"}):
            et.maybe_fallback_to_edge_tts(
                "Chatterbox TTS failed after 3 attempts (status 404)",
                text="secret script text",
                voice_file=self.voice_file,
                voice_rate=1.0,
                user_id="user-123",
                task_id="task-9",
            )
        mock_track.assert_called_once()
        event_name, props = mock_track.call_args[0][0], mock_track.call_args[0][1]
        self.assertEqual(event_name, "tts_fallback_used")
        self.assertEqual(props["from_provider"], "chatterbox")
        self.assertEqual(props["to_provider"], "edge_tts")
        self.assertEqual(props["user_id"], "user-123")
        self.assertEqual(props["task_id"], "task-9")
        # Never leak audio text into analytics.
        self.assertNotIn("secret script text", str(props))

    @patch("app.services.edge_tts.track_event")
    @patch("app.services.edge_tts.edge_tts")
    def test_scrubs_reason_before_sending_to_posthog(self, mock_edge, mock_track):
        mock_edge.return_value = TtsResult(sub_maker=MagicMock())
        with patch.dict(os.environ, {"TEST_ACCOUNT_USER_IDS": "user-123"}):
            et.maybe_fallback_to_edge_tts(
                "failed: api_key=TOPSECRET123 at "
                "/home/operator/voices/clone.wav\n"
                + "x" * 300
                + " api_key=TOPSECRET999",
                text="hello",
                voice_file=self.voice_file,
                voice_rate=1.0,
                user_id="user-123",
                task_id="task-9",
            )
        props = mock_track.call_args[0][1]
        self.assertIn("[redacted]", props["reason"])
        self.assertNotIn("TOPSECRET123", props["reason"])
        self.assertNotIn("TOPSECRET999", props["reason"])
        self.assertNotIn("/home/operator", props["reason"])
        # The fixture error is >300 chars, so the 200-char cap must bite:
        # scrub_error_text keeps first line + diagnostic tail at exactly 200.
        self.assertEqual(len(str(props["reason"])), 200)

    @patch("app.services.edge_tts.edge_tts")
    def test_returns_none_for_non_test_account(self, mock_edge):
        with patch.dict(os.environ, {"TEST_ACCOUNT_USER_IDS": "user-123"}):
            result = et.maybe_fallback_to_edge_tts(
                "boom",
                text="hi",
                voice_file=self.voice_file,
                voice_rate=1.0,
                user_id="prod-user",
            )
        self.assertIsNone(result)
        mock_edge.assert_not_called()


class TestEdgeTtsVoiceLanguage(_VoiceFileTestCase):
    """The Edge voice follows the video language, never a fixed PT voice.

    Regression: a test flight generated an English video but the fallback
    read it with the hardcoded pt-BR voice, because the voice came only
    from EDGE_TTS_VOICE / the pt-BR default and the job's language never
    reached the fallback.
    """

    def _voice_used(self, language=None, env=None):
        isolated = dict(env or {})
        # Keep MUTANT_UNDER_TEST for the mutmut trampoline (see AGENTS.md).
        if "MUTANT_UNDER_TEST" in os.environ:
            isolated["MUTANT_UNDER_TEST"] = os.environ["MUTANT_UNDER_TEST"]
        with patch("app.services.edge_tts._run_edge_tts") as mock_run:
            with patch("app.services.edge_tts.AudioFileClip") as mock_clip:
                mock_clip.return_value = _clip(2.0)
                with patch.dict(os.environ, isolated, clear=True):
                    et.edge_tts("hello world", self.voice_file, language=language)
        return mock_run.call_args[0][1]

    def test_english_uses_us_english_voice(self):
        self.assertEqual(self._voice_used(language="en"), "en-US-AriaNeural")
        self.assertEqual(self._voice_used(language="en-US"), "en-US-AriaNeural")

    def test_british_english_uses_gb_voice(self):
        self.assertEqual(self._voice_used(language="en-GB"), "en-GB-SoniaNeural")

    def test_portuguese_variants_keep_portuguese_voices(self):
        self.assertEqual(self._voice_used(language="pt"), "pt-BR-FranciscaNeural")
        self.assertEqual(self._voice_used(language="pt-BR"), "pt-BR-FranciscaNeural")
        self.assertEqual(self._voice_used(language="pt-PT"), "pt-PT-RaquelNeural")

    def test_other_supported_languages(self):
        self.assertEqual(self._voice_used(language="es"), "es-ES-ElviraNeural")
        self.assertEqual(self._voice_used(language="fr"), "fr-FR-DeniseNeural")
        self.assertEqual(self._voice_used(language="de"), "de-DE-KatjaNeural")
        self.assertEqual(self._voice_used(language="it"), "it-IT-ElsaNeural")
        self.assertEqual(self._voice_used(language="hi"), "hi-IN-SwaraNeural")

    def test_native_script_language_names(self):
        self.assertEqual(self._voice_used(language="Русский"), "ru-RU-SvetlanaNeural")
        self.assertEqual(self._voice_used(language="中文"), "zh-CN-XiaoxiaoNeural")
        self.assertEqual(self._voice_used(language="日本語"), "ja-JP-NanamiNeural")
        self.assertEqual(self._voice_used(language="한국어"), "ko-KR-SunHiNeural")
        self.assertEqual(self._voice_used(language="हिन्दी"), "hi-IN-SwaraNeural")

    def test_language_name_and_case_are_normalized(self):
        self.assertEqual(self._voice_used(language="English"), "en-US-AriaNeural")
        self.assertEqual(self._voice_used(language="EN_us"), "en-US-AriaNeural")

    def test_language_wins_over_env_voice(self):
        # A deployment-wide EDGE_TTS_VOICE pin must not reintroduce the bug:
        # an English video read by a Portuguese voice.
        env = {"EDGE_TTS_VOICE": "pt-BR-FranciscaNeural"}
        self.assertEqual(self._voice_used(language="en", env=env), "en-US-AriaNeural")

    def test_unknown_language_falls_back_to_env_voice(self):
        env = {"EDGE_TTS_VOICE": "en-US-AriaNeural"}
        self.assertEqual(self._voice_used(language="xx", env=env), "en-US-AriaNeural")

    def test_no_language_keeps_env_then_default(self):
        env = {"EDGE_TTS_VOICE": "fr-FR-DeniseNeural"}
        self.assertEqual(self._voice_used(env=env), "fr-FR-DeniseNeural")
        self.assertEqual(self._voice_used(), et.DEFAULT_EDGE_TTS_VOICE)


class TestFallbackLanguageForwarding(_VoiceFileTestCase):
    @patch("app.services.edge_tts.track_event")
    @patch("app.services.edge_tts.edge_tts")
    def test_maybe_fallback_forwards_language(self, mock_edge, mock_track):
        mock_edge.return_value = TtsResult(sub_maker=MagicMock())
        with patch.dict(os.environ, {"TEST_ACCOUNT_USER_IDS": "user-123"}):
            et.maybe_fallback_to_edge_tts(
                "boom",
                text="hello",
                voice_file=self.voice_file,
                voice_rate=1.0,
                user_id="user-123",
                task_id="task-9",
                language="en",
            )
        self.assertEqual(mock_edge.call_args.kwargs.get("language"), "en")
        props = mock_track.call_args[0][1]
        self.assertEqual(props["language"], "en")
        self.assertEqual(props["voice"], "en-US-AriaNeural")

    @patch("app.services.edge_tts.maybe_fallback_to_edge_tts")
    @patch("app.services.edge_tts.chatterbox_tts")
    def test_wrapper_forwards_language(self, mock_chatterbox, mock_fallback):
        mock_chatterbox.return_value = TtsResult(error="status 404")
        mock_fallback.return_value = TtsResult(sub_maker=MagicMock())
        et.chatterbox_tts_with_fallback(
            "hello", "en_us_male_01", self.voice_file, user_id="u1", language="en"
        )
        self.assertEqual(mock_fallback.call_args.kwargs.get("language"), "en")

    @patch("app.services.voice.chatterbox_tts_with_fallback")
    def test_voice_tts_forwards_language(self, mock_fallback):
        mock_fallback.return_value = TtsResult(sub_maker=MagicMock())
        voice_service.tts(
            "hello",
            "chatterbox:en_us_male_01",
            1.0,
            self.voice_file,
            user_id="u1",
            language="en",
        )
        self.assertEqual(mock_fallback.call_args.kwargs.get("language"), "en")

    @patch("app.services.edge_tts.chatterbox_tts")
    def test_chatterbox_clone_denied_before_tts_call(self, mock_chatterbox):
        other = "ffffffff-bbbb-cccc-dddd-eeeeeeeeeeee"
        clone_key = "uaaaaaaaabbbb_cccccccccccc"
        result = et.chatterbox_tts_with_fallback(
            "hello",
            clone_key,
            self.voice_file,
            user_id=other,
        )
        mock_chatterbox.assert_not_called()
        self.assertIn("cloned voice is not available", result.error or "")

    @patch("app.services.edge_tts.chatterbox_tts")
    def test_chatterbox_clone_allowed_for_owner_calls_tts(self, mock_chatterbox):
        owner = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
        clone_key = "uaaaaaaaabbbb_cccccccccccc"
        mock_chatterbox.return_value = TtsResult(sub_maker=MagicMock())
        et.chatterbox_tts_with_fallback(
            "hello",
            clone_key,
            self.voice_file,
            user_id=owner,
        )
        mock_chatterbox.assert_called_once()


if __name__ == "__main__":
    unittest.main()
