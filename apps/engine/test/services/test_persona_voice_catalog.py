"""The UI voice catalog: local presets + configured OpenRouter + own clones.

`persona.get_house_voices` is what the picker renders. The local preset
catalog (Phonon + Kokoro) is always present with its filter metadata;
OpenRouter is a hosted provider whose voices are discovered per
configured model — an unconfigured OpenRouter contributes nothing, so
the picker never offers a voice the pipeline would reject at synthesis
time. A user's ready clones are appended only for that user.
"""

import unittest
from pathlib import Path
from unittest.mock import patch

from app.services import persona as persona_service
from app.services import voice_catalog
from app.services.voice_providers import TtsResult

OPENROUTER_VOICES = [
    "openrouter:x-ai/grok-voice-tts-1.0:eve",
    "openrouter:x-ai/grok-voice-tts-1.0:ara",
]
PRESET_ENTRIES = voice_catalog.catalog_entries()


class TestHouseVoiceCatalog(unittest.TestCase):
    def test_presets_are_always_present_with_metadata(self):
        with patch.object(persona_service, "get_openrouter_voices", return_value=[]):
            result = persona_service.get_house_voices()

        self.assertEqual(result, PRESET_ENTRIES)
        self.assertEqual(len(result), 65)
        easton = next(e for e in result if e["id"] == "phonon:Easton")
        self.assertEqual(easton["gender"], "male")
        self.assertEqual(easton["locale"], "en-US")

    def test_unconfigured_openrouter_is_absent_from_the_catalog(self):
        with patch.object(persona_service, "get_openrouter_voices", return_value=[]):
            result = persona_service.get_house_voices()

        self.assertFalse(any(e["id"].startswith("openrouter:") for e in result))

    def test_configured_openrouter_voices_are_appended(self):
        with patch.object(
            persona_service, "get_openrouter_voices", return_value=OPENROUTER_VOICES
        ):
            result = persona_service.get_house_voices()

        self.assertEqual(
            result, PRESET_ENTRIES + [{"id": voice} for voice in OPENROUTER_VOICES]
        )

    def test_cloned_voices_are_merged_when_user_id_provided(self):
        with patch.object(persona_service, "get_openrouter_voices", return_value=[]):
            with patch(
                "app.services.cloned_voices.service.list_catalog_entries",
                return_value=[{"id": "chatterbox:uabc_clone1"}],
            ) as mock_entries:
                result = persona_service.get_house_voices(user_id="user-1")

        mock_entries.assert_called_once_with("user-1")
        self.assertEqual(result, PRESET_ENTRIES + [{"id": "chatterbox:uabc_clone1"}])

    def test_catalog_degrades_to_presets_when_cloned_store_fails(self):
        """The cloned merge reads Supabase; its failure must not empty the picker."""
        with patch.object(persona_service, "get_openrouter_voices", return_value=[]):
            with patch(
                "app.services.cloned_voices.service.list_catalog_entries",
                side_effect=RuntimeError("SUPABASE_URL is required for cloned_voices"),
            ):
                result = persona_service.get_house_voices(user_id="user-1")

        self.assertEqual(result, PRESET_ENTRIES)

    def test_every_entry_is_a_provider_qualified_id(self):
        """The picker stores the id and `voice.tts` routes on the prefix, so an
        unprefixed id would reach the unknown-voice branch at synthesis time."""
        with patch.object(
            persona_service, "get_openrouter_voices", return_value=OPENROUTER_VOICES
        ):
            result = persona_service.get_house_voices()

        for entry in result:
            self.assertRegex(entry["id"], r"^(phonon|kokoro|elevenlabs|openrouter):")

    def test_a_failed_discovery_does_not_empty_the_catalog(self):
        """A models-API outage must degrade to the presets, not to an empty
        picker: an empty catalog looks like the operator has no voices at all,
        and the UI cannot tell "none configured" from "temporarily unreachable"."""
        from app.services import openrouter_tts as or_tts

        with patch.object(or_tts.config, "openrouter", {"api_key": "or-key", "models": ["x-ai/grok-voice-tts-1.0"]}):
            or_tts._openrouter_voice_cache.clear()
            with patch("app.services.openrouter_tts.requests.get") as mock_get:
                mock_get.side_effect = RuntimeError("boom")
                result = persona_service.get_house_voices()

        self.assertEqual(result, PRESET_ENTRIES)


class TestVoiceSample(unittest.TestCase):
    def setUp(self):
        persona_service._voice_sample_cache.clear()
        persona_service._voice_sample_failures.clear()

    def tearDown(self):
        persona_service._voice_sample_cache.clear()
        persona_service._voice_sample_failures.clear()

    def test_non_catalog_id_never_reaches_tts(self):
        # Paid providers (ElevenLabs/OpenRouter) must not be reachable
        # through the sample endpoint — catalog voices only.
        with patch.object(persona_service.voice_service, "tts") as tts:
            result = persona_service.get_voice_sample("elevenlabs:abc123")
        self.assertIsNone(result)
        tts.assert_not_called()

    def test_catalog_voice_synthesizes_and_caches(self):
        def fake_tts(text, voice_id, rate, path):
            Path(path).write_bytes(b"mp3-bytes")
            return TtsResult(sub_maker=object())

        with patch.object(persona_service.voice_service, "tts", side_effect=fake_tts) as tts:
            first = persona_service.get_voice_sample("phonon:Zoey")
            second = persona_service.get_voice_sample("phonon:Zoey")

        self.assertEqual(first, b"mp3-bytes")
        self.assertEqual(second, b"mp3-bytes")
        tts.assert_called_once()

    def test_failed_synthesis_returns_none(self):
        with patch.object(
            persona_service.voice_service,
            "tts",
            return_value=TtsResult(error="synthesis broke"),
        ):
            result = persona_service.get_voice_sample("kokoro:af_heart")
        self.assertIsNone(result)

    def test_failed_synthesis_is_negatively_cached_within_the_ttl(self):
        # A persistently broken provider (e.g. the Kokoro model download
        # failing) must not re-pay the load/download on every sample
        # request: the failure is cached for a short TTL.
        with patch.object(
            persona_service.voice_service,
            "tts",
            return_value=TtsResult(error="synthesis broke"),
        ) as tts:
            first = persona_service.get_voice_sample("kokoro:af_heart")
            second = persona_service.get_voice_sample("kokoro:af_heart")
        self.assertIsNone(first)
        self.assertIsNone(second)
        tts.assert_called_once()

    def test_failed_synthesis_retries_after_the_ttl(self):
        with patch.object(
            persona_service.voice_service,
            "tts",
            return_value=TtsResult(error="synthesis broke"),
        ) as tts:
            persona_service.get_voice_sample("kokoro:af_heart")
            key = ("kokoro:af_heart", "en-us")
            persona_service._voice_sample_failures[key] -= (
                persona_service._VOICE_SAMPLE_FAILURE_TTL_SECONDS + 1
            )
            persona_service.get_voice_sample("kokoro:af_heart")
        self.assertEqual(tts.call_count, 2)


if __name__ == "__main__":
    unittest.main()
