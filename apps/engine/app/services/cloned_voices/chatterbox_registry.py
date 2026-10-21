"""HTTP client for the Chatterbox voice registry (Modal admin API or compatible)."""

from __future__ import annotations

import base64
import os
from typing import Any, Protocol

import requests
from loguru import logger

from app.config import config as app_config


class VoiceRegistry(Protocol):
    def register_voice(self, voice_key: str, language_id: str, wav_bytes: bytes) -> None:
        ...

    def delete_voice(self, voice_key: str) -> None:
        ...


class RegistryNotConfiguredError(RuntimeError):
    """Raised when cloned-voice registration is not wired for this deployment."""


def _registry_settings() -> tuple[str, str]:
    section: dict[str, Any] = app_config.cloned_voices or {}
    base_url = (section.get("registry_base_url") or os.getenv("CHATTERBOX_REGISTRY_BASE_URL") or "").strip()
    api_key = (section.get("registry_api_key") or os.getenv("CHATTERBOX_REGISTRY_API_KEY") or "").strip()
    base_url = base_url.rstrip("/")
    return base_url, api_key


class HttpChatterboxVoiceRegistry:
    """POST/DELETE against a registry service that writes Modal volume references."""

    def __init__(
        self,
        base_url: str | None = None,
        api_key: str | None = None,
        requests_module: Any | None = None,
    ) -> None:
        configured_base, configured_key = _registry_settings()
        self._base_url = (base_url if base_url is not None else configured_base).rstrip("/")
        self._api_key = api_key if api_key is not None else configured_key
        self._requests = requests_module if requests_module is not None else requests

    def _headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self._api_key:
            headers["Authorization"] = f"Bearer {self._api_key}"
        return headers

    def register_voice(self, voice_key: str, language_id: str, wav_bytes: bytes) -> None:
        if not self._base_url:
            raise RegistryNotConfiguredError("cloned voice registry is not configured")
        payload = {
            "voice": voice_key,
            "language_id": language_id,
            "reference_wav_base64": base64.b64encode(wav_bytes).decode("ascii"),
        }
        response = self._requests.post(
            f"{self._base_url}/v1/voices",
            json=payload,
            headers=self._headers(),
            timeout=120,
        )
        if response.status_code >= 400:
            logger.error(
                "chatterbox registry register failed, "
                f"voice_key: {voice_key}, status: {response.status_code}"
            )
            raise RuntimeError(f"registry register failed with status {response.status_code}")

    def delete_voice(self, voice_key: str) -> None:
        if not self._base_url:
            raise RegistryNotConfiguredError("cloned voice registry is not configured")
        response = self._requests.delete(
            f"{self._base_url}/v1/voices/{voice_key}",
            headers=self._headers(),
            timeout=60,
        )
        if response.status_code in (404, 204, 200):
            return
        if response.status_code >= 400:
            logger.error(
                "chatterbox registry delete failed, "
                f"voice_key: {voice_key}, status: {response.status_code}"
            )
            raise RuntimeError(f"registry delete failed with status {response.status_code}")


def default_registry() -> VoiceRegistry:
    return HttpChatterboxVoiceRegistry()
