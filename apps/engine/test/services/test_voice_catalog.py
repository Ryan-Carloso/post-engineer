"""The voice catalog is the provider's own list.

There is no house-voice layer any more. `calm`/`energetic`/`young`/`deep` used
to resolve, per video language, to an Azure name; that matrix is gone with the
Azure providers, so the catalog is now exactly the Chatterbox voices configured
under `[chatterbox] voices`.

Why it matters: the picker used to offer voices the pipeline could not reach.
`calm` resolved to `pt-BR-FranciscaNeural`, which only edge_tts could speak —
and with edge_tts unreachable every video died at the `audio` stage.
"""

from unittest.mock import patch

from app.services import persona as persona_service
from app.services import voice as voice_service


class TestVoiceCatalog:
    def test_catalog_is_exactly_the_configured_chatterbox_voices(self):
        """Ids are provider-qualified: the stored id is the routable one."""
        with patch.object(
            voice_service.config, "chatterbox", {"voices": ["ryan", "en_us_female_01"]}
        ):
            catalog = persona_service.get_house_voices()

        assert [entry["id"] for entry in catalog] == [
            "chatterbox:ryan",
            "chatterbox:en_us_female_01",
        ]

    def test_catalog_never_offers_a_removed_house_voice(self):
        """A voice the pipeline cannot reach must not be pickable."""
        with patch.object(voice_service.config, "chatterbox", {"voices": ["ryan"]}):
            offered = {entry["id"] for entry in persona_service.get_house_voices()}

        assert offered.isdisjoint({"calm", "energetic", "young", "deep"})

    def test_every_catalog_voice_is_routable_by_tts(self):
        """Each id the catalog offers must actually reach a provider.

        `voice.tts` only dispatches on the `chatterbox:`/`elevenlabs:`
        prefixes. If the catalog ever emits an id the router would reject, the
        picker offers a voice that fails loud at generation time — the exact
        class of bug this catalog rewrite is meant to end.
        """
        with patch.object(voice_service.config, "chatterbox", {"voices": ["ryan"]}):
            catalog = persona_service.get_house_voices()

        for entry in catalog:
            assert voice_service.is_chatterbox_voice(entry["id"]), (
                f"{entry['id']} is in the catalog but tts() would not route it"
            )