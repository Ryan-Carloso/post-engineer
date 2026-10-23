"""Direct tests for the house voice catalog (voice_catalog.json + loader).

The picker only offers voices the pipeline can reach: every house voice is a
Phonon or Kokoro preset served by the local CPU TTS server.
"""

import json
from collections import Counter
from unittest.mock import patch

import pytest

from app.services import voice_catalog
from app.services.voice_catalog import (
    LEGACY_VOICE_ALIASES,
    find_voice,
    load_catalog,
    parse_catalog,
)


def _entry(**overrides):
    base = {
        "name": "kokoro_af_heart",
        "provider": "kokoro",
        "model_voice": "af_heart",
        "label": "Heart",
        "gender": "female",
        "accent": "us",
        "kind": "standard",
        "description": "American female voice.",
    }
    base.update(overrides)
    return base


def _doc(*entries):
    return json.dumps({"voices": list(entries)})


def test_catalog_has_65_english_voices_with_the_agreed_split():
    voices = load_catalog()
    standard = [v for v in voices if v["kind"] == "standard"]
    characters = [v for v in voices if v["kind"] == "character"]

    assert len(voices) == 65
    assert len(characters) == 12
    assert Counter(v["gender"] for v in standard) == {"female": 28, "male": 25}
    assert Counter(v["accent"] for v in standard) == {"us": 32, "gb": 21}
    assert Counter(v["provider"] for v in standard) == {"phonon": 25, "kokoro": 28}
    assert all(v["provider"] == "phonon" and v["accent"] is None for v in characters)
    assert Counter(v["gender"] for v in characters) == {"male": 9, "female": 3}


def test_catalog_has_no_personal_voice():
    names = [v["name"] for v in load_catalog()]
    assert not any("ryan" in name for name in names)


def test_every_legacy_alias_resolves_to_a_catalog_voice():
    for legacy, target in LEGACY_VOICE_ALIASES.items():
        voice = find_voice(legacy)
        assert voice is not None, legacy
        assert voice["name"] == target


def test_find_voice_returns_none_for_unknown_name():
    assert find_voice("nope") is None
    assert find_voice("kokoro_bm_george")["model_voice"] == "bm_george"


def test_parse_catalog_accepts_a_valid_entry():
    assert parse_catalog(_doc(_entry())) == [_entry()]


@pytest.mark.parametrize(
    "overrides",
    [
        {"name": ""},
        {"provider": "modal"},
        {"model_voice": ""},
        {"label": ""},
        {"gender": "other"},
        {"kind": "robot"},
        {"accent": "au"},
        {"accent": None},
        {"kind": "character", "accent": "us"},
        {"description": ""},
        {"description": None},
    ],
)
def test_parse_catalog_rejects_invalid_entries(overrides):
    with pytest.raises(ValueError):
        parse_catalog(_doc(_entry(**overrides)))


def test_parse_catalog_accepts_character_without_accent():
    entry = _entry(kind="character", accent=None, provider="phonon")
    assert parse_catalog(_doc(entry))[0]["accent"] is None


def test_parse_catalog_rejects_duplicates_and_bad_shape():
    with pytest.raises(ValueError):
        parse_catalog(_doc(_entry(), _entry()))
    with pytest.raises(ValueError):
        parse_catalog(json.dumps({"voices": {}}))
    with pytest.raises(ValueError):
        parse_catalog(json.dumps([]))
    with pytest.raises(ValueError):
        parse_catalog(_doc("not-an-object"))


def test_catalog_path_is_next_to_module():
    assert voice_catalog.CATALOG_PATH.name == "voice_catalog.json"
    assert voice_catalog.CATALOG_PATH.is_file()


def test_catalog_never_offers_a_removed_house_voice():
    """`calm`/`energetic`/`young`/`deep` used to resolve to Azure names only
    edge_tts could speak; a voice the pipeline cannot reach must not be pickable."""
    from app.services import persona as persona_service

    with patch.object(persona_service, "get_openrouter_voices", return_value=[]):
        offered = {entry["id"] for entry in persona_service.get_house_voices()}
    assert offered.isdisjoint({"calm", "energetic", "young", "deep"})


def test_every_catalog_voice_is_routable_by_tts():
    """`voice.tts` dispatches on the prefix: every house id must reach a provider."""
    from app.services import persona as persona_service
    from app.services import voice as voice_service

    with patch.object(persona_service, "get_openrouter_voices", return_value=[]):
        catalog = persona_service.get_house_voices()
    for entry in catalog:
        assert voice_service.is_chatterbox_voice(entry["id"]), entry["id"]


def test_every_catalog_voice_has_a_description():
    """MCP agents cannot listen to samples; the description is how they choose."""
    assert all(len(voice["description"]) > 20 for voice in load_catalog())

