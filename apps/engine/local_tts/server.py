"""Local CPU TTS server — replaces the Modal Chatterbox app for all voices.

Runs next to the engine on the VPS (the ``tts`` service in
docker-compose.yml) and keeps the contract the engine already speaks:

    POST /v1/audio/speech      {"input", "voice", "response_format": wav|mp3}
    POST /v1/voices            per-user clone registration (reference WAV)
    DELETE /v1/voices/{voice}  per-user clone removal
    GET  /health

All routes require ``Authorization: Bearer <CHATTERBOX_HTTP_SECRET>``.
House voices (Phonon + Kokoro) resolve through the shared catalog; clones
live on the ``TTS_VOICES_DIR`` volume and synthesize with Chatterbox Nano.

Run locally:
    CHATTERBOX_HTTP_SECRET=... TTS_VOICES_DIR=./storage/tts-voices \\
        uvicorn local_tts.server:app --host 127.0.0.1 --port 4123
"""

from __future__ import annotations

import io
import os
import subprocess
import threading
import time
from pathlib import Path

import soundfile as sf
from fastapi import FastAPI, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse, Response
from loguru import logger

from local_tts import backends
from local_tts.routing import ALLOWED_FORMATS, ClonedVoice, resolve_voice
from modal_chatterbox_auth import authorize_request
from modal_chatterbox_registry_routes import mount_chatterbox_registry_routes

VOICES_DIR = Path(os.environ["TTS_VOICES_DIR"])
VOICES_CONFIG_PATH = VOICES_DIR / "voices.toml"
MAX_TEXT_CHARS = 2000
MAX_BODY_BYTES = 1_000_000
_STARTED = time.monotonic()


def _encode(samples, sample_rate: int, response_format: str) -> tuple[bytes, str]:
    buffer = io.BytesIO()
    sf.write(buffer, samples, sample_rate, format="WAV")
    wav_bytes = buffer.getvalue()
    if response_format == "wav":
        return wav_bytes, "audio/wav"
    result = subprocess.run(
        ["ffmpeg", "-y", "-f", "wav", "-i", "pipe:0", "-codec:a", "libmp3lame", "-q:a", "4", "-f", "mp3", "pipe:1"],
        input=wav_bytes,
        capture_output=True,
        timeout=120,
    )
    if result.returncode != 0 or not result.stdout:
        raise RuntimeError(f"wav->mp3 transcode failed: {result.stderr[-500:]!r}")
    return result.stdout, "audio/mpeg"


def _generate(text: str, voice: str, response_format: str) -> tuple[bytes, str]:
    target = resolve_voice(voice, VOICES_DIR, VOICES_CONFIG_PATH)
    if isinstance(target, ClonedVoice):
        samples, sample_rate = backends.synthesize_clone(target.reference_path, text)
    else:
        samples, sample_rate = backends.synthesize_preset(target.provider, target.model_voice, text)
    return _encode(samples, sample_rate, response_format)


def _error(status: int, message: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"error": message})


app = FastAPI(title="Local CPU TTS")


NANO_SWEEP_SECONDS = 30


def _sweep_idle_nano() -> None:
    while True:
        time.sleep(NANO_SWEEP_SECONDS)
        try:
            if backends.unload_idle_nano():
                logger.info("local tts: unloaded idle Chatterbox Nano")
        except Exception:
            logger.exception("local tts: idle Nano unload failed")


@app.on_event("startup")
def _prepare_voices_dir() -> None:
    VOICES_DIR.mkdir(parents=True, exist_ok=True)
    # Daemon thread: checks every NANO_SWEEP_SECONDS whether the clone model
    # has been idle long enough to free its ~3 GB.
    threading.Thread(target=_sweep_idle_nano, name="nano-idle-sweep", daemon=True).start()


@app.get("/health")
async def health(request: Request) -> JSONResponse:
    auth = authorize_request(request)
    if auth is not None:
        return auth
    return JSONResponse(
        content={
            "status": "ok",
            "models_loaded": backends.loaded_models(),
            "uptime_s": round(time.monotonic() - _STARTED, 1),
        }
    )


@app.post("/v1/audio/speech")
async def speech(request: Request) -> Response:
    auth = authorize_request(request)
    if auth is not None:
        return auth
    try:
        content_length = int(request.headers.get("content-length", "0") or 0)
    except ValueError:
        return _error(400, "invalid content-length")
    if content_length > MAX_BODY_BYTES:
        return _error(413, "request too large")
    try:
        payload = await request.json()
    except Exception:
        return _error(400, "invalid JSON body")
    if not isinstance(payload, dict):
        return _error(400, "invalid JSON body")

    text = str(payload.get("input", "") or "").strip()
    if not text:
        return _error(400, "input must not be empty")
    if len(text) > MAX_TEXT_CHARS:
        return _error(400, f"input exceeds {MAX_TEXT_CHARS} characters")
    voice = str(payload.get("voice", "") or "").strip()
    if not voice:
        return _error(400, "voice is required")
    response_format = str(payload.get("response_format", "wav") or "wav").lower()
    if response_format not in ALLOWED_FORMATS:
        return _error(400, f"response_format must be one of {list(ALLOWED_FORMATS)}")

    started = time.monotonic()
    try:
        audio_bytes, media_type = await run_in_threadpool(_generate, text, voice, response_format)
    except KeyError as error:
        # Voice names are not secret; the message is safe to return.
        return _error(404, str(error.args[0]))
    except Exception:
        # Log the failure only — never the input text or auth material.
        logger.exception(f"local tts generation failed, voice: {voice}")
        return _error(500, "generation failed")
    logger.info(
        f"local tts ok, voice: {voice}, format: {response_format}, "
        f"bytes: {len(audio_bytes)}, took_s: {round(time.monotonic() - started, 2)}"
    )
    return Response(content=audio_bytes, media_type=media_type)


mount_chatterbox_registry_routes(
    app,
    voices_dir=str(VOICES_DIR),
    voices_config_path=str(VOICES_CONFIG_PATH),
    # A local disk volume: writes are durable on return, nothing to commit.
    commit_volume=lambda: None,
    authorize=authorize_request,
)
