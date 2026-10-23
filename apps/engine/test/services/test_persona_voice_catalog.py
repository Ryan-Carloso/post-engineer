"""`persona.get_house_voices` is what the picker renders.

House voices come from the local TTS catalog (Phonon + Kokoro) with filter
metadata; OpenRouter is a hosted provider whose voices are discovered per
configured model and carry no metadata. The invariants pinned here: an
unconfigured OpenRouter contributes nothing, cloned voices are tagged
``kind: "cloned"``, and a failed cloned-store read never empties the picker.
"""

import unittest
from unittest.mock import patch

from app.services import persona as persona_service
from app.services.voice_catalog import load_catalog

OPENROUTER_VOICES = [
    "openrouter:x-ai/grok-voice-tts-1.0:eve",
    "openrouter:x-ai/grok-voice-tts-1.0:ara",
]


def _house_ids() -> list[str]:
    return [f"chatterbox:{voice['name']}" for voice in load_catalog()]


class TestHouseVoiceCatalog(unittest.TestCase):
    def test_house_voices_carry_catalog_metadata(self):
        with patch.object(persona_service, "get_openrouter_voices", return_value=[]):
            result = persona_service.get_house_voices()

        self.assertEqual([entry["id"] for entry in result], _house_ids())
        heart = next(entry for entry in result if entry["id"] == "chatterbox:kokoro_af_heart")
        self.assertEqual(
            heart,
            {
                "id": "chatterbox:kokoro_af_heart",
                "label": "Heart",
                "provider": "kokoro",
                "gender": "female",
                "accent": "us",
                "kind": "standard",
                "description": heart["description"],
            },
        )
        self.assertIn("American female", heart["description"])

    def test_configured_openrouter_voices_are_appended_without_metadata(self):
        with patch.object(persona_service, "get_openrouter_voices", return_value=OPENROUTER_VOICES):
            result = persona_service.get_house_voices()

        self.assertEqual([entry["id"] for entry in result], _house_ids() + OPENROUTER_VOICES)
        self.assertEqual(
            result[-1],
            {
                "id": OPENROUTER_VOICES[-1],
                "label": None,
                "provider": "openrouter",
                "gender": None,
                "accent": None,
                "kind": "standard",
                "description": None,
            },
        )

    def test_cloned_voices_are_merged_as_cloned_kind(self):
        with patch.object(persona_service, "get_openrouter_voices", return_value=[]):
            with patch(
                "app.services.cloned_voices.service.list_catalog_entries",
                return_value=[{"id": "chatterbox:uabc_clone1"}],
            ) as mock_entries:
                result = persona_service.get_house_voices(user_id="user-1")

        mock_entries.assert_called_once_with("user-1")
        self.assertEqual(result[-1]["id"], "chatterbox:uabc_clone1")
        self.assertEqual(result[-1]["kind"], "cloned")
        self.assertEqual(len(result), len(_house_ids()) + 1)

    def test_catalog_degrades_to_house_voices_when_cloned_store_fails(self):
        """The cloned merge reads Supabase; its failure must not empty the picker."""
        with patch.object(persona_service, "get_openrouter_voices", return_value=[]):
            with patch(
                "app.services.cloned_voices.service.list_catalog_entries",
                side_effect=RuntimeError("SUPABASE_URL is required for cloned_voices"),
            ):
                result = persona_service.get_house_voices(user_id="user-1")

        self.assertEqual([entry["id"] for entry in result], _house_ids())

    def test_every_entry_is_a_provider_qualified_id(self):
        """The picker stores the id and `voice.tts` routes on the prefix, so an
        unprefixed id would reach the unknown-voice branch at synthesis time."""
        with patch.object(persona_service, "get_openrouter_voices", return_value=OPENROUTER_VOICES):
            result = persona_service.get_house_voices()

        for entry in result:
            self.assertRegex(entry["id"], r"^(chatterbox|elevenlabs|openrouter):")

    def test_a_failed_discovery_does_not_empty_the_catalog(self):
        """A models-API outage must degrade to the house voices, not to an empty
        picker: an empty catalog looks like the operator has no voices at all."""
        from app.services import openrouter_tts as or_tts

        with patch.object(or_tts.config, "openrouter", {"api_key": "or-key", "models": ["x-ai/grok-voice-tts-1.0"]}):
            or_tts._openrouter_voice_cache.clear()
            with patch("app.services.openrouter_tts.requests.get") as mock_get:
                mock_get.side_effect = RuntimeError("boom")
                result = persona_service.get_house_voices()

        self.assertEqual([entry["id"] for entry in result], _house_ids())


if __name__ == "__main__":
    unittest.main()
