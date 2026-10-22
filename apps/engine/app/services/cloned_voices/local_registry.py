"""Local filesystem registry for per-user cloned voices.

Replaces the Modal registry: registering a clone now just persists its
normalized reference WAV in a local directory (one file per engine
voice key). Chatterbox-Nano is zero-shot, so the reference file IS the
registration. Registration, deletion and the boot reconcile resolve
paths via ``reference_path_for`` (allowlist + file_security
containment below); generation (``local_tts.clone_tts``) re-derives
the same path at its sink with the shared allowlist plus a resolve +
containment guard, because static analysis cannot credit containment
it cannot see dominating the use — the two sites must stay
semantically identical, and both are pinned by traversal tests.

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
from app.utils import file_security

# Voice keys are server-generated (u<hex>_<hex> from the store) and
# never contain separators or dots. A key that does can only arrive
# from a crafted persona voice_id — and the ownership check treats
# non-clone-shaped names as house voices allowed for everyone — so the
# registry sink itself refuses such keys instead of resolving them
# into paths outside the registry directory.
_VOICE_KEY_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]*$")


def is_valid_voice_key(voice_key: str) -> bool:
    """True for a plain registry key (no separators, dots, or empty)."""
    return bool(_VOICE_KEY_RE.match((voice_key or "").strip()))


def _validated_key_path(directory: Path, voice_key: str) -> Path:
    """The WAV path for ``voice_key`` inside ``directory``.

    Raises ValueError for any key that is not a plain registry key.
    The allowlist runs first; the joined path then goes through the
    repo's canonical containment resolver (realpath + commonpath), so
    a key that somehow slipped the allowlist still cannot escape
    ``directory``.
    """
    key = (voice_key or "").strip()
    if not is_valid_voice_key(key):
        raise ValueError("invalid cloned voice key")
    resolved = file_security.resolve_path_within_directory(
        str(directory), f"{key}.wav", require_file=False
    )
    return Path(resolved)


class VoiceRegistry(Protocol):
    def register_voice(self, voice_key: str, language_id: str, wav_bytes: bytes) -> None:
        ...

    def delete_voice(self, voice_key: str) -> None:
        ...

    def has_voice(self, voice_key: str) -> bool:
        ...


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

    def has_voice(self, voice_key: str) -> bool:
        try:
            target = _validated_key_path(self._dir, voice_key)
        except ValueError:
            # A malformed key names no file this registry could hold.
            return False
        return target.is_file()


def default_registry() -> VoiceRegistry:
    return LocalVoiceRegistry()
