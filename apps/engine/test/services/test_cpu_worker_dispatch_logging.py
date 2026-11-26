"""Spawn and cancel failure logs name the Modal app and the error text."""

from __future__ import annotations

import sys

import pytest
from loguru import logger

from app.services import cpu_worker_dispatch as dispatch
from app.services.state import MemoryState


def _voiceover(**overrides: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "video_type": "voiceover",
        "voice_name": "chatterbox:kokoro_af_heart",
        "video_title": "t",
        "video_description": "d",
    }
    payload.update(overrides)
    return payload


class _LogSink:
    def __init__(self) -> None:
        self.records: list[dict[str, object]] = []
        self.handler_id: int | None = None

    def __enter__(self) -> _LogSink:
        self.handler_id = logger.add(lambda message: self.records.append(message.record))
        return self

    def __exit__(self, *exc: object) -> None:
        assert self.handler_id is not None
        logger.remove(self.handler_id)

    def messages(self, level: str = "ERROR") -> list[str]:
        return [str(record["message"]) for record in self.records if record["level"].name == level]


def _spawn_failure_message(messages: list[str], task_id: str) -> str:
    matches = [message for message in messages if task_id in message]
    assert len(matches) == 1, f"expected one log for {task_id}, got {messages}"
    return matches[0]


def test_dispatch_spawn_failure_log_names_app_function_and_error() -> None:
    state = MemoryState()
    state.update_task("task-1", state=3, progress=0)

    def boom(task_id: str, params: dict[str, object], stop_at: str) -> str:
        raise RuntimeError("App 'moneyprint-cpu-worker' not found")

    with _LogSink() as sink:
        spawned, _accepted = dispatch.try_remote_dispatch(
            state, "task-1", _voiceover(), "video", spawn=boom
        )
    assert spawned is False
    message = _spawn_failure_message(sink.messages(), "task-1")
    assert "moneyprint-cpu-worker/render_video" in message
    assert "RuntimeError" in message
    assert "App 'moneyprint-cpu-worker' not found" in message


def test_batch_spawn_failure_log_names_app_function_and_error() -> None:
    state = MemoryState()
    state.update_task("task-1", state=3, progress=0)

    def boom(task_id: str, params: dict[str, object], stop_at: str) -> str:
        raise RuntimeError("App 'moneyprint-cpu-worker' not found")

    with _LogSink() as sink:
        spawned, _accepted = dispatch.try_remote_batch(
            state, "task-1", _voiceover(), "user-1", {}, spawn=boom
        )
    assert spawned is False
    message = _spawn_failure_message(sink.messages(), "task-1")
    assert "moneyprint-cpu-worker/render_video" in message
    assert "RuntimeError" in message
    assert "App 'moneyprint-cpu-worker' not found" in message


def test_resume_spawn_failure_log_names_app_function_and_error() -> None:
    rows = [
        {
            "task_id": "boom",
            "data": {
                "remote_worker": dispatch.REMOTE_WORKER_VALUE,
                "remote_call_id": "",
                "job_params": _voiceover(),
                "pipeline": "video",
            },
        },
    ]

    class _Response:
        def json(self) -> list[dict[str, object]]:
            return rows

    class _State:
        def __init__(self) -> None:
            self.updates: list[tuple[str, dict[str, object]]] = []

        def _request(self, method: str, query: str) -> _Response:
            return _Response()

        def update_task(self, task_id: str, **kwargs: object) -> None:
            self.updates.append((task_id, kwargs))

    def _spawn(task_id: str, params: dict[str, object], stop_at: str) -> str:
        raise RuntimeError("App 'moneyprint-cpu-worker' not found")

    with _LogSink() as sink:
        started = dispatch.resume_unspawned_cpu_jobs(_State(), spawn=_spawn)
    assert started == 0
    message = _spawn_failure_message(sink.messages(), "boom")
    assert "moneyprint-cpu-worker/render_video" in message
    assert "RuntimeError" in message
    assert "App 'moneyprint-cpu-worker' not found" in message


def test_cancel_failure_log_names_the_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class _Call:
        def cancel(self) -> None:
            raise RuntimeError("cancel boom")

    class _FunctionCall:
        @staticmethod
        def from_id(call_id: str) -> _Call:
            assert call_id == "fc-1"
            return _Call()

    class _Modal:
        FunctionCall = _FunctionCall

    monkeypatch.setitem(sys.modules, "modal", _Modal())
    with _LogSink() as sink:
        dispatch._cancel_modal_call("fc-1")
    warnings = sink.messages("WARNING")
    assert len(warnings) == 1, f"expected one warning, got {warnings}"
    assert "modal cpu cancel failed for fc-1" in warnings[0]
    assert "RuntimeError" in warnings[0]
    assert "cancel boom" in warnings[0]


def test_cancel_unavailable_log_names_the_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setitem(sys.modules, "modal", None)
    with _LogSink() as sink:
        dispatch._cancel_modal_call("fc-1")
    warnings = sink.messages("WARNING")
    assert len(warnings) == 1, f"expected one warning, got {warnings}"
    assert "modal cpu cancel unavailable" in warnings[0]
    assert "ModuleNotFoundError" in warnings[0]
    assert "import of modal halted" in warnings[0]
