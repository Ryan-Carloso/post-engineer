"""Routing and path-safety rules of the local CPU TTS server (no models)."""

from pathlib import Path

import pytest

from local_tts.routing import (
    ClonedVoice,
    PresetVoice,
    load_clone_registry,
    resolve_reference_path,
    resolve_voice,
)

CLONE = "u0123456789ab_0123456789ab"


def _registry(tmp_path: Path, body: str) -> Path:
    config = tmp_path / "voices.toml"
    config.write_text(body, encoding="utf-8")
    return config


def test_house_voice_resolves_to_its_preset(tmp_path):
    target = resolve_voice("phonon_zoey", tmp_path, tmp_path / "voices.toml")
    assert target == PresetVoice(provider="phonon", model_voice="NbpkqMVS3CJeq2j8")

    kokoro = resolve_voice("kokoro_bm_george", tmp_path, tmp_path / "voices.toml")
    assert kokoro == PresetVoice(provider="kokoro", model_voice="bm_george")


def test_legacy_modal_voice_resolves_through_alias(tmp_path):
    target = resolve_voice("en_us_male_01", tmp_path, tmp_path / "voices.toml")
    assert target == PresetVoice(provider="kokoro", model_voice="am_michael")


def test_registered_clone_resolves_to_its_reference(tmp_path):
    reference = tmp_path / CLONE / "reference.wav"
    reference.parent.mkdir()
    reference.write_bytes(b"RIFF")
    config = _registry(tmp_path, f'[{CLONE}]\nreference = "{CLONE}/reference.wav"\nlanguage_id = "en"\n')

    target = resolve_voice(CLONE, tmp_path, config)
    assert target == ClonedVoice(reference_path=reference.resolve())


def test_unknown_voice_raises_key_error(tmp_path):
    with pytest.raises(KeyError):
        resolve_voice("nope", tmp_path, tmp_path / "voices.toml")


def test_clone_with_missing_reference_raises(tmp_path):
    config = _registry(tmp_path, f'[{CLONE}]\nreference = "{CLONE}/reference.wav"\n')
    with pytest.raises(FileNotFoundError):
        resolve_voice(CLONE, tmp_path, config)


def test_reference_path_escape_is_refused(tmp_path):
    with pytest.raises(ValueError):
        resolve_reference_path(tmp_path, "../etc/passwd")
    with pytest.raises(ValueError):
        resolve_reference_path(tmp_path, "/etc/passwd")


def test_registry_skips_entries_without_reference(tmp_path):
    config = _registry(
        tmp_path,
        'top = "x"\n[a]\nreference = "a/ref.wav"\n[b]\nreference = "  "\n[c]\nlanguage_id = "en"\n',
    )
    assert load_clone_registry(config) == {"a": "a/ref.wav"}
    assert load_clone_registry(tmp_path / "missing.toml") == {}
