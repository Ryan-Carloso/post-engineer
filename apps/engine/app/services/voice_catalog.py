"""House voice catalog for the local CPU TTS server.

The catalog lives in ``voice_catalog.json`` next to this module and is the
single source for both sides: the engine lists it in the voice picker, and
``local_tts/server.py`` resolves each logical name to its model (Phonon or
Kokoro) and model-specific voice. Pure module — no app imports, no I/O at
import time — so the TTS server image can ship it on its own.

Every house voice is exposed to callers as ``chatterbox:<name>``: the
``chatterbox:`` prefix routes to the engine's OpenAI-compatible speech
client, which now targets the local TTS server instead of Modal.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Literal, TypedDict

CATALOG_PATH = Path(__file__).with_name("voice_catalog.json")

Provider = Literal["phonon", "kokoro"]
Gender = Literal["female", "male"]
Accent = Literal["us", "gb"]
Kind = Literal["standard", "character"]

PROVIDERS: tuple[str, ...] = ("phonon", "kokoro")
GENDERS: tuple[str, ...] = ("female", "male")
ACCENTS: tuple[str, ...] = ("us", "gb")
KINDS: tuple[str, ...] = ("standard", "character")

# Voices from the retired Modal Chatterbox volume that personas may still
# store. Each maps to the closest catalog voice (same gender and accent) so
# existing personas keep speaking instead of failing at render time.
LEGACY_VOICE_ALIASES: dict[str, str] = {
    "en_us_female_01": "kokoro_af_heart",
    "en_us_female_02": "kokoro_af_bella",
    "en_us_female_03": "kokoro_af_nicole",
    "en_us_female_04": "kokoro_af_sarah",
    "en_us_male_01": "kokoro_am_michael",
    "en_us_male_02": "kokoro_am_adam",
    "en_us_male_03": "kokoro_am_eric",
    "en_us_male_04": "kokoro_am_liam",
    "default-Female": "kokoro_af_heart",
}


class CatalogVoice(TypedDict):
    name: str
    provider: Provider
    model_voice: str
    label: str
    gender: Gender
    accent: Accent | None
    kind: Kind
    description: str


def _parse_voice(raw: object) -> CatalogVoice:
    if not isinstance(raw, dict):
        raise ValueError("catalog entry must be an object")
    name = raw.get("name")
    provider = raw.get("provider")
    model_voice = raw.get("model_voice")
    label = raw.get("label")
    gender = raw.get("gender")
    accent = raw.get("accent")
    kind = raw.get("kind")
    description = raw.get("description")
    if not isinstance(name, str) or not name:
        raise ValueError("catalog entry has no name")
    if provider not in PROVIDERS:
        raise ValueError(f"catalog entry {name} has unknown provider")
    if not isinstance(model_voice, str) or not model_voice:
        raise ValueError(f"catalog entry {name} has no model_voice")
    if not isinstance(label, str) or not label:
        raise ValueError(f"catalog entry {name} has no label")
    if gender not in GENDERS:
        raise ValueError(f"catalog entry {name} has unknown gender")
    if kind not in KINDS:
        raise ValueError(f"catalog entry {name} has unknown kind")
    if not isinstance(description, str) or not description.strip():
        raise ValueError(f"catalog entry {name} has no description")
    # Characters are their own category with no accent; standard voices
    # always carry one, so the origin filter never drops them.
    if kind == "character" and accent is not None:
        raise ValueError(f"character {name} must not have an accent")
    if kind == "standard" and accent not in ACCENTS:
        raise ValueError(f"catalog entry {name} has unknown accent")
    return {
        "name": name,
        "provider": provider,
        "model_voice": model_voice,
        "label": label,
        "gender": gender,
        "accent": accent,
        "kind": kind,
        "description": description,
    }


def parse_catalog(text: str) -> list[CatalogVoice]:
    data = json.loads(text)
    if not isinstance(data, dict) or not isinstance(data.get("voices"), list):
        raise ValueError("catalog must be an object with a voices list")
    voices = [_parse_voice(raw) for raw in data["voices"]]
    names = [voice["name"] for voice in voices]
    if len(set(names)) != len(names):
        raise ValueError("catalog voice names must be unique")
    return voices


@lru_cache(maxsize=1)
def load_catalog() -> tuple[CatalogVoice, ...]:
    return tuple(parse_catalog(CATALOG_PATH.read_text(encoding="utf-8")))


def find_voice(name: str) -> CatalogVoice | None:
    """Resolve a logical voice name (or a legacy alias) to its catalog entry."""
    resolved = LEGACY_VOICE_ALIASES.get(name, name)
    for voice in load_catalog():
        if voice["name"] == resolved:
            return voice
    return None
