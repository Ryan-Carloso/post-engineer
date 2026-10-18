"""The UI voice catalog must show OpenRouter only once it is configured.

`persona.get_house_voices` is what the picker renders. Chatterbox voices are
always present (self-hosted, no credential to check); OpenRouter is a hosted
provider whose voices are discovered per configured model. The invariant this
file pins: an unconfigured OpenRouter contributes nothing to the catalog, so
the picker never offers a voice the pipeline would reject at synthesis time.
"""

import unittest
from unittest.mock import patch

from app.services import persona as persona_service

CHATTERBOX_VOICES = ["chatterbox:ryan", "chatterbox:en_us_female_01"]
OPENROUTER_VOICES = [
    "openrouter:x-ai/grok-voice-tts-1.0:eve",
    "openrouter:x-ai/grok-voice-tts-1.0:ara",
]


class TestHouseVoiceCatalog(unittest.TestCase):
    def test_unconfigured_openrouter_is_absent_from_the_catalog(self):
        with patch.object(
            persona_service.voice_service, "get_chatterbox_voices", return_value=CHATTERBOX_VOICES
        ):
            with patch.object(
                persona_service.voice_service, "get_openrouter_voices", return_value=[]
            ):
                result = persona_service.get_house_voices()

        self.assertEqual(result, [{"id": voice} for voice in CHATTERBOX_VOICES])

    def test_configured_openrouter_voices_are_appended(self):
        with patch.object(
            persona_service.voice_service, "get_chatterbox_voices", return_value=CHATTERBOX_VOICES
        ):
            with patch.object(
                persona_service.voice_service, "get_openrouter_voices", return_value=OPENROUTER_VOICES
            ):
                result = persona_service.get_house_voices()

        self.assertEqual(
            result, [{"id": voice} for voice in CHATTERBOX_VOICES + OPENROUTER_VOICES]
        )

    def test_openrouter_alone_is_enough_when_chatterbox_is_empty(self):
        """The two providers are independent; neither requires the other."""
        with patch.object(
            persona_service.voice_service, "get_chatterbox_voices", return_value=[]
        ):
            with patch.object(
                persona_service.voice_service, "get_openrouter_voices", return_value=OPENROUTER_VOICES
            ):
                result = persona_service.get_house_voices()

        self.assertEqual(result, [{"id": voice} for voice in OPENROUTER_VOICES])

    def test_every_entry_is_a_provider_qualified_id(self):
        """The picker stores the id and `voice.tts` routes on the prefix, so an
        unprefixed id would reach the unknown-voice branch at synthesis time."""
        with patch.object(
            persona_service.voice_service, "get_chatterbox_voices", return_value=CHATTERBOX_VOICES
        ):
            with patch.object(
                persona_service.voice_service, "get_openrouter_voices", return_value=OPENROUTER_VOICES
            ):
                result = persona_service.get_house_voices()

        for entry in result:
            self.assertRegex(entry["id"], r"^(chatterbox|elevenlabs|openrouter):")

    def test_a_failed_discovery_does_not_empty_the_catalog(self):
        """A models-API outage must degrade to Chatterbox, not to an empty
        picker: an empty catalog looks like the operator has no voices at all,
        and the UI cannot tell "none configured" from "temporarily unreachable"."""
        voices = persona_service.voice_service
        with patch.object(voices.config, "openrouter", {"api_key": "or-key", "models": ["x-ai/grok-voice-tts-1.0"]}):
            voices._openrouter_voice_cache.clear()
            with patch("app.services.voice.requests.get") as mock_get:
                mock_get.side_effect = RuntimeError("boom")
                with patch.object(voices, "get_chatterbox_voices", return_value=CHATTERBOX_VOICES):
                    result = persona_service.get_house_voices()

        self.assertEqual(result, [{"id": voice} for voice in CHATTERBOX_VOICES])


if __name__ == "__main__":
    unittest.main()