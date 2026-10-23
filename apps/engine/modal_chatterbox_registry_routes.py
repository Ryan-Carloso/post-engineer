"""Registry admin routes for the local TTS server (POST/DELETE /v1/voices)."""

from __future__ import annotations

from pathlib import Path
from typing import Callable

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from chatterbox_registry_volume import (
    delete_voice_on_volume,
    decode_reference_wav,
    is_user_clone_voice_name,
    is_valid_voice_name,
    register_voice_on_volume,
)


def mount_chatterbox_registry_routes(
    fastapi_app: FastAPI,
    *,
    voices_dir: str,
    voices_config_path: str,
    commit_volume: Callable[[], None],
    authorize: Callable[[Request], JSONResponse | None],
    reload_volume: Callable[[], None] | None = None,
) -> None:
    """Wire per-user clone registry endpoints onto the Chatterbox FastAPI app.

    Writes are read-modify-write on voices.toml: reload the volume first
    (when a reload hook is wired) so each write starts from the latest
    committed state. This narrows the lost-update window between
    concurrent containers to the reload-to-commit span; it is not a lock.
    """

    def _reload() -> None:
        if reload_volume is not None:
            reload_volume()

    @fastapi_app.post("/v1/voices")
    async def register_voice(request: Request) -> JSONResponse:
        auth = authorize(request)
        if auth is not None:
            return auth

        try:
            payload = await request.json()
        except Exception:
            return JSONResponse(status_code=400, content={"error": "invalid JSON body"})
        if not isinstance(payload, dict):
            return JSONResponse(status_code=400, content={"error": "invalid JSON body"})

        voice = str(payload.get("voice", "") or "").strip()
        language_id = str(payload.get("language_id", "pt") or "pt").strip() or "pt"
        reference_b64 = payload.get("reference_wav_base64")
        if not voice or not is_valid_voice_name(voice):
            return JSONResponse(status_code=400, content={"error": "voice must be a simple identifier"})
        if not is_user_clone_voice_name(voice):
            return JSONResponse(status_code=400, content={"error": "voice must be a user clone key"})
        if not isinstance(reference_b64, str) or not reference_b64.strip():
            return JSONResponse(status_code=400, content={"error": "reference_wav_base64 is required"})

        try:
            wav_bytes = decode_reference_wav(reference_b64.strip())
        except ValueError as error:
            return JSONResponse(status_code=400, content={"error": str(error)})

        try:
            _reload()
            register_voice_on_volume(
                Path(voices_dir),
                Path(voices_config_path),
                voice,
                language_id,
                wav_bytes,
            )
            commit_volume()
        except ValueError as error:
            return JSONResponse(status_code=400, content={"error": str(error)})
        except Exception:
            import loguru

            loguru.logger.exception("chatterbox registry register failed")
            return JSONResponse(status_code=500, content={"error": "registry write failed"})

        return JSONResponse(status_code=201, content={"voice": voice, "language_id": language_id})

    @fastapi_app.delete("/v1/voices/{voice}")
    async def unregister_voice(request: Request, voice: str) -> JSONResponse:
        auth = authorize(request)
        if auth is not None:
            return auth

        voice = voice.strip()
        if not voice or not is_valid_voice_name(voice):
            return JSONResponse(status_code=400, content={"error": "invalid voice"})
        if not is_user_clone_voice_name(voice):
            return JSONResponse(status_code=400, content={"error": "voice must be a user clone key"})

        try:
            _reload()
            removed = delete_voice_on_volume(
                Path(voices_dir),
                Path(voices_config_path),
                voice,
            )
            commit_volume()
        except ValueError as error:
            return JSONResponse(status_code=400, content={"error": str(error)})
        except Exception:
            import loguru

            loguru.logger.exception("chatterbox registry delete failed")
            return JSONResponse(status_code=500, content={"error": "registry delete failed"})

        if not removed:
            return JSONResponse(status_code=404, content={"error": "voice not found"})
        return JSONResponse(status_code=200, content={"voice": voice, "deleted": True})
