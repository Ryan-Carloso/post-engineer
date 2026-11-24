"""Fetch a clone's reference WAV from Supabase Storage into the worker.

The upload already lives in the ``personas`` bucket at
``cloned_voices.storage_path``. The local TTS server only sees a file
under ``TTS_VOICES_DIR``, so the worker downloads once per container
and writes the same ``voices.toml`` layout the registry uses.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from app.services.cloned_voices.constants import CHATTERBOX_NANO_VOICE_PREFIX
from app.services.cpu_worker_dispatch import _voice_names
from chatterbox_registry_volume import load_voices_toml, register_voice_on_volume


def clone_engine_key(params: Any) -> str | None:
    """The ``cloned_voices.engine_voice_key`` for a clone job, or None."""
    for name in _voice_names(params):
        if name.startswith(CHATTERBOX_NANO_VOICE_PREFIX):
            return name[len(CHATTERBOX_NANO_VOICE_PREFIX):]
    return None


def materialize_clone(params: Any, voices_dir: Path, store: Any | None = None) -> bool:
    """Download the reference if this job is a clone. True when a file was written.

    A file already present for that voice is the per-container cache.
    """
    key = clone_engine_key(params)
    if key is None:
        return False
    voices_dir.mkdir(parents=True, exist_ok=True)
    config_path = voices_dir / "voices.toml"
    cached = voices_dir / key / "reference.wav"
    if cached.is_file() and key in load_voices_toml(config_path):
        return False
    db = store if store is not None else _store()
    row = db.get_ready_by_engine_voice_key(key)
    if not isinstance(row, dict):
        raise RuntimeError(f"clone {key} is not a ready cloned_voices row")
    storage_path = row.get("storage_path")
    if not isinstance(storage_path, str) or not storage_path:
        raise RuntimeError(f"clone {key} has no storage_path")
    wav_bytes = db.download_reference_wav(storage_path)
    if not isinstance(wav_bytes, (bytes, bytearray)) or not wav_bytes:
        raise RuntimeError(f"clone {key} reference download was empty")
    language = row.get("language")
    language_id = language.strip() if isinstance(language, str) and language.strip() else "en"
    register_voice_on_volume(voices_dir, config_path, key, language_id, bytes(wav_bytes))
    return True


def _store() -> Any:
    from app.services.cloned_voices.store import ClonedVoiceStore

    return ClonedVoiceStore()
