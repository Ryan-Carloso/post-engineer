"""Local filesystem registry for per-user cloned voices.

Replaces the Modal registry: registering a clone now just persists its
normalized reference WAV in a local directory (one file per engine
voice key). Chatterbox-Nano is zero-shot, so the reference file IS the
registration — generation reads it back via ``reference_path_for``.

The directory resolves from ``[cloned_voices] local_dir`` in
config.toml, else the ``CLONED_VOICES_LOCAL_DIR`` env var, else
``<engine>/cloned_voices``. The Supabase row + storage object remain the
durable record: the boot reconcile re-registers pending rows from
storage, and a ready row whose local file was lost (fresh container)
is re-registered the same way.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Protocol

from app.config import config as app_config


class VoiceRegistry(Protocol):
    def register_voice(self, voice_key: str, language_id: str, wav_bytes: bytes) -> None:
        ...

    def delete_voice(self, voice_key: str) -> None:
        ...


class RegistryNotConfiguredError(RuntimeError):
    """Raised when cloned-voice registration is not wired for this deployment."""


def local_registry_dir() -> Path:
    section: dict[str, Any] = app_config.cloned_voices or {}
    configured = (section.get("local_dir") or os.getenv("CLONED_VOICES_LOCAL_DIR") or "").strip()
    if configured:
        return Path(configured).expanduser()
    engine_root = Path(__file__).resolve().parents[3]
    return engine_root / "cloned_voices"


def reference_path_for(voice_key: str) -> Path:
    """Local reference WAV path for an engine voice key."""
    return local_registry_dir() / f"{voice_key}.wav"


class LocalVoiceRegistry:
    """Persists clone references as local WAV files (atomic rename)."""

    def __init__(self, directory: Path | None = None) -> None:
        self._dir = directory if directory is not None else local_registry_dir()

    def register_voice(self, voice_key: str, language_id: str, wav_bytes: bytes) -> None:
        # language_id is accepted for protocol parity: Nano clones are
        # English-only at launch and the reference carries no language.
        self._dir.mkdir(parents=True, exist_ok=True)
        target = self._dir / f"{voice_key}.wav"
        tmp = self._dir / f".{voice_key}.tmp"
        tmp.write_bytes(wav_bytes)
        tmp.replace(target)

    def delete_voice(self, voice_key: str) -> None:
        try:
            (self._dir / f"{voice_key}.wav").unlink()
        except FileNotFoundError:
            pass


def default_registry() -> VoiceRegistry:
    return LocalVoiceRegistry()
