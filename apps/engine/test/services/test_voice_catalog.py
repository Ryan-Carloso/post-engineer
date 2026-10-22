"""The voice catalog is the local preset catalog.

There is no house-voice layer any more, and no hosted catalog to
configure: preset voices are the Phonon + Kokoro voices that ship with
the engine (``voice_catalog.PRESET_CATALOG``), each with the metadata
the picker filters on.

Why it matters: the picker used to offer voices the pipeline could not
reach. Every id offered here routes to a local provider in `voice.tts`.
"""

from unittest.mock import patch

from app.services import persona as persona_service
from app.services import voice as voice_service
from app.services import voice_catalog


class TestVoiceCatalog:
    def test_catalog_is_exactly_the_local_presets(self):
        """Ids are provider-qualified: the stored id is the routable one."""
        with patch.object(persona_service, "get_openrouter_voices", return_value=[]):
            catalog = persona_service.get_house_voices()

        assert [entry["id"] for entry in catalog] == [
            voice.id for voice in voice_catalog.PRESET_CATALOG
        ]
        assert len(catalog) == 65

    def test_catalog_never_offers_a_removed_house_voice(self):
        """A voice the pipeline cannot reach must not be pickable."""
        with patch.object(persona_service, "get_openrouter_voices", return_value=[]):
            offered = {entry["id"] for entry in persona_service.get_house_voices()}

        assert offered.isdisjoint({"calm", "energetic", "young", "deep"})
        assert offered.isdisjoint({"chatterbox:ryan", "chatterbox:en_us_female_01"})

    def test_every_catalog_voice_is_routable_by_tts(self):
        """Each id the catalog offers must actually reach a provider.

        `voice.tts` dispatches on the `phonon:`/`kokoro:`/`chatterbox:`/
        `elevenlabs:` prefixes (plus OpenRouter's). If the catalog ever
        emits an id the router would reject, the picker offers a voice
        that fails loud at generation time — the exact class of bug this
        catalog rewrite is meant to end.
        """
        with patch.object(persona_service, "get_openrouter_voices", return_value=[]):
            catalog = persona_service.get_house_voices()

        for entry in catalog:
            assert (
                voice_service.is_phonon_voice(entry["id"])
                or voice_service.is_kokoro_voice(entry["id"])
            ), f"{entry['id']} is in the catalog but tts() would not route it"

    def test_every_preset_entry_carries_picker_metadata(self):
        with patch.object(persona_service, "get_openrouter_voices", return_value=[]):
            catalog = persona_service.get_house_voices()

        for entry in catalog:
            assert entry["name"]
            assert entry["provider"] in ("phonon", "kokoro")
            assert entry["gender"] in ("male", "female")
            assert entry["category"] in ("normal", "character")
