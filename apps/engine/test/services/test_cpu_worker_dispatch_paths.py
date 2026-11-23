"""Dispatch paths the main dispatch suite does not drive.

Covers the config guard, the request-object voice lookup, the real Modal
spawn, the local fallback for non-faceless jobs, the in-flight guards,
and every skip branch of the boot resume.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock

import pytest

from app.services import cpu_worker_dispatch as dispatch
from app.services import state as sm


def test_configured_max_containers_rejects_a_non_integer(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv(dispatch.MAX_CONTAINERS_ENV, "abc")
    with pytest.raises(RuntimeError, match="must be an integer"):
        dispatch.configured_max_containers()


def test_voice_names_reads_a_persona_voice_id_from_a_dict() -> None:
    params = {"persona": {"voice_id": "chatterbox_nano:key-1"}}
    assert dispatch._voice_names(params) == ["chatterbox_nano:key-1"]
    assert dispatch.is_clone_voice(params) is True


def test_voice_names_reads_attributes_from_a_request_object() -> None:
    params = SimpleNamespace(
        voice_name="calm",
        persona=SimpleNamespace(voice_id="chatterbox_nano:key-2"),
    )
    assert dispatch._voice_names(params) == ["calm", "chatterbox_nano:key-2"]
    assert dispatch.is_clone_voice(params) is True


def test_job_params_of_rejects_a_non_object_dump() -> None:
    class _Body:
        def model_dump(self, mode: str = "json") -> list[str]:
            return ["not", "a", "dict"]

    with pytest.raises(RuntimeError, match="did not dump to an object"):
        dispatch.job_params_of(_Body())


def test_modal_spawn_returns_the_call_object_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import modal

    monkeypatch.setenv("MODAL_TOKEN_ID", "token-id")
    monkeypatch.setenv("MODAL_TOKEN_SECRET", "token-secret")
    call = SimpleNamespace(object_id="fc-9")
    function = SimpleNamespace(spawn=lambda *args: call)
    monkeypatch.setattr(
        modal.Function, "from_name", lambda *args: function
    )
    assert (
        dispatch._modal_spawn("task-1", {"video_type": "faceless"}, "video")
        == "fc-9"
    )


def test_spawn_rejects_an_empty_call_id() -> None:
    with pytest.raises(RuntimeError, match="no call id"):
        dispatch._spawn("task-1", {}, "video", lambda *args: "")


def test_remote_dispatch_skips_a_non_faceless_job() -> None:
    state = MagicMock()
    body = {"video_type": "hook_lipsync"}
    assert dispatch.try_remote_dispatch(state, "task-1", body, "video") == (
        False,
        False,
    )
    state.update_task.assert_not_called()


def test_accept_direct_task_queues_a_non_faceless_job_locally() -> None:
    body = {"video_type": "hook_lipsync"}
    added: list[tuple[tuple[Any, ...], dict[str, Any]]] = []

    class _Manager:
        def add_task(self, *args: Any, **kwargs: Any) -> None:
            added.append((args, kwargs))

    try:
        dispatch.accept_direct_task(
            _Manager(), "task-local", body, "video", "user-1", {}, {}
        )
    finally:
        sm.state.delete_task("task-local")
    assert len(added) == 1
    args, kwargs = added[0]
    assert kwargs["task_id"] == "task-local"
    assert kwargs["params"] is body
    assert kwargs["stop_at"] == "video"
    assert callable(kwargs["on_accepted"])


def test_remote_batch_skips_a_non_faceless_slot() -> None:
    state = MagicMock()
    request = {"video_type": "hook_lipsync"}
    assert dispatch.try_remote_batch(state, "task-1", request, "user-1", {}) == (
        False,
        False,
    )
    state.update_task.assert_not_called()


def test_remote_worker_in_flight_rejects_a_non_dict_row() -> None:
    assert dispatch.remote_worker_in_flight(None) is False


def test_remote_worker_in_flight_rejects_a_row_without_a_call_id() -> None:
    assert (
        dispatch.remote_worker_in_flight(
            {"remote_worker": dispatch.REMOTE_WORKER_VALUE}
        )
        is False
    )


def test_resume_skips_unusable_rows_and_reports_a_spawn_failure() -> None:
    rows = [
        {"task_id": "no-data"},
        {
            "task_id": "other-worker",
            "data": {
                "remote_worker": "local",
                "remote_call_id": "",
                "job_params": {},
            },
        },
        {
            "task_id": "no-params",
            "data": {
                "remote_worker": dispatch.REMOTE_WORKER_VALUE,
                "remote_call_id": "",
                "job_params": "not-a-dict",
            },
        },
        {
            "task_id": "",
            "data": {
                "remote_worker": dispatch.REMOTE_WORKER_VALUE,
                "remote_call_id": "",
                "job_params": {},
            },
        },
        {
            "task_id": "boom",
            "data": {
                "remote_worker": dispatch.REMOTE_WORKER_VALUE,
                "remote_call_id": "",
                "job_params": {"video_type": "faceless"},
            },
        },
        {
            "task_id": "good",
            "data": {
                "remote_worker": dispatch.REMOTE_WORKER_VALUE,
                "remote_call_id": "",
                "job_params": {"video_type": "faceless"},
            },
        },
    ]

    class _Response:
        def json(self) -> list[dict[str, Any]]:
            return rows

    class _State:
        def __init__(self) -> None:
            self.updates: list[tuple[str, dict[str, Any]]] = []

        def _request(self, method: str, query: str) -> _Response:
            assert method == "GET"
            return _Response()

        def update_task(self, task_id: str, **kwargs: Any) -> None:
            self.updates.append((task_id, kwargs))

    def _spawn(task_id: str, params: dict[str, Any], stop_at: str) -> str:
        if task_id == "boom":
            raise RuntimeError("modal down")
        return f"fc-{task_id}"

    state = _State()
    started = dispatch.resume_unspawned_cpu_jobs(state, spawn=_spawn)
    assert started == 1
    assert state.updates == [("good", {"remote_call_id": "fc-good"})]
