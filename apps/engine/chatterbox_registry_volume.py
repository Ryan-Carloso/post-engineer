"""Pure helpers for voices.toml on the Modal chatterbox-voices volume.

Used by modal_chatterbox.py HTTP registry endpoints and unit tests (no Modal import).
"""

from __future__ import annotations

import base64
import re
from pathlib import Path
MAX_REGISTRY_WAV_BYTES = 20 * 1024 * 1024

_VOICE_NAME_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
# BCP-47-shaped language codes (pt, pt-BR, zh-Hans, es-419). The value is
# written into voices.toml, so anything outside this shape — quotes,
# newlines, control characters — must never reach the serializer.
_LANGUAGE_ID_RE = re.compile(r"^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?$")


def is_valid_voice_name(name: str) -> bool:
    return bool(name) and bool(_VOICE_NAME_RE.match(name))


def is_valid_language_id(language_id: str) -> bool:
    return bool(language_id) and _LANGUAGE_ID_RE.fullmatch(language_id) is not None


def load_voices_toml(path: Path) -> dict[str, dict[str, str]]:
    import tomllib

    if not path.is_file():
        return {}
    with path.open("rb") as handle:
        raw = tomllib.load(handle)
    voices: dict[str, dict[str, str]] = {}
    for name, section in raw.items():
        if not isinstance(section, dict):
            continue
        reference = str(section.get("reference", "")).strip()
        if not reference:
            continue
        voices[str(name)] = {
            "reference": reference,
            "language_id": str(section.get("language_id", "pt")).strip() or "pt",
        }
    return voices


def serialize_voices_toml(voices: dict[str, dict[str, str]]) -> str:
    """Minimal TOML writer for voice table sections."""
    lines: list[str] = []
    for name in sorted(voices.keys()):
        section = voices[name]
        lines.append(f"[{name}]")
        for key in ("reference", "language_id"):
            value = section.get(key, "")
            escaped = (
                str(value)
                .replace("\\", "\\\\")
                .replace('"', '\\"')
                .replace("\n", "\\n")
                .replace("\r", "\\r")
                .replace("\t", "\\t")
            )
            lines.append(f'{key} = "{escaped}"')
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def upsert_voice(
    voices: dict[str, dict[str, str]],
    voice: str,
    language_id: str,
    reference_relative: str,
) -> dict[str, dict[str, str]]:
    language = language_id.strip() or "pt"
    if not is_valid_language_id(language):
        raise ValueError("language_id is not a valid language code")
    updated = dict(voices)
    updated[voice] = {
        "reference": reference_relative,
        "language_id": language,
    }
    return updated


def remove_voice(voices: dict[str, dict[str, str]], voice: str) -> dict[str, dict[str, str]]:
    updated = dict(voices)
    updated.pop(voice, None)
    return updated


def decode_reference_wav(payload_b64: str) -> bytes:
    # Bound the encoded payload before decoding: base64 inflates the byte
    # cap by ~4/3, so anything past 2x the cap can never be a valid upload.
    if len(payload_b64) > MAX_REGISTRY_WAV_BYTES * 2:
        raise ValueError("reference wav exceeds size limit")
    try:
        wav_bytes = base64.b64decode(payload_b64, validate=True)
    except Exception as exc:
        raise ValueError("reference_wav_base64 is not valid base64") from exc
    if len(wav_bytes) == 0:
        raise ValueError("reference wav is empty")
    if len(wav_bytes) > MAX_REGISTRY_WAV_BYTES:
        raise ValueError("reference wav exceeds size limit")
    # The engine only ever registers normalized WAV references; reject any
    # other payload here instead of failing later inside synthesis.
    if len(wav_bytes) < 12 or wav_bytes[0:4] != b"RIFF" or wav_bytes[8:12] != b"WAVE":
        raise ValueError("reference wav is not a WAV file")
    return wav_bytes


def register_voice_on_volume(
    voices_root: Path,
    config_path: Path,
    voice: str,
    language_id: str,
    wav_bytes: bytes,
) -> str:
    """Write reference.wav and update voices.toml; returns relative reference path."""
    if not is_valid_voice_name(voice):
        raise ValueError("voice must be a simple identifier")
    reference_rel = f"{voice}/reference.wav"
    # Validate (via upsert) before writing anything: a rejected registration
    # must not leave an orphan reference.wav behind.
    voices = load_voices_toml(config_path)
    voices = upsert_voice(voices, voice, language_id, reference_rel)
    destination = voices_root / voice / "reference.wav"
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(wav_bytes)
    config_path.write_text(serialize_voices_toml(voices), encoding="utf-8")
    return reference_rel


def delete_voice_on_volume(voices_root: Path, config_path: Path, voice: str) -> bool:
    if not is_valid_voice_name(voice):
        raise ValueError("voice must be a simple identifier")
    voices = load_voices_toml(config_path)
    if voice not in voices:
        return False
    voices = remove_voice(voices, voice)
    config_path.write_text(serialize_voices_toml(voices), encoding="utf-8")
    voice_dir = voices_root / voice
    ref_file = voice_dir / "reference.wav"
    if ref_file.is_file():
        ref_file.unlink()
    if voice_dir.is_dir() and not any(voice_dir.iterdir()):
        voice_dir.rmdir()
    return True
