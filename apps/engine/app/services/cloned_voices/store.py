"""Supabase persistence and storage for cloned voices."""

from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone
from typing import Any

import requests
from loguru import logger

from app.services.cloned_voices.constants import (
    CLONED_VOICES_STORAGE_BUCKET,
    STATUS_FAILED,
    STATUS_PENDING,
    STATUS_READY,
)
from app.utils.supabase_retry import build_retrying_session

REQUEST_TIMEOUT_SECONDS = (10, 60)


class ClonedVoiceStore:
    """Service-role access to cloned_voices + personas bucket objects."""

    def __init__(
        self,
        url: str | None = None,
        service_key: str | None = None,
        requests_module: Any | None = None,
    ) -> None:
        base_url = url or os.getenv("SUPABASE_URL")
        key = service_key or os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        if not base_url:
            raise RuntimeError("SUPABASE_URL is required for cloned_voices")
        if not key:
            raise RuntimeError("SUPABASE_SERVICE_ROLE_KEY is required for cloned_voices")
        self._requests = requests_module if requests_module is not None else build_retrying_session()
        self._base_url = base_url.rstrip("/")
        self._key = key
        self._headers = {
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        }

    def _rest(self, method: str, path: str, **kwargs: Any) -> requests.Response:
        return self._requests.request(
            method,
            f"{self._base_url}/rest/v1/{path}",
            headers=kwargs.pop("headers", self._headers),
            timeout=REQUEST_TIMEOUT_SECONDS,
            **kwargs,
        )

    @staticmethod
    def storage_path_for(user_id: str, clone_id: str) -> str:
        return f"{user_id}/cloned-voices/{clone_id}/reference.wav"

    @staticmethod
    def make_engine_voice_key(user_id: str, clone_id: str) -> str:
        user_part = user_id.replace("-", "")[:12]
        clone_part = clone_id.replace("-", "")[:12]
        key = f"u{user_part}_{clone_part}"
        if not key.isidentifier():
            raise ValueError("engine voice key is not a valid identifier")
        return key

    def insert_pending(
        self,
        user_id: str,
        clone_id: str,
        consent_at: datetime,
        storage_path: str,
        engine_voice_key: str,
        language: str,
    ) -> dict[str, Any]:
        row = {
            "id": clone_id,
            "user_id": user_id,
            "status": STATUS_PENDING,
            "consent_at": consent_at.isoformat(),
            "storage_path": storage_path,
            "engine_voice_key": engine_voice_key,
            "language": language,
        }
        response = self._rest(
            "POST",
            "cloned_voices",
            json=row,
            headers={**self._headers, "Prefer": "return=representation"},
        )
        response.raise_for_status()
        data = response.json()
        if isinstance(data, list) and data:
            return data[0]
        if isinstance(data, dict):
            return data
        raise RuntimeError("unexpected cloned_voices insert response")

    def upload_reference_wav(self, storage_path: str, wav_bytes: bytes) -> None:
        upload_headers = {
            "apikey": self._key,
            "Authorization": f"Bearer {self._key}",
            "Content-Type": "audio/wav",
            "x-upsert": "true",
        }
        response = self._requests.post(
            f"{self._base_url}/storage/v1/object/{CLONED_VOICES_STORAGE_BUCKET}/{storage_path}",
            headers=upload_headers,
            data=wav_bytes,
            timeout=REQUEST_TIMEOUT_SECONDS,
        )
        if response.status_code >= 400:
            logger.error(
                "cloned voice storage upload failed, "
                f"status: {response.status_code}, path_prefix: {storage_path.split('/', 1)[0]}"
            )
            response.raise_for_status()

    def delete_storage_object(self, storage_path: str) -> bool:
        response = self._requests.delete(
            f"{self._base_url}/storage/v1/object/{CLONED_VOICES_STORAGE_BUCKET}",
            headers={
                "apikey": self._key,
                "Authorization": f"Bearer {self._key}",
                "Content-Type": "application/json",
            },
            json={"prefixes": [storage_path]},
            timeout=REQUEST_TIMEOUT_SECONDS,
        )
        if response.status_code >= 400:
            logger.warning(
                "cloned voice storage delete failed, "
                f"status: {response.status_code}, path: {storage_path}"
            )
            return False
        return True

    def get_for_user(self, user_id: str, clone_id: str) -> dict[str, Any] | None:
        response = self._rest(
            "GET",
            "cloned_voices",
            params={
                "id": f"eq.{clone_id}",
                "user_id": f"eq.{user_id}",
                "select": "*",
            },
        )
        response.raise_for_status()
        rows = response.json()
        if not rows:
            return None
        return rows[0]

    def list_for_user(self, user_id: str) -> list[dict[str, Any]]:
        response = self._rest(
            "GET",
            "cloned_voices",
            params={
                "user_id": f"eq.{user_id}",
                "select": "id,status,language,engine_voice_key,error_code,created_at,updated_at,consent_at",
                "order": "created_at.desc",
            },
        )
        response.raise_for_status()
        return list(response.json() or [])

    def list_ready_for_user(self, user_id: str) -> list[dict[str, Any]]:
        response = self._rest(
            "GET",
            "cloned_voices",
            params={
                "user_id": f"eq.{user_id}",
                "status": f"eq.{STATUS_READY}",
                "select": "engine_voice_key,language",
            },
        )
        response.raise_for_status()
        return list(response.json() or [])

    def mark_ready(self, user_id: str, clone_id: str) -> None:
        self._patch_status(user_id, clone_id, STATUS_READY, error_code=None)

    def mark_failed(self, user_id: str, clone_id: str, error_code: str) -> None:
        self._patch_status(user_id, clone_id, STATUS_FAILED, error_code=error_code)

    def _patch_status(
        self,
        user_id: str,
        clone_id: str,
        status: str,
        error_code: str | None,
    ) -> None:
        payload: dict[str, Any] = {
            "status": status,
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "error_code": error_code,
        }
        response = self._rest(
            "PATCH",
            "cloned_voices",
            params={"id": f"eq.{clone_id}", "user_id": f"eq.{user_id}"},
            json=payload,
        )
        response.raise_for_status()

    def delete_row(self, user_id: str, clone_id: str) -> bool:
        response = self._rest(
            "DELETE",
            "cloned_voices",
            params={"id": f"eq.{clone_id}", "user_id": f"eq.{user_id}"},
            headers={**self._headers, "Prefer": "return=minimal"},
        )
        if response.status_code == 204:
            return True
        response.raise_for_status()
        return False

    @staticmethod
    def new_clone_id() -> str:
        return str(uuid.uuid4())
