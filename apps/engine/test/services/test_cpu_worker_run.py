"""Unit tests for the Modal CPU worker entrypoint.

The worker runs one render inside a scale-to-zero container: it prepares
the environment, materializes a clone reference, starts the local TTS
server, and renders through the shared task pipeline.
"""

from __future__ import annotations

import os
import sys
import threading
import types
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from app.models import const
from app.services import cpu_worker_run as run


def _env(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("MPT_STATE_BACKEND", "supabase")
    monkeypatch.setenv("CHATTERBOX_HTTP_SECRET", "secret")
    monkeypatch.setenv("TTS_VOICES_DIR", str(tmp_path))


def test_prepare_worker_env_sets_the_local_tts_defaults(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    _env(monkeypatch, tmp_path)
    monkeypatch.delenv("MPT_CHATTERBOX_API_KEY", raising=False)
    monkeypatch.delenv("MPT_CLONED_VOICES_REGISTRY_API_KEY", raising=False)
    monkeypatch.delenv("MPT_CHATTERBOX_BASE_URL", raising=False)
    monkeypatch.delenv("MPT_CLONED_VOICES_REGISTRY_BASE_URL", raising=False)
    run.prepare_worker_env()
    assert os.environ["MPT_CHATTERBOX_API_KEY"] == "secret"
    assert os.environ["MPT_CLONED_VOICES_REGISTRY_API_KEY"] == "secret"
    assert os.environ["MPT_CHATTERBOX_BASE_URL"] == "http://127.0.0.1:4123/v1"
    assert (
        os.environ["MPT_CLONED_VOICES_REGISTRY_BASE_URL"]
        == "http://127.0.0.1:4123"
    )
    assert os.environ["TTS_VOICES_DIR"] == str(tmp_path)
    assert (tmp_path).is_dir()


def test_prepare_worker_env_defaults_the_voices_dir(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("MPT_STATE_BACKEND", "supabase")
    monkeypatch.setenv("CHATTERBOX_HTTP_SECRET", "secret")
    monkeypatch.delenv("TTS_VOICES_DIR", raising=False)
    created: list[str] = []
    monkeypatch.setattr(os, "makedirs", lambda path, exist_ok=False: created.append(path))
    run.prepare_worker_env()
    assert os.environ["TTS_VOICES_DIR"] == "/tmp/tts-voices"
    assert created == ["/tmp/tts-voices"]


def _fake_urlopen(status: int) -> Any:
    class _Response:
        def __init__(self) -> None:
            self.status = status

        def __enter__(self) -> _Response:
            return self

        def __exit__(self, *args: object) -> None:
            return None

    def _open(request: object, timeout: float | None = None) -> _Response:
        return _Response()

    return _open


def test_wait_until_tts_healthy_returns_on_the_first_healthy_response(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("CHATTERBOX_HTTP_SECRET", "secret")
    monkeypatch.setattr(
        "urllib.request.urlopen", _fake_urlopen(200)
    )
    assert run._wait_until_tts_healthy(timeout_s=5) is None


def test_wait_until_tts_healthy_retries_a_5xx_response(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("CHATTERBOX_HTTP_SECRET", "secret")
    responses = iter([503, 200])
    monkeypatch.setattr(
        "urllib.request.urlopen",
        lambda request, timeout=None: _fake_urlopen(next(responses))(request, timeout),
    )
    monkeypatch.setattr(run.time, "sleep", lambda seconds: None)
    assert run._wait_until_tts_healthy(timeout_s=5) is None


def test_wait_until_tts_healthy_raises_when_the_server_never_answers(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("CHATTERBOX_HTTP_SECRET", "secret")

    def _down(request: object, timeout: float | None = None) -> None:
        raise ConnectionError("down")

    monkeypatch.setattr("urllib.request.urlopen", _down)
    monkeypatch.setattr(run.time, "sleep", lambda seconds: None)
    with pytest.raises(RuntimeError, match="ConnectionError"):
        run._wait_until_tts_healthy(timeout_s=0.05)


def test_wait_until_tts_healthy_reports_no_attempt_when_the_deadline_passed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("CHATTERBOX_HTTP_SECRET", "secret")
    with pytest.raises(RuntimeError, match="NoneType"):
        run._wait_until_tts_healthy(timeout_s=0)


def test_start_local_tts_starts_the_server_once(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setitem(
        sys.modules, "uvicorn", SimpleNamespace(run=lambda *args, **kwargs: None)
    )
    monkeypatch.setitem(sys.modules, "local_tts", types.ModuleType("local_tts"))
    monkeypatch.setitem(
        sys.modules, "local_tts.server", SimpleNamespace(app=object())
    )
    monkeypatch.setattr(run, "_tts_started", False)
    waited: list[None] = []
    monkeypatch.setattr(
        run, "_wait_until_tts_healthy", lambda timeout_s=60: waited.append(None)
    )
    started: list[dict[str, Any]] = []

    class _Thread:
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            self.kwargs = kwargs
            started.append(kwargs)

        def start(self) -> None:
            self.kwargs["daemon"] = True

    monkeypatch.setattr(threading, "Thread", _Thread)
    run.start_local_tts()
    run.start_local_tts()
    assert len(started) == 1
    assert started[0]["name"] == "cpu-worker-tts"
    assert started[0]["daemon"] is True
    assert len(waited) == 1
    assert run._tts_started is True


def _fake_state(task: dict[str, Any] | None) -> SimpleNamespace:
    updates: list[tuple[str, dict[str, Any]]] = []
    state = SimpleNamespace(
        updates=updates,
        get_task=lambda task_id: task,
        update_task=lambda task_id, **kwargs: updates.append((task_id, kwargs)),
    )
    return state


def test_fail_if_open_marks_an_open_task_failed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    state = _fake_state({"state": const.TASK_STATE_PROCESSING})
    monkeypatch.setattr("app.services.state.state", state)
    run._fail_if_open("task-1", RuntimeError("boom"))
    assert state.updates == [
        (
            "task-1",
            {"state": const.TASK_STATE_FAILED, "error": "RuntimeError"},
        )
    ]


def test_fail_if_open_ignores_a_missing_task(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    state = _fake_state(None)
    monkeypatch.setattr("app.services.state.state", state)
    run._fail_if_open("task-1", RuntimeError("boom"))
    assert state.updates == []


def test_fail_if_open_ignores_a_terminal_task(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    for terminal in (const.TASK_STATE_FAILED, const.TASK_STATE_COMPLETE):
        state = _fake_state({"state": terminal})
        monkeypatch.setattr("app.services.state.state", state)
        run._fail_if_open("task-1", RuntimeError("boom"))
        assert state.updates == []


def test_const_helpers_return_the_task_states() -> None:
    assert run.const_failed() == const.TASK_STATE_FAILED
    assert run.const_complete() == const.TASK_STATE_COMPLETE


def _params() -> dict[str, str]:
    return {
        "video_type": "voiceover",
        "voice_name": "chatterbox:kokoro_af_heart",
        "video_title": "t",
        "video_description": "d",
        "video_script": "script",
    }


def test_run_one_renders_through_the_shared_pipeline(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    _env(monkeypatch, tmp_path)
    calls: list[str] = []
    monkeypatch.setattr(
        run, "prepare_worker_env", lambda: calls.append("prepare")
    )
    monkeypatch.setattr(
        run, "start_local_tts", lambda: calls.append("tts")
    )
    materialized: list[tuple[dict[str, Any], Path]] = []
    monkeypatch.setattr(
        "app.services.cloned_voices.materialize.materialize_clone",
        lambda params, voices_dir: materialized.append((params, voices_dir)),
    )
    started: list[tuple[str, Any, str]] = []
    monkeypatch.setattr(
        "app.services.task.start",
        lambda task_id, request, stop_at="video": started.append(
            (task_id, request, stop_at)
        ),
    )
    params = _params()
    run.run_one("task-1", params)
    assert calls == ["prepare", "tts"]
    assert materialized == [(params, tmp_path)]
    assert len(started) == 1
    assert started[0][0] == "task-1"
    assert started[0][1].video_type.value == "voiceover"
    assert started[0][2] == "video"


def test_run_one_populates_the_chatterbox_api_key_before_rendering(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    from app.config import config as app_config

    _env(monkeypatch, tmp_path)
    monkeypatch.delenv("MPT_CHATTERBOX_API_KEY", raising=False)
    monkeypatch.delenv("MPT_CLONED_VOICES_REGISTRY_API_KEY", raising=False)
    monkeypatch.setitem(app_config.chatterbox, "api_key", "")
    monkeypatch.setitem(app_config.cloned_voices, "registry_api_key", "")
    monkeypatch.setattr(run, "start_local_tts", lambda: None)
    monkeypatch.setattr(
        "app.services.cloned_voices.materialize.materialize_clone",
        lambda params, voices_dir: None,
    )
    seen: list[tuple[str, str]] = []
    monkeypatch.setattr(
        "app.services.task.start",
        lambda task_id, request, stop_at="video": seen.append(
            (
                app_config.chatterbox.get("api_key", ""),
                app_config.cloned_voices.get("registry_api_key", ""),
            )
        ),
    )
    run.run_one("task-1", _params())
    assert seen == [("secret", "secret")]


def test_run_one_marks_the_task_failed_and_re_raises(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    _env(monkeypatch, tmp_path)
    monkeypatch.setattr(run, "prepare_worker_env", lambda: None)
    monkeypatch.setattr(run, "start_local_tts", lambda: None)
    monkeypatch.setattr(
        "app.services.cloned_voices.materialize.materialize_clone",
        lambda params, voices_dir: None,
    )

    def _boom(task_id: str, request: Any, stop_at: str = "video") -> None:
        raise RuntimeError("render failed")

    monkeypatch.setattr("app.services.task.start", _boom)
    failed: list[tuple[str, BaseException]] = []
    monkeypatch.setattr(
        run, "_fail_if_open", lambda task_id, exc: failed.append((task_id, exc))
    )
    with pytest.raises(RuntimeError, match="render failed"):
        run.run_one("task-1", _params())
    assert len(failed) == 1
    assert failed[0][0] == "task-1"
    assert isinstance(failed[0][1], RuntimeError)


def test_run_one_marks_the_task_failed_when_clone_materialization_fails(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    _env(monkeypatch, tmp_path)
    monkeypatch.setattr(run, "prepare_worker_env", lambda: None)
    monkeypatch.setattr(run, "start_local_tts", lambda: None)

    def _boom(params: dict[str, Any], voices_dir: Path) -> None:
        raise RuntimeError("clone missing")

    monkeypatch.setattr(
        "app.services.cloned_voices.materialize.materialize_clone",
        _boom,
    )
    failed: list[tuple[str, BaseException]] = []
    monkeypatch.setattr(
        run, "_fail_if_open", lambda task_id, exc: failed.append((task_id, exc))
    )
    with pytest.raises(RuntimeError, match="clone missing"):
        run.run_one("task-1", _params())
    assert len(failed) == 1
    assert failed[0][0] == "task-1"
    assert isinstance(failed[0][1], RuntimeError)


def test_run_one_marks_the_task_failed_when_tts_startup_fails(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    _env(monkeypatch, tmp_path)
    monkeypatch.setattr(run, "prepare_worker_env", lambda: None)
    monkeypatch.setattr(
        "app.services.cloned_voices.materialize.materialize_clone",
        lambda params, voices_dir: None,
    )

    def _boom() -> None:
        raise RuntimeError("tts unhealthy")

    monkeypatch.setattr(run, "start_local_tts", _boom)
    failed: list[tuple[str, BaseException]] = []
    monkeypatch.setattr(
        run, "_fail_if_open", lambda task_id, exc: failed.append((task_id, exc))
    )
    with pytest.raises(RuntimeError, match="tts unhealthy"):
        run.run_one("task-1", _params())
    assert len(failed) == 1
    assert failed[0][0] == "task-1"
    assert isinstance(failed[0][1], RuntimeError)


def test_fail_if_open_retries_a_failing_first_write(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    attempts: list[dict[str, Any]] = []

    class _FlakyState:
        def get_task(self, task_id: str) -> dict[str, Any]:
            return {"state": const.TASK_STATE_PROCESSING}

        def update_task(self, task_id: str, **kwargs: Any) -> None:
            attempts.append(kwargs)
            if len(attempts) == 1:
                raise RuntimeError("supabase down")

    monkeypatch.setattr("app.services.state.state", _FlakyState())
    monkeypatch.setattr(
        "app.services.state_persistence.time.sleep", lambda _: None
    )
    run._fail_if_open("task-1", RuntimeError("boom"))
    assert len(attempts) == 2
    assert attempts[-1] == {
        "state": const.TASK_STATE_FAILED,
        "error": "RuntimeError",
    }


def test_run_one_marks_the_task_failed_when_validation_fails(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    from pydantic import ValidationError

    _env(monkeypatch, tmp_path)
    monkeypatch.setattr(run, "prepare_worker_env", lambda: None)
    monkeypatch.setattr(run, "start_local_tts", lambda: None)
    monkeypatch.setattr(
        "app.services.cloned_voices.materialize.materialize_clone",
        lambda params, voices_dir: None,
    )
    failed: list[tuple[str, BaseException]] = []
    monkeypatch.setattr(
        run, "_fail_if_open", lambda task_id, exc: failed.append((task_id, exc))
    )
    with pytest.raises(ValidationError):
        run.run_one("task-1", {"video_type": "voiceover"})
    assert len(failed) == 1
    assert failed[0][0] == "task-1"
    assert isinstance(failed[0][1], ValidationError)


def test_run_one_marks_the_task_failed_when_worker_env_setup_fails(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    _env(monkeypatch, tmp_path)

    def _boom() -> None:
        raise RuntimeError("secret missing")

    monkeypatch.setattr(run, "prepare_worker_env", _boom)
    failed: list[tuple[str, BaseException]] = []
    monkeypatch.setattr(
        run, "_fail_if_open", lambda task_id, exc: failed.append((task_id, exc))
    )
    with pytest.raises(RuntimeError, match="secret missing"):
        run.run_one("task-1", _params())
    assert len(failed) == 1
    assert failed[0][0] == "task-1"
    assert isinstance(failed[0][1], RuntimeError)
