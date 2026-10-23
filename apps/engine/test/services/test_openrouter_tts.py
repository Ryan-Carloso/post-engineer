"""OpenRouter TTS provider.

OpenRouter exposes an OpenAI-compatible ``POST /api/v1/audio/speech``
endpoint, so this provider speaks the same request shape as Chatterbox but
against a hosted, multi-vendor catalog.

Three behaviours are pinned here because each one is a silent-failure class:

* the voice id carries BOTH the model and the voice, because OpenRouter voices
  are per-model (``alloy`` is an OpenAI voice, ``Kore`` is a Gemini one) and a
  voice name alone cannot address a model;
* ``speed`` is only sent when it differs from 1.0, because OpenRouter returns
  a 400 for a non-default speed on a model with no speed control;
* the voice catalog is discovered from the models API, scoped to the models
  the operator opted into — the full speech catalog is 35 models and ~824
  model/voice pairs, which no picker should ever render.
"""

import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

import requests

from app.services import openrouter_tts as vs

SPEECH_MODELS_RESPONSE = {
    "data": [
        {
            "id": "mistralai/voxtral-mini-tts-2603",
            "supported_voices": ["en_paul_sad", "en_paul_happy"],
        },
        {
            "id": "x-ai/grok-voice-tts-1.0",
            "supported_voices": ["eve", "ara"],
        },
        {
            # Voice cloning / prompt-driven models report no voice list. They
            # are still reachable by id, they just cannot fill the picker.
            "id": "fish-audio/s2-pro",
            "supported_voices": None,
        },
    ]
}


def _ok_post(content=b"fake-mp3-bytes"):
    response = MagicMock()
    response.status_code = 200
    response.content = content
    return response


def _clip(duration=3.0):
    clip = MagicMock()
    clip.duration = duration
    return clip


class TestOpenRouterVoiceId(unittest.TestCase):
    """The voice id must round-trip model + voice, since voices are per-model."""

    def test_is_openrouter_voice_matches_only_the_prefix(self):
        self.assertTrue(vs.is_openrouter_voice("openrouter:x-ai/grok-voice-tts-1.0:eve"))
        self.assertFalse(vs.is_openrouter_voice("chatterbox:en_us_male_01"))
        self.assertFalse(vs.is_openrouter_voice("elevenlabs:abc:Rachel"))
        self.assertFalse(vs.is_openrouter_voice(""))
        self.assertFalse(vs.is_openrouter_voice(None))

    def test_parse_splits_model_and_voice(self):
        self.assertEqual(
            vs.parse_openrouter_voice("openrouter:x-ai/grok-voice-tts-1.0:eve"),
            ("x-ai/grok-voice-tts-1.0", "eve"),
        )

    def test_azure_voices_keep_their_own_colon(self):
        """202 of the ~824 speech voices carry a colon of their own.

        Azure voice ids put the model in a suffix (`en-US-Harper:MAI-Voice-2.1`),
        so a last-colon split would read the model as `microsoft/mai-voice-2.1:
        en-US-Harper` and send a model id that does not exist.
        """
        self.assertEqual(
            vs.parse_openrouter_voice(
                "openrouter:microsoft/mai-voice-2.1:en-US-Harper:MAI-Voice-2.1"
            ),
            ("microsoft/mai-voice-2.1", "en-US-Harper:MAI-Voice-2.1"),
        )

    def test_an_azure_voice_round_trips_through_the_catalog(self):
        """The catalog emits and the parser reads the same id for a real voice."""
        voice_id = "openrouter:microsoft/mai-voice-2.1:en-US-Harper:MAI-Voice-2.1"
        self.assertEqual(
            vs.parse_openrouter_voice(voice_id),
            ("microsoft/mai-voice-2.1", "en-US-Harper:MAI-Voice-2.1"),
        )

    def test_parse_rejects_missing_voice(self):
        self.assertIsNone(vs.parse_openrouter_voice("openrouter:x-ai/grok-voice-tts-1.0"))
        self.assertIsNone(vs.parse_openrouter_voice("openrouter:x-ai/grok-voice-tts-1.0:"))
        self.assertIsNone(vs.parse_openrouter_voice("openrouter:"))

class TestOpenRouterVoiceCatalog(unittest.TestCase):
    """Discovery is dynamic, but scoped to the configured models."""

    def setUp(self):
        # The catalog is cached module-level keyed by configuration, so two
        # tests that share a config would otherwise share an answer and the
        # suite would depend on test order. Clearing the real dict keeps the
        # production cache honest — there is no test-only reset hook to bypass.
        vs._openrouter_voice_cache.clear()
        self.config = {"api_key": "or-key", "models": ["x-ai/grok-voice-tts-1.0"]}

    @patch("app.services.openrouter_tts.requests.get")
    def test_catalog_lists_voices_of_the_configured_models_only(self, mock_get):
        mock_get.return_value = MagicMock(status_code=200, json=lambda: SPEECH_MODELS_RESPONSE)
        with patch.object(vs.config, "openrouter", self.config):
            result = vs.get_openrouter_voices()
        self.assertEqual(result, ["openrouter:x-ai/grok-voice-tts-1.0:eve", "openrouter:x-ai/grok-voice-tts-1.0:ara"])

    @patch("app.services.openrouter_tts.requests.get")
    def test_catalog_covers_every_configured_model(self, mock_get):
        mock_get.return_value = MagicMock(status_code=200, json=lambda: SPEECH_MODELS_RESPONSE)
        config = {"api_key": "or-key", "models": ["x-ai/grok-voice-tts-1.0", "mistralai/voxtral-mini-tts-2603"]}
        with patch.object(vs.config, "openrouter", config):
            result = vs.get_openrouter_voices()
        self.assertEqual(len(result), 4)
        self.assertIn("openrouter:mistralai/voxtral-mini-tts-2603:en_paul_sad", result)
        self.assertIn("openrouter:x-ai/grok-voice-tts-1.0:eve", result)

    @patch("app.services.openrouter_tts.requests.get")
    def test_catalog_skips_models_that_report_no_voices(self, mock_get):
        mock_get.return_value = MagicMock(status_code=200, json=lambda: SPEECH_MODELS_RESPONSE)
        config = {"api_key": "or-key", "models": ["fish-audio/s2-pro", "x-ai/grok-voice-tts-1.0"]}
        with patch.object(vs.config, "openrouter", config):
            result = vs.get_openrouter_voices()
        self.assertEqual(result, ["openrouter:x-ai/grok-voice-tts-1.0:eve", "openrouter:x-ai/grok-voice-tts-1.0:ara"])

    @patch("app.services.openrouter_tts.requests.get")
    def test_catalog_warns_when_a_configured_model_is_absent(self, mock_get):
        """A typo'd model id must not silently yield an empty picker."""
        mock_get.return_value = MagicMock(status_code=200, json=lambda: SPEECH_MODELS_RESPONSE)
        config = {"api_key": "or-key", "models": ["xai/grok-voice-tts-1.0"]}
        with patch.object(vs.config, "openrouter", config):
            result = vs.get_openrouter_voices()
        self.assertEqual(result, [])

    def test_catalog_is_empty_without_an_api_key(self):
        """Unconfigured means absent from the picker, not an anonymous call."""
        with patch.object(vs.config, "openrouter", {"api_key": "", "models": ["x-ai/grok-voice-tts-1.0"]}):
            with patch("app.services.openrouter_tts.requests.get") as mock_get:
                self.assertEqual(vs.get_openrouter_voices(), [])
        mock_get.assert_not_called()

    def test_catalog_is_empty_without_configured_models(self):
        with patch.object(vs.config, "openrouter", {"api_key": "or-key", "models": []}):
            with patch("app.services.openrouter_tts.requests.get") as mock_get:
                self.assertEqual(vs.get_openrouter_voices(), [])
        mock_get.assert_not_called()

    @patch("app.services.openrouter_tts.requests.get")
    def test_catalog_accepts_a_comma_separated_model_string(self, mock_get):
        mock_get.return_value = MagicMock(status_code=200, json=lambda: SPEECH_MODELS_RESPONSE)
        config = {"api_key": "or-key", "models": "x-ai/grok-voice-tts-1.0 , "}
        with patch.object(vs.config, "openrouter", config):
            result = vs.get_openrouter_voices()
        self.assertEqual(result, ["openrouter:x-ai/grok-voice-tts-1.0:eve", "openrouter:x-ai/grok-voice-tts-1.0:ara"])

    @patch("app.services.openrouter_tts.requests.get")
    def test_catalog_is_fetched_once_per_configuration(self, mock_get):
        """The picker is read on every page load; the models API is not free."""
        mock_get.return_value = MagicMock(status_code=200, json=lambda: SPEECH_MODELS_RESPONSE)
        with patch.object(vs.config, "openrouter", self.config):
            first = vs.get_openrouter_voices()
            second = vs.get_openrouter_voices()
        self.assertEqual(first, second)
        mock_get.assert_called_once()

    @patch("app.services.openrouter_tts.requests.get")
    def test_a_different_model_list_refetches(self, mock_get):
        """The cache is keyed by configuration, so it needs no test-only reset."""
        mock_get.return_value = MagicMock(status_code=200, json=lambda: SPEECH_MODELS_RESPONSE)
        with patch.object(vs.config, "openrouter", self.config):
            vs.get_openrouter_voices()
            with patch.object(vs.config, "openrouter", {"api_key": "or-key", "models": ["mistralai/voxtral-mini-tts-2603"]}):
                result = vs.get_openrouter_voices()
        self.assertEqual(result, ["openrouter:mistralai/voxtral-mini-tts-2603:en_paul_sad", "openrouter:mistralai/voxtral-mini-tts-2603:en_paul_happy"])
        self.assertEqual(mock_get.call_count, 2)

    @patch("app.services.openrouter_tts.requests.get")
    def test_http_failure_degrades_to_no_catalog(self, mock_get):
        mock_get.return_value = MagicMock(status_code=401, text="Unauthorized")
        with patch.object(vs.config, "openrouter", self.config):
            self.assertEqual(vs.get_openrouter_voices(), [])

    @patch("app.services.openrouter_tts.requests.get")
    def test_network_failure_degrades_to_no_catalog(self, mock_get):
        mock_get.side_effect = requests.exceptions.ConnectionError("timeout")
        with patch.object(vs.config, "openrouter", self.config):
            self.assertEqual(vs.get_openrouter_voices(), [])

    @patch("app.services.openrouter_tts.requests.get")
    def test_malformed_entries_are_narrowed_not_fatal(self, mock_get):
        """A bad entry must not discard the real voices beside it."""
        payload = {
            "data": [
                {"id": "x-ai/grok-voice-tts-1.0", "supported_voices": ["eve", 7, None, "  ", "ara"]},
                {"supported_voices": ["orphan"]},
                "not-a-model",
            ]
        }
        mock_get.return_value = MagicMock(status_code=200, json=lambda: payload)
        with patch.object(vs.config, "openrouter", self.config):
            result = vs.get_openrouter_voices()
        self.assertEqual(result, ["openrouter:x-ai/grok-voice-tts-1.0:eve", "openrouter:x-ai/grok-voice-tts-1.0:ara"])

    @patch("app.services.openrouter_tts.requests.get")
    def test_duplicate_voices_are_collapsed(self, mock_get):
        mock_get.return_value = MagicMock(
            status_code=200,
            json=lambda: {"data": [{"id": "x-ai/grok-voice-tts-1.0", "supported_voices": ["eve", "eve", "ara"]}]},
        )
        with patch.object(vs.config, "openrouter", self.config):
            result = vs.get_openrouter_voices()
        self.assertEqual(result, ["openrouter:x-ai/grok-voice-tts-1.0:eve", "openrouter:x-ai/grok-voice-tts-1.0:ara"])

    @patch("app.services.openrouter_tts.requests.get")
    def test_the_speech_filter_is_sent(self, mock_get):
        """Without output_modalities=speech the payload is every OpenRouter model."""
        mock_get.return_value = MagicMock(status_code=200, json=lambda: SPEECH_MODELS_RESPONSE)
        with patch.object(vs.config, "openrouter", self.config):
            vs.get_openrouter_voices()
        self.assertEqual(
            mock_get.call_args.kwargs["params"], {"output_modalities": "speech"}
        )


class TestOpenRouterTts(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.voice_file = str(Path(self.tmp) / "openrouter.mp3")
        self.config = {"api_key": "or-key", "models": []}

    def test_posts_to_the_openai_compatible_speech_endpoint(self):
        with patch.object(vs.config, "openrouter", self.config):
            with patch("app.services.openrouter_tts.requests.post", return_value=_ok_post()) as mock_post:
                with patch("app.services.openrouter_tts.AudioFileClip", return_value=_clip()):
                    result = vs.openrouter_tts(
                        "Hello world", "x-ai/grok-voice-tts-1.0", "eve", self.voice_file
                    )

        self.assertIsNone(result.error)
        self.assertTrue(result.sub_maker.subs)
        call = mock_post.call_args
        self.assertEqual(call.args[0], "https://openrouter.ai/api/v1/audio/speech")
        self.assertEqual(call.kwargs["headers"]["Authorization"], "Bearer or-key")
        self.assertEqual(call.kwargs["json"]["model"], "x-ai/grok-voice-tts-1.0")
        self.assertEqual(call.kwargs["json"]["voice"], "eve")
        self.assertEqual(call.kwargs["json"]["input"], "Hello world")
        self.assertEqual(call.kwargs["json"]["response_format"], "mp3")
        with open(self.voice_file, "rb") as handle:
            self.assertEqual(handle.read(), b"fake-mp3-bytes")

    def test_default_rate_does_not_send_speed(self):
        """OpenRouter 400s a non-default speed on a model with no speed control.

        Every speech model reports an empty `supported_parameters`, so there is
        no way to know which ones honour `speed`. Sending it only when the user
        actually asked for a different rate keeps the default path working.
        """
        with patch.object(vs.config, "openrouter", self.config):
            with patch("app.services.openrouter_tts.requests.post", return_value=_ok_post()) as mock_post:
                with patch("app.services.openrouter_tts.AudioFileClip", return_value=_clip()):
                    vs.openrouter_tts("Hello", "m/v", "eve", self.voice_file, voice_rate=1.0)

        self.assertNotIn("speed", mock_post.call_args.kwargs["json"])

    def test_a_non_default_rate_sends_speed(self):
        with patch.object(vs.config, "openrouter", self.config):
            with patch("app.services.openrouter_tts.requests.post", return_value=_ok_post()) as mock_post:
                with patch("app.services.openrouter_tts.AudioFileClip", return_value=_clip()):
                    vs.openrouter_tts("Hello", "m/v", "eve", self.voice_file, voice_rate=1.4)

        self.assertEqual(mock_post.call_args.kwargs["json"]["speed"], 1.4)

    def test_missing_api_key_fails_loud_without_calling_out(self):
        with patch.object(vs.config, "openrouter", {"api_key": "", "models": []}):
            with patch("app.services.openrouter_tts.requests.post") as mock_post:
                result = vs.openrouter_tts("Hello", "m/v", "eve", self.voice_file)

        self.assertIsNone(result.sub_maker)
        self.assertIn("API key", result.error or "")
        mock_post.assert_not_called()

    def test_empty_text_is_rejected_before_spending(self):
        with patch.object(vs.config, "openrouter", self.config):
            with patch("app.services.openrouter_tts.requests.post") as mock_post:
                result = vs.openrouter_tts("   ", "m/v", "eve", self.voice_file)

        self.assertIsNone(result.sub_maker)
        self.assertIn("empty", result.error or "")
        mock_post.assert_not_called()

    def test_a_rejected_voice_does_not_retry(self):
        """A 400 is the model refusing the voice. Retrying spends three times
        the tokens to reach the same answer, and the user still cannot pick it."""
        error = MagicMock(status_code=400, text='{"error":{"message":"voice not supported"}}')
        with patch.object(vs.config, "openrouter", self.config):
            with patch("app.services.openrouter_tts.requests.post", return_value=error) as mock_post:
                result = vs.openrouter_tts("Hello", "m/v", "nope", self.voice_file)

        self.assertEqual(mock_post.call_count, 1)
        self.assertIn("400", result.error or "")

    def test_auth_and_not_found_also_do_not_retry(self):
        for status in (401, 403, 404, 422):
            with self.subTest(status=status):
                error = MagicMock(status_code=status, text="denied")
                with patch.object(vs.config, "openrouter", self.config):
                    with patch("app.services.openrouter_tts.requests.post", return_value=error) as mock_post:
                        result = vs.openrouter_tts("Hello", "m/v", "eve", self.voice_file)
                self.assertEqual(mock_post.call_count, 1)
                self.assertIsNone(result.sub_maker)

    def test_a_throttled_request_is_retried(self):
        throttled = MagicMock(status_code=429, text="slow down")
        ok = _ok_post()
        with patch.object(vs.config, "openrouter", self.config):
            with patch(
                "app.services.openrouter_tts.requests.post",
                side_effect=[throttled, ok],
            ) as mock_post:
                with patch("app.services.openrouter_tts.AudioFileClip", return_value=_clip()):
                    result = vs.openrouter_tts("Hello", "m/v", "eve", self.voice_file)

        self.assertEqual(mock_post.call_count, 2)
        self.assertIsNone(result.error)

    def test_exhausted_retries_report_the_last_status(self):
        failing = MagicMock(status_code=503, text="upstream down")
        with patch.object(vs.config, "openrouter", self.config):
            with patch("app.services.openrouter_tts.requests.post", return_value=failing) as mock_post:
                result = vs.openrouter_tts("Hello", "m/v", "eve", self.voice_file)

        self.assertEqual(mock_post.call_count, 3)
        self.assertIn("503", result.error or "")

    def test_the_error_body_is_scrubbed(self):
        """An upstream body can echo the bearer token back at us, and this
        string reaches the task error, the logs and PostHog."""
        error = MagicMock(
            status_code=401,
            text='{"error":"bad key sk-or-v1-abcdefghijklmnopqrstuvwxyz012345"}',
        )
        with patch.object(vs.config, "openrouter", self.config):
            with patch("app.services.openrouter_tts.requests.post", return_value=error):
                result = vs.openrouter_tts("Hello", "m/v", "eve", self.voice_file)

        self.assertNotIn("abcdefghijklmnopqrstuvwxyz012345", result.error or "")

    def test_the_error_body_is_scrubbed_before_the_cut(self):
        """Scrub-then-truncate. A cut landing mid-secret defeats the scrubber
        and leaks the remainder; the probe must therefore exceed the cut."""
        from app.services import analytics

        secret = "sk-or-v1-" + "z" * 260
        error = MagicMock(status_code=401, text='{"error":"rejected ' + secret + '"}')
        with patch.object(vs.config, "openrouter", self.config):
            with patch("app.services.openrouter_tts.requests.post", return_value=error):
                spy = MagicMock(wraps=analytics.scrub_secret_values)
                with patch("app.services.openrouter_tts.scrub_secret_values", spy):
                    result = vs.openrouter_tts("Hello", "m/v", "eve", self.voice_file)

        scrubbed_inputs = [call.args[0] for call in spy.call_args_list]
        self.assertTrue(
            any(secret in body for body in scrubbed_inputs),
            "the scrubber must receive the whole body, not the 200-char cut: "
            f"{scrubbed_inputs}",
        )
        self.assertNotIn(secret, result.error or "")


class TestOpenRouterDispatch(unittest.TestCase):
    """`dispatch_openrouter_tts` routes the new id and rejects a malformed one
    loudly; `voice.tts` delegates to it with a single call."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.voice_file = str(Path(self.tmp) / "v.mp3")

    def test_dispatch_routes_an_openrouter_voice_to_the_provider(self):
        sentinel = vs.TtsResult(sub_maker=vs.SubMaker())
        with patch.object(vs, "openrouter_tts", return_value=sentinel) as mock_tts:
            result = vs.dispatch_openrouter_tts(
                "openrouter:x-ai/grok-voice-tts-1.0:eve", "Hello", self.voice_file, 1.0
            )
        self.assertIs(result, sentinel)
        mock_tts.assert_called_once()
        self.assertEqual(mock_tts.call_args.args[1], "x-ai/grok-voice-tts-1.0")
        self.assertEqual(mock_tts.call_args.args[2], "eve")

    def test_dispatch_rejects_a_malformed_openrouter_voice(self):
        with patch.object(vs, "openrouter_tts") as mock_tts:
            result = vs.dispatch_openrouter_tts(
                "openrouter:x-ai/grok-voice-tts-1.0", "Hello", self.voice_file, 1.0
            )
        mock_tts.assert_not_called()
        self.assertIsNone(result.sub_maker)
        self.assertIn("openrouter:<model>:<voice>", result.error or "")

    def test_dispatch_ignores_other_providers(self):
        self.assertIsNone(
            vs.dispatch_openrouter_tts("chatterbox:en_us_male_01", "Hello", self.voice_file, 1.0)
        )
        self.assertIsNone(
            vs.dispatch_openrouter_tts(None, "Hello", self.voice_file, 1.0)
        )

    def test_voice_tts_delegates_to_the_dispatcher(self):
        """voice.tts stays thin: the openrouter branch is a single call."""
        from app.services import voice as voice_service

        sentinel = vs.TtsResult(sub_maker=vs.SubMaker())
        with patch.object(
            voice_service, "dispatch_openrouter_tts", return_value=sentinel
        ) as mock_dispatch:
            result = voice_service.tts(
                "Hello", "openrouter:x-ai/grok-voice-tts-1.0:eve", 1.0, self.voice_file
            )
        self.assertIs(result, sentinel)
        mock_dispatch.assert_called_once()

    def test_an_unknown_voice_error_lists_the_openrouter_prefix(self):
        """The error is the operator's only clue about the id format."""
        from app.services import voice as voice_service

        result = voice_service.tts("Hello", "totally-unknown", 1.0, self.voice_file)
        self.assertIn("openrouter:<model>:<voice>", result.error or "")


if __name__ == "__main__":
    unittest.main()