"""Run one video pipeline inside a Modal CPU container (modal_cpu_worker.py).

The container has no ``config.toml`` and no TTS service next to it. Before
anything imports ``app.config``, ``prepare`` writes the engine config from
the ``ENGINE_CONFIG_TOML`` secret and points the Chatterbox client at a TTS
server this container starts on loopback, with a bearer secret made for
this container. The TTS server runs in its own virtualenv (torch and the
TTS models do not share the engine's dependency set), so it is a separate
process, but its lock only serializes this container's speech.

A clone voice has no reference WAV in the container. ``stage_clone_voice``
downloads the original from Supabase Storage and registers it on the
container's voices directory, where the TTS server reads it.

Nothing here imports ``app.config`` at module level.
"""

from __future__ import annotations

import os
import secrets
import subprocess
import time
from pathlib import Path
from typing import Any, Callable, MutableMapping

CONFIG_ENV = "ENGINE_CONFIG_TOML"
TTS_PYTHON_ENV = "TTS_PYTHON"
TTS_HOST = "127.0.0.1"
TTS_PORT = 4123
TTS_START_TIMEOUT_SECONDS = 180.0
CLONE_PREFIX = "chatterbox_nano:"
GENDER_SUFFIXES = ("-Female", "-Male")

_tts_process: subprocess.Popen | None = None


def write_engine_config(engine_root: Path, environ: MutableMapping[str, str]) -> Path:
    """Write ``config.toml`` from the secret; fail when the secret is absent."""
    text = environ.get(CONFIG_ENV)
    if text is None or not text.strip():
        raise RuntimeError(f"{CONFIG_ENV} is not set: the worker has no engine config")
    path = engine_root / "config.toml"
    path.write_text(text, encoding="utf-8")
    return path


def tts_environment(secret: str, voices_dir: Path) -> dict[str, str]:
    """The variables both the engine client and the TTS server read."""
    return {
        "CHATTERBOX_HTTP_SECRET": secret,
        "MPT_CHATTERBOX_API_KEY": secret,
        "MPT_CHATTERBOX_BASE_URL": f"http://{TTS_HOST}:{TTS_PORT}/v1",
        "TTS_VOICES_DIR": str(voices_dir),
    }


def prepare(
    engine_root: Path, voices_dir: Path, environ: MutableMapping[str, str]
) -> None:
    """Config file and TTS variables, once per container."""
    if environ.get("CHATTERBOX_HTTP_SECRET"):
        return
    write_engine_config(engine_root, environ)
    voices_dir.mkdir(parents=True, exist_ok=True)
    environ.update(tts_environment(secrets.token_urlsafe(32), voices_dir))
    environ["MPT_STATE_BACKEND"] = "supabase"


def tts_command(environ: MutableMapping[str, str]) -> list[str]:
    python = environ.get(TTS_PYTHON_ENV)
    if python is None or not python:
        raise RuntimeError(f"{TTS_PYTHON_ENV} is not set: the worker cannot start TTS")
    return [
        python, "-m", "uvicorn", "local_tts.server:app",
        "--host", TTS_HOST, "--port", str(TTS_PORT),
    ]


def wait_for_tts(
    secret: str,
    process: Any,
    *,
    get: Callable[..., Any],
    now: Callable[[], float] = time.monotonic,
    sleep: Callable[[float], None] = time.sleep,
    timeout: float = TTS_START_TIMEOUT_SECONDS,
) -> None:
    """Block until the TTS server answers /health, or fail."""
    deadline = now() + timeout
    url = f"http://{TTS_HOST}:{TTS_PORT}/health"
    while now() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"TTS server exited with code {process.returncode}")
        try:
            response = get(url, headers={"Authorization": f"Bearer {secret}"}, timeout=5)
            if response.status_code == 200:
                return
        except OSError:
            pass
        sleep(1.0)
    raise RuntimeError(f"TTS server did not answer within {timeout:g}s")


def ensure_tts_server(
    engine_root: Path,
    environ: MutableMapping[str, str],
    *,
    popen: Callable[..., Any] = subprocess.Popen,
    get: Callable[..., Any] | None = None,
) -> Any:
    """Start the loopback TTS server once per container."""
    global _tts_process
    if _tts_process is not None and _tts_process.poll() is None:
        return _tts_process
    if get is None:
        import requests

        get = requests.get
    process = popen(tts_command(environ), cwd=str(engine_root), env=dict(environ))
    wait_for_tts(environ["CHATTERBOX_HTTP_SECRET"], process, get=get)
    _tts_process = process
    return process


def clone_voice_key(voice_name: str | None) -> str | None:
    """The registry key of a clone voice, the way ``voice.py`` derives it."""
    if voice_name is None or not voice_name.startswith(CLONE_PREFIX):
        return None
    key = voice_name.split(":", 1)[1].strip()
    if key.endswith(GENDER_SUFFIXES):
        key = key.rsplit("-", 1)[0]
    return key or None


def stage_clone_voice(key: str, voices_dir: Path, store: Any) -> None:
    """Register the clone's reference WAV on this container's voices dir."""
    from chatterbox_registry_volume import load_voices_toml, register_voice_on_volume

    config_path = voices_dir / "voices.toml"
    if key in load_voices_toml(config_path):
        return
    row = store.get_ready_by_engine_voice_key(key)
    if row is None:
        raise RuntimeError(f"cloned voice {key} has no ready row in cloned_voices")
    wav = store.download_reference_wav(str(row["storage_path"]))
    register_voice_on_volume(voices_dir, config_path, key, str(row.get("language") or ""), wav)


def run(
    task_id: str,
    payload: dict[str, Any],
    stop_at: str,
    *,
    engine_root: Path,
    voices_dir: Path,
    environ: MutableMapping[str, str] = os.environ,
) -> None:
    """Validate the params, stage the voice, start TTS, run the pipeline."""
    prepare(engine_root, voices_dir, environ)
    from app.models.schema import TaskVideoRequest
    from app.services import task as tm

    params = TaskVideoRequest.model_validate(payload)
    voice_name, _voice_audio = tm.resolve_persona_audio(params)
    key = clone_voice_key(voice_name)
    if key is not None:
        from app.services.cloned_voices.store import ClonedVoiceStore

        stage_clone_voice(key, voices_dir, ClonedVoiceStore())
    ensure_tts_server(engine_root, environ)
    tm.start(task_id, params, stop_at)


__all__ = [
    "CONFIG_ENV",
    "clone_voice_key",
    "ensure_tts_server",
    "prepare",
    "run",
    "stage_clone_voice",
    "tts_command",
    "tts_environment",
    "wait_for_tts",
    "write_engine_config",
]
