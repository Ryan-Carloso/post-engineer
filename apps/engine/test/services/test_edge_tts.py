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


class TestEdgeTts(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.voice_file = str(Path(self.tmp.name) / "audio.mp3")

    def tearDown(self):
        self.tmp.cleanup()

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


class TestChatterboxFallback(unittest.TestCase):
    """voice.tts falls back to Edge TTS for test accounts on Chatterbox failure."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.voice_file = str(Path(self.tmp.name) / "audio.mp3")

    def tearDown(self):
        self.tmp.cleanup()

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
                "chatterbox:ryan",
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
                "chatterbox:ryan",
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
                    "chatterbox:ryan",
                    1.0,
                    self.voice_file,
                    user_id="user-123",
                )
        self.assertIs(result, ok_result)
        mock_fallback.assert_not_called()


class TestMaybeFallback(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.voice_file = str(Path(self.tmp.name) / "audio.mp3")

    def tearDown(self):
        self.tmp.cleanup()

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


if __name__ == "__main__":
    unittest.main()
