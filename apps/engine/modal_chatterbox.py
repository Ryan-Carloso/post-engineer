"""Modal serverless Chatterbox Multilingual TTS service.

Serves an OpenAI-compatible ``POST /v1/audio/speech`` endpoint backed by
Chatterbox Multilingual V3 (Resemble AI, MIT) with zero-shot voice cloning.
This is the server side of the engine's ``[chatterbox]`` TTS provider
(``app/services/voice.py::chatterbox_tts``), which talks to any server
exposing that contract — deploying this app gives you a scale-to-zero one.

Contract (subset honoured by the engine client):
    POST /v1/audio/speech
    Authorization: Bearer <CHATTERBOX_HTTP_SECRET>
    {"model": "...", "input": "...", "voice": "ryan",
     "response_format": "mp3" | "wav", "speed": 1.0}

``speed`` is accepted for contract parity but ignored: Chatterbox has no
speed control. ``response_format`` defaults to ``wav`` (native); ``mp3`` is
transcoded with FFmpeg because the engine client currently requests MP3.

Voices are logical names resolved from ``/voices/voices.toml`` on the
``chatterbox-voices`` volume — the client never sends filesystem paths:

    [ryan]
    reference = "ryan/reference.wav"   # relative to /voices
    language_id = "pt"                 # Chatterbox language code

One-time setup:

    uv run modal secret create chatterbox-http CHATTERBOX_HTTP_SECRET=...
    uv run modal run modal_chatterbox.py::download_weights
    uv run modal run modal_chatterbox.py::put_voices_config --path voices.toml
    uv run modal run modal_chatterbox.py::upload_reference \
        --voice ryan --path /path/to/reference.wav

Build a new voice from an approved recording (scripts/build_voice_reference.py
drives upload_reference + generate_to_file + put_voices_config for you):

    uv run modal run modal_chatterbox.py::generate_to_file \
        --voice ryan --text "..." --out sample.wav

Validate, then deploy:

    uv run modal run modal_chatterbox.py::validate --voice ryan
    uv run modal deploy modal_chatterbox.py

Per-user clone registry: ``POST/DELETE /v1/voices`` (see ``modal_chatterbox_registry_routes``).
Point engine ``[cloned_voices] registry_base_url`` at this app; same bearer as speech.
"""

from __future__ import annotations

import os
import subprocess
import tempfile
import threading
import time
from pathlib import Path

import modal

from fastapi import FastAPI, Request
from modal_chatterbox_auth import authorize_request
from modal_chatterbox_registry_routes import mount_chatterbox_registry_routes
from fastapi.responses import JSONResponse, Response

# ── Configuration ────────────────────────────────────────────────────────────

APP_NAME = "moneyprint-chatterbox"
MODEL_REPO = "ResembleAI/chatterbox"
GPU = "T4"  # 16 GB VRAM is ample for the 0.5B model; see the benchmark phase.
MODEL_TIMEOUT = 600  # generous headroom for cold start + long generations
SCALEDOWN_WINDOW = 300  # seconds a warm (billed) container waits idle
MAX_CONTAINERS = 1
# Concurrency cap: each generation holds the GPU; 2 keeps VRAM/latency sane
# on the T4 without serialising short clips.
MAX_CONCURRENT_INPUTS = 2

MODELS_VOLUME = modal.Volume.from_name("chatterbox-models", create_if_missing=True)
VOICES_VOLUME = modal.Volume.from_name("chatterbox-voices", create_if_missing=True)
VOICES_DIR = "/voices"
VOICES_CONFIG_PATH = "/voices/voices.toml"
# The engine's chatterbox client caps nothing; the service rejects oversized
# scripts instead of silently burning GPU minutes on them.
MAX_TEXT_CHARS = int(os.environ.get("CHATTERBOX_MAX_TEXT_CHARS", "2000"))
MAX_BODY_BYTES = 1_000_000
ALLOWED_FORMATS = ("wav", "mp3")

CHATTERBOX_IMAGE = (
    modal.Image.from_registry(
        # Match the pinned chatterbox-tts dependency set (torch 2.6.0, cu124).
        "pytorch/pytorch:2.6.0-cuda12.4-cudnn9-runtime",
        add_python="3.11",
    )
    .apt_install("git", "ffmpeg")
    .pip_install(
        "torch==2.6.0",
        "torchaudio==2.6.0",
        index_url="https://download.pytorch.org/whl/cu124",
    )
    .pip_install(
        # chatterbox-tts on PyPI (0.1.7) predates Multilingual V3; install
        # from a pinned master commit instead (V3 lives only on master).
        "chatterbox-tts @ git+https://github.com/resemble-ai/chatterbox.git@5de7a54aa4e5e2baadb0182dde554908b48b85c2",
        "fastapi[standard]",
        # The speech handler imports loguru at request time; without it every
        # /v1/audio/speech call returned 500 "No module named 'loguru'".
        "loguru",
    )
    .env(
        {
            # Cache HF downloads on the persistent volume so cold starts do
            # not re-download the checkpoints on every container boot.
            "HF_HOME": "/models/hf",
            "HF_HUB_DISABLE_TELEMETRY": "1",
        }
    )
)

app = modal.App(APP_NAME)


# ── Model loading (lazy, once per container) ─────────────────────────────────

_model = None
_model_lock = threading.Lock()
_CONTAINER_START = time.monotonic()


def _get_model():
    """Load Chatterbox Multilingual V3 once per container (thread-safe)."""
    global _model
    if _model is None:
        with _model_lock:
            if _model is None:
                from chatterbox.mtl_tts import ChatterboxMultilingualTTS

                _model = ChatterboxMultilingualTTS.from_pretrained(
                    device="cuda",
                    t3_model="v3",
                )
    return _model


def model_ready() -> bool:
    return _model is not None


# ── Voices config ────────────────────────────────────────────────────────────


def _load_voices_config() -> dict[str, dict[str, str]]:
    """Parse voices.toml into {name: {reference, language_id}}."""
    import tomllib

    # A warm container mounts a possibly stale snapshot: freshly uploaded
    # voices (setup entrypoints) are only visible after an explicit reload.
    VOICES_VOLUME.reload()

    with open(VOICES_CONFIG_PATH, "rb") as f:
        raw = tomllib.load(f)
    voices: dict[str, dict[str, str]] = {}
    for name, section in raw.items():
        if not isinstance(section, dict):
            continue
        reference = str(section.get("reference", "")).strip()
        if not reference:
            continue
        voices[str(name)] = {
            "reference": reference,
            "language_id": str(section.get("language_id", "pt")).strip() or "pt",
        }
    return voices


def _resolve_reference_path(reference: str) -> Path:
    """Resolve a configured reference path under /voices, refusing escapes.

    The reference comes from our own voices.toml (not the client), but a
    misconfigured absolute path or `../` traversal would silently read
    arbitrary files — fail loudly instead. References may live in
    subdirectories (e.g. "ryan/reference.wav"), so containment is checked
    against the whole subtree, not just the direct parent.
    """
    voices_root = Path(VOICES_DIR).resolve()
    resolved = (voices_root / reference).resolve()
    if voices_root not in resolved.parents:
        raise ValueError(f"reference path escapes the voices volume: {reference!r}")
    return resolved


def _generate_audio(text: str, voice: str, response_format: str) -> tuple[bytes, str]:
    """Generate cloned-voice audio and return (bytes, media_type)."""
    import torchaudio

    voices = _load_voices_config()
    voice_config = voices.get(voice)
    if voice_config is None:
        raise KeyError(f"unknown voice: {voice}")

    reference = _resolve_reference_path(voice_config["reference"])
    if not reference.is_file():
        raise FileNotFoundError(f"reference audio missing for voice: {voice}")

    model = _get_model()
    wav = model.generate(
        text,
        language_id=voice_config["language_id"],
        audio_prompt_path=str(reference),
    )

    media_type = "audio/wav" if response_format == "wav" else "audio/mpeg"
    with tempfile.TemporaryDirectory(prefix="chatterbox-") as work:
        wav_path = Path(work) / "out.wav"
        torchaudio.save(str(wav_path), wav, model.sr)
        if response_format == "wav":
            return wav_path.read_bytes(), media_type

        mp3_path = Path(work) / "out.mp3"
        result = subprocess.run(
            [
                "ffmpeg", "-y", "-i", str(wav_path),
                "-codec:a", "libmp3lame", "-q:a", "4",
                str(mp3_path),
            ],
            capture_output=True,
            text=True,
            timeout=120,
        )
        if result.returncode != 0 or not mp3_path.is_file():
            raise RuntimeError(
                f"wav->mp3 transcode failed: {(result.stderr or '')[-500:]}"
            )
        return mp3_path.read_bytes(), media_type


# ── HTTP endpoints ───────────────────────────────────────────────────────────


def _build_fastapi_app():
    fastapi_app = FastAPI(title="Chatterbox TTS (Modal)")

    @fastapi_app.get("/health")
    async def health(request: Request) -> JSONResponse:
        # Authenticated too: an unauthenticated probe must not even confirm
        # the service exists or reveal cold/warm state.
        auth = authorize_request(request)
        if auth is not None:
            return auth
        return JSONResponse(
            content={
                "status": "ok" if model_ready() else "loading",
                "uptime_s": round(time.monotonic() - _CONTAINER_START, 1),
            }
        )

    @fastapi_app.post("/v1/audio/speech")
    async def speech(request: Request) -> Response:
        auth = authorize_request(request)
        if auth is not None:
            return auth

        try:
            content_length = int(request.headers.get("content-length", "0") or 0)
        except ValueError:
            return JSONResponse(status_code=400, content={"error": "invalid content-length"})
        if content_length > MAX_BODY_BYTES:
            return JSONResponse(status_code=413, content={"error": "request too large"})

        try:
            payload = await request.json()
        except Exception:
            return JSONResponse(status_code=400, content={"error": "invalid JSON body"})
        if not isinstance(payload, dict):
            return JSONResponse(status_code=400, content={"error": "invalid JSON body"})

        text = str(payload.get("input", "") or "").strip()
        if not text:
            return JSONResponse(status_code=400, content={"error": "input must not be empty"})
        if len(text) > MAX_TEXT_CHARS:
            return JSONResponse(
                status_code=400,
                content={"error": f"input exceeds {MAX_TEXT_CHARS} characters"},
            )

        voice = str(payload.get("voice", "") or "").strip()
        if not voice:
            return JSONResponse(status_code=400, content={"error": "voice is required"})

        response_format = str(payload.get("response_format", "wav") or "wav").lower()
        if response_format not in ALLOWED_FORMATS:
            return JSONResponse(
                status_code=400,
                content={"error": f"response_format must be one of {list(ALLOWED_FORMATS)}"},
            )

        started = time.monotonic()
        try:
            audio_bytes, media_type = _generate_audio(text, voice, response_format)
        except KeyError as error:
            # Unknown voice: 404, message is safe (voice names are not secret).
            return JSONResponse(status_code=404, content={"error": str(error.args[0])})
        except FileNotFoundError:
            import loguru

            loguru.logger.exception("chatterbox generation failed (file not found)")
            return JSONResponse(status_code=500, content={"error": "generation failed"})
        except Exception:
            # Log the class only — never the input text or auth material.
            import loguru

            loguru.logger.exception("chatterbox generation failed")
            return JSONResponse(status_code=500, content={"error": "generation failed"})

        elapsed = round(time.monotonic() - started, 2)
        import loguru

        loguru.logger.info(
            f"chatterbox speech ok, voice: {voice}, format: {response_format}, "
            f"bytes: {len(audio_bytes)}, took_s: {elapsed}"
        )
        return Response(content=audio_bytes, media_type=media_type)

    mount_chatterbox_registry_routes(
        fastapi_app,
        voices_dir=VOICES_DIR,
        voices_config_path=VOICES_CONFIG_PATH,
        commit_volume=VOICES_VOLUME.commit,
        authorize=authorize_request,
        reload_volume=VOICES_VOLUME.reload,
    )

    return fastapi_app


@app.function(
    image=CHATTERBOX_IMAGE,
    gpu=GPU,
    volumes={
        "/models": MODELS_VOLUME,
        VOICES_DIR: VOICES_VOLUME,
    },
    secrets=[modal.Secret.from_name("chatterbox-http")],
    timeout=MODEL_TIMEOUT,
    scaledown_window=SCALEDOWN_WINDOW,
    max_containers=MAX_CONTAINERS,
)
@modal.concurrent(max_inputs=MAX_CONCURRENT_INPUTS)
@modal.asgi_app(label="chatterbox")
def chatterbox_api():
    """ASGI entrypoint; the model lazy-loads inside the warm container."""
    return _build_fastapi_app()


# ── Setup / ops functions (run manually via `modal run`) ────────────────────


@app.function(
    image=CHATTERBOX_IMAGE,
    volumes={"/models": MODELS_VOLUME},
    timeout=3600,
)
def download_weights() -> str:
    """Populate the HF cache on the persistent volume with the exact files
    from_pretrained needs (correct hub layout), by loading once on CPU."""
    from chatterbox.mtl_tts import ChatterboxMultilingualTTS

    print(f"caching {MODEL_REPO} via from_pretrained on cpu", flush=True)
    model = ChatterboxMultilingualTTS.from_pretrained(device="cpu", t3_model="v3")
    del model
    MODELS_VOLUME.commit()
    return f"{MODEL_REPO} cached in the chatterbox-models volume (HF_HOME layout)"


@app.function(image=CHATTERBOX_IMAGE, volumes={VOICES_DIR: VOICES_VOLUME}, timeout=120)
def write_reference(voice: str, data: bytes) -> str:
    """Persist one voice reference sample (uploaded from a local entrypoint)."""
    if not voice or not voice.isidentifier():
        raise ValueError("voice must be a simple identifier")
    destination = Path(VOICES_DIR) / voice / "reference.wav"
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(data)
    VOICES_VOLUME.commit()
    return f"stored {destination} ({len(data)} bytes)"


@app.function(image=CHATTERBOX_IMAGE, volumes={VOICES_DIR: VOICES_VOLUME}, timeout=120)
def write_voices_config(data: bytes) -> str:
    """Replace voices.toml on the volume (uploaded from a local entrypoint)."""
    Path(VOICES_CONFIG_PATH).write_bytes(data)
    VOICES_VOLUME.commit()
    return f"stored {VOICES_CONFIG_PATH} ({len(data)} bytes)"


@app.function(
    image=CHATTERBOX_IMAGE,
    gpu=GPU,
    volumes={
        "/models": MODELS_VOLUME,
        VOICES_DIR: VOICES_VOLUME,
    },
    secrets=[modal.Secret.from_name("chatterbox-http")],
    timeout=MODEL_TIMEOUT,
)
def generate_test(voice: str, text: str, response_format: str = "mp3") -> int:
    """Generate audio in-place (no HTTP hop) to validate a voice after setup."""
    audio_bytes, _media_type = _generate_audio(text, voice, response_format)
    return len(audio_bytes)


@app.local_entrypoint()
def upload_reference(voice: str, path: str) -> None:
    """Upload a local reference sample: modal run modal_chatterbox.py::upload_reference --voice ryan --path ref.wav"""
    data = Path(path).read_bytes()
    print(write_reference.remote(voice, data))


@app.local_entrypoint()
def put_voices_config(path: str) -> None:
    """Upload voices.toml: modal run modal_chatterbox.py::put_voices_config --path voices.toml"""
    print(write_voices_config.remote(Path(path).read_bytes()))


@app.function(
    image=CHATTERBOX_IMAGE,
    gpu=GPU,
    volumes={
        "/models": MODELS_VOLUME,
        VOICES_DIR: VOICES_VOLUME,
    },
    secrets=[modal.Secret.from_name("chatterbox-http")],
    timeout=MODEL_TIMEOUT,
)
def generate_bytes(voice: str, text: str) -> bytes:
    """Generate one clip remotely and return the raw audio bytes."""
    audio_bytes, _media_type = _generate_audio(text, voice, "wav")
    return audio_bytes


@app.local_entrypoint()
def generate_to_file(voice: str, text: str, out: str) -> None:
    """Generate audio and save it locally (used by the voice build script).

    modal run modal_chatterbox.py::generate_to_file --voice ryan --text "..." --out out.wav
    """
    audio_bytes = generate_bytes.remote(voice, text)
    Path(out).write_bytes(audio_bytes)
    print(f"saved {out} ({len(audio_bytes)} bytes)")


@app.local_entrypoint()
def generate_many_to_dir(voice: str, texts_json: str, out_dir: str) -> None:
    """Generate several clips for one voice inside a single warm container.

    The voice build script passes a JSON file with {"texts": [...]} so all
    lines share one warm GPU container instead of paying a cold start per
    line: modal run modal_chatterbox.py::generate_many_to_dir --voice v --texts-json t.json --out-dir d/
    """
    import json

    texts = json.loads(Path(texts_json).read_text(encoding="utf-8"))["texts"]
    out_path = Path(out_dir)
    out_path.mkdir(parents=True, exist_ok=True)
    for i, text in enumerate(texts):
        audio_bytes = generate_bytes.remote(voice, text)
        (out_path / f"part_{i}.wav").write_bytes(audio_bytes)
        print(f"saved part_{i}.wav ({len(audio_bytes)} bytes)")


@app.local_entrypoint()
def validate(
    voice: str = "ryan",
    text: str = "Olá, este é um teste de geração de voz com clonagem.",
    response_format: str = "mp3",
) -> None:
    """Smoke-test a deployed voice: modal run modal_chatterbox.py::validate"""
    started = time.monotonic()
    size = generate_test.remote(voice, text, response_format)
    print(f"ok: {size} bytes in {time.monotonic() - started:.1f}s")
