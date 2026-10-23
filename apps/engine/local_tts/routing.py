"""Pure request routing for the local CPU TTS server (no model imports).

A speech request names one logical voice. It resolves to exactly one of:

- a house voice from ``app/services/voice_catalog.json`` (Phonon or Kokoro
  preset, legacy Modal names included through ``LEGACY_VOICE_ALIASES``), or
- a per-user clone registered in ``voices.toml`` on the voices volume,
  synthesized by Chatterbox Nano from its reference WAV.

Anything else is unknown (404). Kept free of torch/ptts/kokoro so the routing
and path-safety rules are unit-testable without the models.
"""

from __future__ import annotations

import tomllib
from dataclasses import dataclass
from pathlib import Path

from app.services.voice_catalog import find_voice

ALLOWED_FORMATS = ("wav", "mp3")


@dataclass(frozen=True)
class PresetVoice:
    provider: str
    model_voice: str


@dataclass(frozen=True)
class ClonedVoice:
    reference_path: Path


def load_clone_registry(config_path: Path) -> dict[str, str]:
    """voices.toml -> {voice name: reference path relative to the volume}."""
    if not config_path.is_file():
        return {}
    with config_path.open("rb") as handle:
        raw = tomllib.load(handle)
    registry: dict[str, str] = {}
    for name, section in raw.items():
        if not isinstance(section, dict):
            continue
        reference = str(section.get("reference", "")).strip()
        if reference:
            registry[str(name)] = reference
    return registry


def resolve_reference_path(voices_root: Path, reference: str) -> Path:
    """Resolve a registry reference under the voices volume, refusing escapes."""
    root = voices_root.resolve()
    resolved = (root / reference).resolve()
    if root not in resolved.parents:
        raise ValueError(f"reference path escapes the voices volume: {reference!r}")
    return resolved


def resolve_voice(voice: str, voices_root: Path, config_path: Path) -> PresetVoice | ClonedVoice:
    """Map a logical voice name to what must synthesize it.

    Raises KeyError for an unknown voice and FileNotFoundError when a clone's
    registry entry points at a missing reference file.
    """
    preset = find_voice(voice)
    if preset is not None:
        return PresetVoice(provider=preset["provider"], model_voice=preset["model_voice"])

    reference = load_clone_registry(config_path).get(voice)
    if reference is None:
        raise KeyError(f"unknown voice: {voice}")
    path = resolve_reference_path(voices_root, reference)
    if not path.is_file():
        raise FileNotFoundError(f"reference audio missing for voice: {voice}")
    return ClonedVoice(reference_path=path)
