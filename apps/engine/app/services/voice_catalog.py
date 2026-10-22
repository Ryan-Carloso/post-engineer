"""Unified preset voice catalog for the local TTS stack.

Preset voices ship with the engine and run on local CPU models — no
hosted catalog exists. This module is the single source the persona
picker renders:

- ``phonon:<Name>`` — Gradium Phonon-31m-en voices (via ``ptts``). The
  normal voices carry their locale/gender from Gradium's
  ``phonon-voices`` catalog; the theatrical "characters" have no locale
  in that catalog (``locale = "characters"``), so their gender is
  curated here from their published descriptions.
- ``kokoro:<voice_id>`` — Kokoro-82M voices (via ``kokoro-onnx``). The
  voice id encodes the metadata: ``a``/``b`` = American/British,
  ``f``/``m`` = female/male.

Every entry carries the metadata the picker filters on:
``{id, name, provider, gender, category, locale}`` where ``category``
is ``normal`` or ``character`` and ``locale`` is ``en-US``/``en-GB``
(or None for characters, which have no accent).

Legacy personas store ``chatterbox:<name>`` ids from the retired Modal
house catalog (``voices.toml``). ``LEGACY_CHATTERBOX_ALIASES`` maps each
of those names to the closest local preset so old personas keep
generating; per-user clone keys (``chatterbox:u<hex>_<hex>``) are NOT
aliased — they still route to the owner's local clone.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class VoiceInfo:
    id: str
    name: str
    provider: str  # "phonon" | "kokoro"
    gender: str  # "male" | "female"
    category: str  # "normal" | "character"
    locale: str | None  # "en-US" | "en-GB" | None (characters)


def _phonon(name: str, locale: str | None, gender: str, category: str = "normal") -> VoiceInfo:
    return VoiceInfo(
        id=f"phonon:{name}",
        name=name,
        provider="phonon",
        gender=gender,
        category=category,
        locale=locale,
    )


# Phonon normal voices: (name, locale, gender) from gradium/phonon-voices.
_PHONON_NORMAL: tuple[tuple[str, str, str], ...] = (
    # en-US female
    ("Zoey", "en-US", "female"),
    ("Juniper", "en-US", "female"),
    ("Everly", "en-US", "female"),
    ("Harper", "en-US", "female"),
    ("Hadley", "en-US", "female"),
    ("Delia", "en-US", "female"),
    # en-US male
    ("Easton", "en-US", "male"),
    ("Micah", "en-US", "male"),
    ("Trevor", "en-US", "male"),
    ("Russell", "en-US", "male"),
    ("Preston", "en-US", "male"),
    ("Miles", "en-US", "male"),
    # en-GB female
    ("Maeve", "en-GB", "female"),
    ("Freya", "en-GB", "female"),
    ("Pippa", "en-GB", "female"),
    ("Elodie-Rose", "en-GB", "female"),
    ("Imogen", "en-GB", "female"),
    ("Lottie", "en-GB", "female"),
    ("Bryony", "en-GB", "female"),
    # en-GB male
    ("Alfie", "en-GB", "male"),
    ("Hugh", "en-GB", "male"),
    ("Edwin", "en-GB", "male"),
    ("Spencer", "en-GB", "male"),
    ("Toby", "en-GB", "male"),
    ("Teddy", "en-GB", "male"),
)

# Phonon theatrical characters: gender curated from their catalog
# descriptions (the upstream catalog leaves gender unset for these).
_PHONON_CHARACTERS: tuple[tuple[str, str], ...] = (
    ("Captain Silas Blackwater", "male"),
    ("Morwenna of the Deep", "female"),
    ("Old Mortlake", "male"),
    ("Azgorath", "male"),
    ("Fennick the Young Elf", "male"),
    ("The Thing Under the Stairs", "male"),
    ("Vyrmathrax the Ancient", "male"),
    ("Grub the Ogre", "male"),
    ("Master Aldric", "male"),
    ("The Snow Queen", "female"),
    ("Sir Bramwell", "male"),
    ("Fairy Godmother", "female"),
)

# Kokoro-82M English voices (the full en set of voices-v1.0.bin).
_KOKORO_VOICE_IDS: tuple[str, ...] = (
    "af_alloy", "af_aoede", "af_bella", "af_heart", "af_jessica",
    "af_kore", "af_nicole", "af_nova", "af_river", "af_sarah", "af_sky",
    "am_adam", "am_echo", "am_eric", "am_fenrir", "am_liam",
    "am_michael", "am_onyx", "am_puck", "am_santa",
    "bf_alice", "bf_emma", "bf_isabella", "bf_lily",
    "bm_daniel", "bm_fable", "bm_george", "bm_lewis",
)


def _kokoro(voice_id: str) -> VoiceInfo:
    locale = "en-US" if voice_id[0] == "a" else "en-GB"
    gender = "female" if voice_id[1] == "f" else "male"
    return VoiceInfo(
        id=f"kokoro:{voice_id}",
        name=voice_id[3:].replace("_", " ").title(),
        provider="kokoro",
        gender=gender,
        category="normal",
        locale=locale,
    )


PRESET_CATALOG: tuple[VoiceInfo, ...] = (
    *(_phonon(name, locale, gender) for name, locale, gender in _PHONON_NORMAL),
    *(_phonon(name, None, gender, "character") for name, gender in _PHONON_CHARACTERS),
    *(_kokoro(voice_id) for voice_id in _KOKORO_VOICE_IDS),
)

_BY_ID: dict[str, VoiceInfo] = {voice.id: voice for voice in PRESET_CATALOG}


def catalog_entries() -> list[dict[str, str | None]]:
    """Catalog rows in the shape the persona voices endpoint serves."""
    return [
        {
            "id": voice.id,
            "name": voice.name,
            "provider": voice.provider,
            "gender": voice.gender,
            "category": voice.category,
            "locale": voice.locale,
        }
        for voice in PRESET_CATALOG
    ]


def get_voice(voice_id: str) -> VoiceInfo | None:
    return _BY_ID.get(voice_id)


# Retired Modal house voices (voices.toml) -> closest local preset.
# The pt_br_* voices map onto en-US presets: the launch catalog is
# English-only, and a persona still pointing at a PT house voice must
# keep generating instead of failing on an unknown voice.
LEGACY_CHATTERBOX_ALIASES: dict[str, str] = {
    "en_us_female_01": "phonon:Zoey",
    "en_us_female_02": "phonon:Harper",
    "en_us_female_03": "phonon:Everly",
    "en_us_female_04": "phonon:Juniper",
    "en_us_male_01": "phonon:Easton",
    "en_us_male_02": "phonon:Micah",
    "en_us_male_03": "phonon:Trevor",
    "en_us_male_04": "phonon:Russell",
    "pt_br_female_01": "phonon:Zoey",
    "pt_br_female_02": "phonon:Harper",
    "pt_br_female_03": "phonon:Everly",
    "pt_br_female_04": "phonon:Juniper",
    "pt_br_male_01": "phonon:Easton",
    "pt_br_male_02": "phonon:Micah",
    "pt_br_male_03": "phonon:Trevor",
    "pt_br_male_04": "phonon:Russell",
    # A personal clone that briefly shipped in the house catalog; PR #252
    # removes it there. Personas still storing it fall back to a preset.
    "ryan": "phonon:Miles",
    # The pre-catalog fallback voice (see the old get_chatterbox_voices).
    "default": "phonon:Zoey",
}

_CHATTERBOX_PREFIX = "chatterbox:"


def resolve_voice_id(voice_id: str) -> str:
    """Rewrite a legacy ``chatterbox:<house name>`` id to its local preset.

    Clone keys and every non-chatterbox id pass through unchanged.
    """
    if not (voice_id or "").startswith(_CHATTERBOX_PREFIX):
        return voice_id
    name = voice_id[len(_CHATTERBOX_PREFIX):].strip()
    if name.endswith(("-Female", "-Male")):
        name = name.rsplit("-", 1)[0]
    target = LEGACY_CHATTERBOX_ALIASES.get(name)
    return target if target is not None else voice_id
