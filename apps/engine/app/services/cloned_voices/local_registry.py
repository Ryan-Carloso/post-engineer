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
import re
from pathlib import Path
from typing import Any, Protocol

from app.config import config as app_config

# Voice keys are server-generated (u<hex>_<hex> from the store) and
# never contain separators or dots. A key that does can only arrive
# from a crafted persona voice_id — and the ownership check treats
# non-clone-shaped names as house voices allowed for everyone — so the
# registry sink itself refuses such keys instead of resolving them
# into paths outside the registry directory.
_VOICE_KEY_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]*$")


def _validated_key_path(directory: Path, voice_key: str) -> Path:
    """The WAV path for ``voice_key`` inside ``directory``.

    Raises ValueError for any key that is not a plain registry key, or
    whose resolved path would escape ``directory``. The key is reduced
    to its basename and allowlist-checked before it ever touches a
    path, and the joined path is containment-checked after resolving.
    """
    stripped = (voice_key or "").strip()
    key = os.path.basename(stripped)
    if key != stripped or not _VOICE_KEY_RE.match(key):
        raise ValueError("invalid cloned voice key")
    base = directory.resolve()
    path = (base / f"{key}.wav").resolve()
    if path.parent != base:
        raise ValueError("invalid cloned voice key")
    return path


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
    return _validated_key_path(local_registry_dir(), voice_key)


class LocalVoiceRegistry:
    """Persists clone references as local WAV files (atomic rename)."""

    def __init__(self, directory: Path | None = None) -> None:
        self._dir = directory if directory is not None else local_registry_dir()

    def register_voice(self, voice_key: str, language_id: str, wav_bytes: bytes) -> None:
        # language_id is accepted for protocol parity: Nano clones are
        # English-only at launch and the reference carries no language.
        target = _validated_key_path(self._dir, voice_key)
        self._dir.mkdir(parents=True, exist_ok=True)
        tmp = self._dir / f".{target.stem}.tmp"
        tmp.write_bytes(wav_bytes)
        tmp.replace(target)

    def delete_voice(self, voice_key: str) -> None:
        try:
            target = _validated_key_path(self._dir, voice_key)
        except ValueError:
            # A malformed key names no file this registry could have
            # written; deletion stays a no-op for it.
            return
        try:
            target.unlink()
        except FileNotFoundError:
            pass


def default_registry() -> VoiceRegistry:
    return LocalVoiceRegistry()
