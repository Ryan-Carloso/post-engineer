"""Unified local preset voice catalog (Phonon + Kokoro).

The catalog is the single source the persona picker renders: every entry
carries the metadata the UI filters on (gender, category, locale). These
tests pin the totals agreed for the English-only launch: 65 voices —
37 Phonon (25 normal + 12 characters) and 28 Kokoro.
"""

import unittest

from app.services import voice_catalog


class PresetCatalogTests(unittest.TestCase):
    def test_catalog_totals(self):
        catalog = voice_catalog.PRESET_CATALOG
        self.assertEqual(len(catalog), 65)
        phonon = [v for v in catalog if v.provider == "phonon"]
        kokoro = [v for v in catalog if v.provider == "kokoro"]
        self.assertEqual(len(phonon), 37)
        self.assertEqual(len(kokoro), 28)

    def test_ids_are_unique_and_provider_prefixed(self):
        ids = [v.id for v in voice_catalog.PRESET_CATALOG]
        self.assertEqual(len(ids), len(set(ids)))
        for voice in voice_catalog.PRESET_CATALOG:
            self.assertTrue(voice.id.startswith(f"{voice.provider}:"), voice.id)

    def test_every_entry_has_gender_and_valid_category(self):
        for voice in voice_catalog.PRESET_CATALOG:
            self.assertIn(voice.gender, ("male", "female"), voice.id)
            self.assertIn(voice.category, ("normal", "character"), voice.id)

    def test_characters_are_phonon_only_with_no_locale(self):
        characters = [v for v in voice_catalog.PRESET_CATALOG if v.category == "character"]
        self.assertEqual(len(characters), 12)
        for voice in characters:
            self.assertEqual(voice.provider, "phonon")
            self.assertIsNone(voice.locale)

    def test_character_gender_curation(self):
        by_name = {v.name: v for v in voice_catalog.PRESET_CATALOG if v.category == "character"}
        for name in ("Morwenna of the Deep", "The Snow Queen", "Fairy Godmother"):
            self.assertEqual(by_name[name].gender, "female", name)
        for name in (
            "Captain Silas Blackwater",
            "Old Mortlake",
            "Azgorath",
            "Fennick the Young Elf",
            "The Thing Under the Stairs",
            "Vyrmathrax the Ancient",
            "Grub the Ogre",
            "Master Aldric",
            "Sir Bramwell",
        ):
            self.assertEqual(by_name[name].gender, "male", name)

    def test_normals_carry_us_or_gb_locale(self):
        normals = [v for v in voice_catalog.PRESET_CATALOG if v.category == "normal"]
        self.assertEqual(len(normals), 53)
        for voice in normals:
            self.assertIn(voice.locale, ("en-US", "en-GB"), voice.id)

    def test_kokoro_metadata_comes_from_the_voice_id(self):
        by_id = {v.id: v for v in voice_catalog.PRESET_CATALOG}
        heart = by_id["kokoro:af_heart"]
        self.assertEqual((heart.locale, heart.gender, heart.category), ("en-US", "female", "normal"))
        george = by_id["kokoro:bm_george"]
        self.assertEqual((george.locale, george.gender), ("en-GB", "male"))

    def test_gender_totals(self):
        females = [v for v in voice_catalog.PRESET_CATALOG if v.gender == "female"]
        males = [v for v in voice_catalog.PRESET_CATALOG if v.gender == "male"]
        self.assertEqual(len(females), 31)
        self.assertEqual(len(males), 34)

    def test_catalog_entries_shape_for_the_picker(self):
        entries = voice_catalog.catalog_entries()
        self.assertEqual(len(entries), 65)
        easton = next(e for e in entries if e["id"] == "phonon:Easton")
        self.assertEqual(
            easton,
            {
                "id": "phonon:Easton",
                "name": "Easton",
                "provider": "phonon",
                "gender": "male",
                "category": "normal",
                "locale": "en-US",
            },
        )
        silas = next(e for e in entries if e["id"] == "phonon:Captain Silas Blackwater")
        self.assertEqual(silas["category"], "character")
        self.assertIsNone(silas["locale"])


class LegacyAliasTests(unittest.TestCase):
    def test_every_legacy_house_voice_resolves_to_a_catalog_id(self):
        catalog_ids = {v.id for v in voice_catalog.PRESET_CATALOG}
        for legacy, target in voice_catalog.LEGACY_CHATTERBOX_ALIASES.items():
            self.assertIn(target, catalog_ids, legacy)

    def test_legacy_house_names_from_voices_toml_are_covered(self):
        for name in (
            "en_us_female_01",
            "en_us_female_04",
            "en_us_male_01",
            "en_us_male_04",
            "pt_br_female_01",
            "pt_br_male_04",
            "ryan",
        ):
            self.assertIn(name, voice_catalog.LEGACY_CHATTERBOX_ALIASES, name)

    def test_resolve_rewrites_legacy_chatterbox_ids(self):
        self.assertEqual(
            voice_catalog.resolve_voice_id("chatterbox:en_us_female_01"),
            voice_catalog.LEGACY_CHATTERBOX_ALIASES["en_us_female_01"],
        )
        # Display-only gender suffixes are stripped before lookup.
        self.assertEqual(
            voice_catalog.resolve_voice_id("chatterbox:en_us_male_02-Male"),
            voice_catalog.LEGACY_CHATTERBOX_ALIASES["en_us_male_02"],
        )

    def test_resolve_leaves_other_ids_untouched(self):
        for voice_id in (
            "phonon:Easton",
            "kokoro:af_heart",
            "chatterbox:u0123456789ab_c0123456789a",
            "openrouter:model:voice",
            "elevenlabs:abc",
        ):
            self.assertEqual(voice_catalog.resolve_voice_id(voice_id), voice_id)

    def test_resolve_tolerates_none_and_empty(self):
        # tts() passes the stored voice id straight here; a missing
        # voice must fall through to the clean unknown-voice error,
        # not crash on .startswith.
        self.assertIsNone(voice_catalog.resolve_voice_id(None))
        self.assertEqual(voice_catalog.resolve_voice_id(""), "")


if __name__ == "__main__":
    unittest.main()
