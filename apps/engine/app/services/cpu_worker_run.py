"""Run one video inside a Modal CPU container.

The container sets ``MPT_STATE_BACKEND=supabase`` before this module is
imported by the function body. This module does not start the ASGI app,
so boot reconcile never runs here.
"""

from __future__ import annotations

import os
import threading
import time
import urllib.request
from typing import Any

_tts_started = False
_tts_lock = threading.Lock()


def prepare_worker_env() -> None:
    """Require the Supabase backend and point TTS at the in-container server."""
    if os.environ.get("MPT_STATE_BACKEND") != "supabase":
        raise RuntimeError(
            "MPT_STATE_BACKEND=supabase is required for the CPU worker"
        )
    secret = os.environ.get("CHATTERBOX_HTTP_SECRET")
    if not isinstance(secret, str) or not secret:
        raise RuntimeError("CHATTERBOX_HTTP_SECRET is required for the CPU worker")
    os.environ.setdefault("MPT_CHATTERBOX_API_KEY", secret)
    os.environ.setdefault("MPT_CLONED_VOICES_REGISTRY_API_KEY", secret)
    os.environ.setdefault("MPT_CHATTERBOX_BASE_URL", "http://127.0.0.1:4123/v1")
    os.environ.setdefault(
        "MPT_CLONED_VOICES_REGISTRY_BASE_URL", "http://127.0.0.1:4123"
    )
    voices = os.environ.get("TTS_VOICES_DIR")
    if not isinstance(voices, str) or not voices:
        os.environ["TTS_VOICES_DIR"] = "/tmp/tts-voices"
    os.makedirs(os.environ["TTS_VOICES_DIR"], exist_ok=True)


def _wait_until_tts_healthy(timeout_s: float = 60) -> None:
    secret = os.environ["CHATTERBOX_HTTP_SECRET"]
    request = urllib.request.Request(
        "http://127.0.0.1:4123/health",
        headers={"Authorization": f"Bearer {secret}"},
    )
    deadline = time.monotonic() + timeout_s
    last: Exception | None = None
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(request, timeout=2) as response:
                if response.status < 500:
                    return
        except Exception as exc:
            last = exc
            time.sleep(0.2)
    raise RuntimeError(f"local tts did not become healthy: {type(last).__name__}")


def start_local_tts() -> None:
    """One house-voice server per container. A second call is a no-op."""
    global _tts_started
    with _tts_lock:
        if _tts_started:
            return
        import uvicorn
        from local_tts.server import app as tts_app

        thread = threading.Thread(
            target=lambda: uvicorn.run(
                tts_app, host="127.0.0.1", port=4123, log_level="warning"
            ),
            name="cpu-worker-tts",
            daemon=True,
        )
        thread.start()
        _tts_started = True
    _wait_until_tts_healthy()


def _fail_if_open(task_id: str, exc: BaseException) -> None:
    from app.services import state as sm

    task = sm.state.get_task(task_id)
    if not isinstance(task, dict):
        return
    if task.get("state") in (const_failed(), const_complete()):
        return
    sm.state.update_task(task_id, state=const_failed(), error=type(exc).__name__)


def const_failed() -> int:
    from app.models import const

    return const.TASK_STATE_FAILED


def const_complete() -> int:
    from app.models import const

    return const.TASK_STATE_COMPLETE


def run_one(task_id: str, params: dict[str, Any], stop_at: str = "video") -> None:
    """Render ``params`` for ``task_id`` and leave status on the Supabase row."""
    prepare_worker_env()
    start_local_tts()
    from app.models.schema import TaskVideoRequest
    from app.services.task import start

    request = TaskVideoRequest.model_validate(params)
    try:
        start(task_id, request, stop_at=stop_at)
    except Exception as exc:
        _fail_if_open(task_id, exc)
        raise
