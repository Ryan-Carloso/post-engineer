"""Orchestration for per-user Chatterbox voice cloning (local Nano)."""

from __future__ import annotations

import os
import tempfile
from datetime import datetime, timezone
from typing import Any

from loguru import logger

from app.services.analytics import track_event
from app.services.cloned_voices.audio import ReferenceAudioError, normalize_reference_audio
from app.services.cloned_voices.audio_clean import clean_reference_audio
from app.services.cloned_voices.local_registry import (
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
from app.services.local_tts import clone_tts
from app.services.persona import VOICE_SAMPLE_TEXTS


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
    """Complete pending registration (runs after the HTTP response).

    Never raises: this is a fire-and-forget background task, so an escaping
    exception would strand the row in ``pending`` with no signal. Store
    bookkeeping failures fall back to marking the row failed; if even that
    fails, the row stays pending and the boot reconcile retries it.
    """
    try:
        db = store or ClonedVoiceStore()
        reg = registry or default_registry()
    except Exception:
        logger.exception(f"cloned voice registration could not start, clone_id: {clone_id}")
        return
    marked_ready = False
    try:
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
        marked_ready = True
        _track_clone("voice_clone_succeeded", user_id, clone_id)
    except Exception:
        logger.exception(f"cloned voice registration bookkeeping failed, clone_id: {clone_id}")
        if marked_ready:
            return
        try:
            db.mark_failed(user_id, clone_id, ERROR_REGISTRY_FAILED)
        except Exception:
            logger.exception(f"cloned voice row stuck pending, clone_id: {clone_id}")


def reconcile_pending_registrations(
    store: ClonedVoiceStore | None = None,
    registry: VoiceRegistry | None = None,
) -> int:
    """Re-run registration for rows left pending by a restart.

    The background task that completes a registration does not survive the
    process, so at engine boot every ``pending`` row is orphaned: fetch its
    reference WAV back from storage and register it again. Runs only when
    the store env is configured (same skip pattern as the fill-schedule
    scheduler); never raises. Returns how many rows were picked up.
    """
    if store is None and not (
        os.getenv("SUPABASE_URL") and os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    ):
        return 0
    try:
        db = store or ClonedVoiceStore()
        pending = db.list_pending()
    except Exception:
        logger.exception("cloned voice pending reconcile could not list rows")
        return 0
    recovered = 0
    for row in pending:
        user_id = row.get("user_id")
        clone_id = row.get("id")
        storage_path = row.get("storage_path")
        if not (
            isinstance(user_id, str)
            and isinstance(clone_id, str)
            and isinstance(storage_path, str)
        ):
            continue
        try:
            wav_bytes = db.download_reference_wav(storage_path)
        except Exception:
            logger.exception(
                f"cloned voice pending reconcile could not fetch reference, clone_id: {clone_id}"
            )
            continue
        language = row.get("language")
        register_clone_in_background(
            user_id,
            clone_id,
            wav_bytes,
            language if isinstance(language, str) and language else "en",
            store=db,
            registry=registry,
        )
        recovered += 1
    if recovered:
        logger.info(f"re-ran registration for {recovered} pending cloned voice(s) at boot")
    return recovered


class ClonedVoiceService:
    def __init__(
        self,
        store: ClonedVoiceStore | None = None,
        registry: VoiceRegistry | None = None,
    ) -> None:
        self._store = store or ClonedVoiceStore()
        self._registry = registry

    def clean_preview_wav(self, source_bytes: bytes) -> bytes:
        """Cleaned reference WAV for the picker's A/B preview.

        Pure preview: nothing is stored. Clone creation re-runs the
        same chain when the user confirms with cleaning on, so what
        they heard is what gets cloned.
        """
        return clean_reference_audio(source_bytes).wav_bytes

    def create_from_upload(
        self,
        user_id: str,
        source_bytes: bytes,
        language: str,
        consent_acknowledged: bool,
        name: str | None = None,
        use_cleaned: bool = True,
    ) -> dict[str, Any]:
        if not consent_acknowledged:
            raise ReferenceAudioError(ERROR_CONSENT_REQUIRED, "voice cloning consent is required")

        # Default ON per product spec: clone from the cleaned reference
        # (denoise chain). Opt-outs clone from the plainly normalized one.
        normalized = (
            clean_reference_audio(source_bytes)
            if use_cleaned
            else normalize_reference_audio(source_bytes)
        )
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

        try:
            row = self._store.insert_pending(
                user_id=user_id,
                clone_id=clone_id,
                consent_at=consent_at,
                storage_path=storage_path,
                engine_voice_key=engine_voice_key,
                language=language.strip(),
                name=name.strip() if isinstance(name, str) and name.strip() else None,
            )
        except Exception:
            # The reference WAV is already in storage; without the row it
            # can never be reached by the delete path, so remove it now —
            # and say so loudly if even that fails.
            try:
                removed = self._store.delete_storage_object(storage_path)
            except Exception:
                removed = False
            if not removed:
                logger.error(
                    "cloned voice reference orphaned in storage, "
                    f"clone_id: {clone_id}, path: {storage_path}"
                )
            raise
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
            if not self._store.delete_storage_object(storage_path):
                # The row is still deleted below so the UI never gets stuck
                # on a voice whose storage object could not be removed; the
                # orphaned object stays diagnosable from this log line.
                logger.error(
                    "cloned voice storage object left orphaned, "
                    f"clone_id: {clone_id}, path: {storage_path}"
                )
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

        with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as tmp:
            tmp_path = tmp.name
        try:
            result = clone_tts(
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
