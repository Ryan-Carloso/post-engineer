"""Orchestration for per-user Chatterbox voice cloning."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from loguru import logger

from app.services.analytics import track_event
from app.services.cloned_voices.audio import ReferenceAudioError, normalize_reference_audio
from app.services.cloned_voices.chatterbox_registry import (
    RegistryNotConfiguredError,
    VoiceRegistry,
    default_registry,
)
from app.services.cloned_voices.constants import (
    CHATTERBOX_VOICE_PREFIX,
    ERROR_CONSENT_REQUIRED,
    ERROR_NOT_FOUND,
    ERROR_NOT_READY,
    ERROR_PREVIEW_FAILED,
    ERROR_REGISTRY_FAILED,
    ERROR_REGISTRY_NOT_CONFIGURED,
    ERROR_STORAGE_UPLOAD_FAILED,
    STATUS_READY,
)
from app.services.cloned_voices.store import ClonedVoiceStore
from app.services.persona import VOICE_SAMPLE_TEXTS
from app.services.voice_providers import chatterbox_tts


def _catalog_voice_id(engine_voice_key: str) -> str:
    return f"{CHATTERBOX_VOICE_PREFIX}{engine_voice_key}"


def list_catalog_entries(user_id: str, store: ClonedVoiceStore | None = None) -> list[dict[str, str]]:
    """Ready cloned voices for merging into the house voice catalog."""
    db = store or ClonedVoiceStore()
    entries: list[dict[str, str]] = []
    for row in db.list_ready_for_user(user_id):
        key = row.get("engine_voice_key")
        if isinstance(key, str) and key:
            entries.append({"id": _catalog_voice_id(key)})
    return entries


def _track_clone(event: str, user_id: str, clone_id: str, error_code: str | None = None) -> None:
    props: dict[str, Any] = {"clone_id": clone_id, "user_id": user_id}
    if error_code:
        props["reason"] = error_code
    track_event(event, props)


def register_clone_in_background(
    user_id: str,
    clone_id: str,
    wav_bytes: bytes,
    language: str,
    store: ClonedVoiceStore | None = None,
    registry: VoiceRegistry | None = None,
) -> None:
    """Complete pending registration (runs after the HTTP response)."""
    db = store or ClonedVoiceStore()
    reg = registry or default_registry()
    row = db.get_for_user(user_id, clone_id)
    if row is None:
        logger.error(f"cloned voice row missing during registration, clone_id: {clone_id}")
        return
    voice_key = row.get("engine_voice_key")
    if not isinstance(voice_key, str) or not voice_key:
        db.mark_failed(user_id, clone_id, ERROR_REGISTRY_FAILED)
        _track_clone("voice_clone_failed", user_id, clone_id, ERROR_REGISTRY_FAILED)
        return
    try:
        reg.register_voice(voice_key, language, wav_bytes)
    except RegistryNotConfiguredError:
        db.mark_failed(user_id, clone_id, ERROR_REGISTRY_NOT_CONFIGURED)
        _track_clone("voice_clone_failed", user_id, clone_id, ERROR_REGISTRY_NOT_CONFIGURED)
        return
    except Exception:
        logger.exception(f"cloned voice registry failed, clone_id: {clone_id}")
        db.mark_failed(user_id, clone_id, ERROR_REGISTRY_FAILED)
        _track_clone("voice_clone_failed", user_id, clone_id, ERROR_REGISTRY_FAILED)
        return
    db.mark_ready(user_id, clone_id)
    _track_clone("voice_clone_succeeded", user_id, clone_id)


class ClonedVoiceService:
    def __init__(
        self,
        store: ClonedVoiceStore | None = None,
        registry: VoiceRegistry | None = None,
    ) -> None:
        self._store = store or ClonedVoiceStore()
        self._registry = registry

    def create_from_upload(
        self,
        user_id: str,
        source_bytes: bytes,
        language: str,
        consent_acknowledged: bool,
    ) -> dict[str, Any]:
        if not consent_acknowledged:
            raise ReferenceAudioError(ERROR_CONSENT_REQUIRED, "voice cloning consent is required")

        normalized = normalize_reference_audio(source_bytes)
        clone_id = self._store.new_clone_id()
        engine_voice_key = self._store.make_engine_voice_key(user_id, clone_id)
        storage_path = self._store.storage_path_for(user_id, clone_id)
        consent_at = datetime.now(timezone.utc)

        try:
            self._store.upload_reference_wav(storage_path, normalized.wav_bytes)
        except Exception:
            logger.exception(f"cloned voice storage upload failed, clone_id: {clone_id}")
            raise ReferenceAudioError(
                ERROR_STORAGE_UPLOAD_FAILED,
                "could not store reference audio",
            )

        row = self._store.insert_pending(
            user_id=user_id,
            clone_id=clone_id,
            consent_at=consent_at,
            storage_path=storage_path,
            engine_voice_key=engine_voice_key,
            language=language.strip(),
        )
        _track_clone("voice_clone_started", user_id, clone_id)
        return {
            "row": row,
            "wav_bytes": normalized.wav_bytes,
            "language": language.strip(),
        }

    def complete_registration(
        self,
        user_id: str,
        clone_id: str,
        wav_bytes: bytes,
        language: str,
    ) -> None:
        register_clone_in_background(
            user_id,
            clone_id,
            wav_bytes,
            language,
            store=self._store,
            registry=self._registry,
        )

    def delete(self, user_id: str, clone_id: str) -> bool:
        row = self._store.get_for_user(user_id, clone_id)
        if row is None:
            return False
        voice_key = row.get("engine_voice_key")
        reg = self._registry if self._registry is not None else default_registry()
        if isinstance(voice_key, str) and voice_key:
            try:
                reg.delete_voice(voice_key)
            except RegistryNotConfiguredError:
                logger.warning(
                    "cloned voice delete skipped registry (not configured), "
                    f"clone_id: {clone_id}"
                )
            except Exception:
                logger.exception(
                    f"cloned voice registry delete failed, clone_id: {clone_id}"
                )
        storage_path = row.get("storage_path")
        if isinstance(storage_path, str) and storage_path:
            self._store.delete_storage_object(storage_path)
        return self._store.delete_row(user_id, clone_id)

    def preview_mp3(self, user_id: str, clone_id: str, language: str | None = None) -> bytes:
        row = self._store.get_for_user(user_id, clone_id)
        if row is None:
            raise ReferenceAudioError(ERROR_NOT_FOUND, "cloned voice not found")
        if row.get("status") != STATUS_READY:
            raise ReferenceAudioError(ERROR_NOT_READY, "cloned voice is not ready")
        voice_key = row.get("engine_voice_key")
        if not isinstance(voice_key, str) or not voice_key:
            raise ReferenceAudioError(ERROR_PREVIEW_FAILED, "cloned voice is misconfigured")
        lang = (language or row.get("language") or "en").strip().lower()
        sample_text = VOICE_SAMPLE_TEXTS.get(lang) or VOICE_SAMPLE_TEXTS.get("en-us", "")
        import tempfile
        import os

        with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as tmp:
            tmp_path = tmp.name
        try:
            result = chatterbox_tts(
                sample_text,
                voice_key,
                tmp_path,
                voice_rate=1.0,
                voice_volume=1.0,
            )
            if result.error:
                raise ReferenceAudioError(ERROR_PREVIEW_FAILED, "preview synthesis failed")
            with open(tmp_path, "rb") as audio_file:
                return audio_file.read()
        finally:
            try:
                os.remove(tmp_path)
            except OSError:
                pass
