"""Dispatch, flag, and reconcile safety for the Modal CPU worker."""

from __future__ import annotations

import ast
from pathlib import Path

import pytest

from app.models.schema import TaskVideoRequest
from app.services import cpu_worker_dispatch as dispatch
from app.services import state as sm
from app.services.cpu_worker_run import prepare_worker_env
from app.services.orphan_requeue import triage_orphan
from app.services.state import MemoryState

ENGINE = Path(__file__).resolve().parents[2]


def _faceless(**overrides: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "video_type": "faceless",
        "voice_name": "chatterbox:kokoro_af_heart",
        "video_title": "t",
        "video_description": "d",
    }
    payload.update(overrides)
    return payload


def test_faceless_dispatches_without_a_feature_flag() -> None:
    assert dispatch.should_dispatch(_faceless(), "video") is True


def test_faceless_house_voice_dispatches(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    assert dispatch.should_dispatch(_faceless(), "video") is True
    assert dispatch.should_dispatch(
        _faceless(persona={"voice_id": "chatterbox:kokoro_af_heart"}, voice_name=""),
        "video",
    ) is True


def test_clone_dispatches_and_lipsync_stays_on_the_vps() -> None:
    assert dispatch.should_dispatch(
        _faceless(voice_name=f"{dispatch.CLONE_PREFIX}mine"), "video"
    ) is True
    assert dispatch.should_dispatch(
        _faceless(persona={"voice_id": f"{dispatch.CLONE_PREFIX}mine"}), "video"
    ) is True
    assert dispatch.should_dispatch(_faceless(video_type="hook_lipsync"), "video") is False
    assert dispatch.should_dispatch(_faceless(video_type="full_lipsync"), "video") is False
    assert dispatch.should_dispatch(_faceless(), "audio") is False


def test_clone_prefix_matches_the_registry_constant() -> None:
    source = (ENGINE / "app/services/cloned_voices/constants.py").read_text()
    tree = ast.parse(source)
    value = None
    for node in tree.body:
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name) and target.id == "CHATTERBOX_NANO_VOICE_PREFIX":
                    if isinstance(node.value, ast.Constant):
                        value = node.value.value
    assert value == dispatch.CLONE_PREFIX


def test_max_containers_defaults_to_30_and_rejects_a_lower_ceiling(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv(dispatch.MAX_CONTAINERS_ENV, raising=False)
    assert dispatch.configured_max_containers() == 30
    monkeypatch.setenv(dispatch.MAX_CONTAINERS_ENV, "40")
    assert dispatch.configured_max_containers() == 40
    monkeypatch.setenv(dispatch.MAX_CONTAINERS_ENV, "10")
    with pytest.raises(RuntimeError):
        dispatch.configured_max_containers()


def test_spawn_records_the_call_id_and_a_failure_clears_the_marker() -> None:
    state = MemoryState()
    state.update_task("task-1", state=3, progress=0)

    def spawn(task_id: str, params: dict[str, object], stop_at: str) -> str:
        assert task_id == "task-1"
        assert params["video_type"] == "faceless"
        assert stop_at == "video"
        return "fc-1"

    spawned, accepted = dispatch.try_remote_dispatch(
        state, "task-1", _faceless(), "video", spawn=spawn
    )
    assert spawned is True
    assert accepted is False
    saved = state.get_task("task-1")
    assert saved is not None
    assert saved["remote_call_id"] == "fc-1"
    assert saved["remote_worker"] == dispatch.REMOTE_WORKER_VALUE

    def boom(task_id: str, params: dict[str, object], stop_at: str) -> str:
        raise RuntimeError("modal down")

    spawned, _accepted = dispatch.try_remote_dispatch(
        state, "task-1", _faceless(), "video", spawn=boom
    )
    assert spawned is False
    cleared = state.get_task("task-1")
    assert cleared is not None
    assert cleared["remote_worker"] == ""
    assert cleared["remote_call_id"] == ""


def test_thirty_faceless_jobs_spawn_without_a_local_queue() -> None:
    state = MemoryState()
    seen: list[str] = []

    def spawn(task_id: str, params: dict[str, object], stop_at: str) -> str:
        seen.append(task_id)
        return f"fc-{task_id}"

    for index in range(30):
        spawned, _accepted = dispatch.try_remote_dispatch(
            state, f"task-{index}", _faceless(), "video", spawn=spawn
        )
        assert spawned is True
    assert seen == [f"task-{index}" for index in range(30)]
    assert all(
        (state.get_task(f"task-{index}") or {})["remote_call_id"] == f"fc-task-{index}"
        for index in range(30)
    )


def test_direct_create_uses_modal_when_the_flag_is_on(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.controllers.v1 import video as video_controller

    body = TaskVideoRequest(
        video_title="subject",
        video_description="Test description.",
        video_type="faceless",
        voice_name="chatterbox:kokoro_af_heart",
        video_script="script",
    )
    auth = type("Auth", (), {"user_id": "user-1"})()
    calls: list[str] = []

    def spawn(task_id: str, params: dict[str, object], stop_at: str) -> str:
        calls.append(task_id)
        return "fc-direct"

    monkeypatch.setattr(dispatch, "_modal_spawn", spawn)
    monkeypatch.setattr(video_controller.base, "get_task_id", lambda _request: "req-1")
    monkeypatch.setattr(video_controller.base, "get_auth_context", lambda _request: auth)
    added: list[object] = []
    monkeypatch.setattr(
        video_controller.task_manager,
        "add_task",
        lambda *args, **kwargs: added.append(kwargs),
    )
    response = video_controller.create_task(object(), body, stop_at="video")
    task_id = response["body"]["task_id"]
    try:
        assert added == []
        assert calls == [task_id]
        task = sm.state.get_task(task_id, user_id="user-1")
        assert task is not None
        assert task["state"] == 3
        assert task["remote_call_id"] == "fc-direct"
    finally:
        sm.state.delete_task(task_id)


def test_clone_create_goes_to_modal(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.controllers.v1 import video as video_controller

    body = TaskVideoRequest(
        video_title="subject",
        video_description="Test description.",
        video_type="faceless",
        voice_name=f"{dispatch.CLONE_PREFIX}mine",
        video_script="script",
    )
    auth = type("Auth", (), {"user_id": "user-1"})()
    calls: list[str] = []
    monkeypatch.setattr(
        dispatch,
        "_modal_spawn",
        lambda task_id, params, stop_at: calls.append(task_id) or "fc-clone",
    )
    monkeypatch.setattr(video_controller.base, "get_task_id", lambda _request: "req-1")
    monkeypatch.setattr(video_controller.base, "get_auth_context", lambda _request: auth)
    added: list[object] = []
    monkeypatch.setattr(
        video_controller.task_manager,
        "add_task",
        lambda *args, **kwargs: added.append(kwargs),
    )
    response = video_controller.create_task(object(), body, stop_at="video")
    task_id = response["body"]["task_id"]
    try:
        assert added == []
        assert calls == [task_id]
    finally:
        sm.state.delete_task(task_id)


def test_live_modal_worker_is_not_triaged(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(dispatch, "modal_call_status", lambda _call_id: "running")
    data = {
        "remote_worker": dispatch.REMOTE_WORKER_VALUE,
        "remote_call_id": "fc-live",
        "stage": "render",
        "slot_id": "slot-1",
    }
    assert triage_orphan(MemoryState(), "task-live", data, object()) is True


def test_finished_modal_call_falls_through_triage(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(dispatch, "modal_call_status", lambda _call_id: "finished")
    data = {
        "remote_worker": dispatch.REMOTE_WORKER_VALUE,
        "remote_call_id": "fc-done",
        "stage": "render",
    }
    assert dispatch.remote_worker_in_flight(data) is False
    state = MemoryState()

    class _Response:
        def json(self) -> list[object]:
            return []

    state._request = lambda *args, **kwargs: _Response()  # type: ignore[method-assign]
    assert triage_orphan(state, "task-done", data, None) is False


def test_resume_spawns_only_rows_that_never_got_a_call_id() -> None:
    rows = [
        {
            "task_id": "missing",
            "data": {
                "remote_worker": dispatch.REMOTE_WORKER_VALUE,
                "remote_call_id": "",
                "job_params": _faceless(),
                "pipeline": "video",
            },
        },
        {
            "task_id": "already",
            "data": {
                "remote_worker": dispatch.REMOTE_WORKER_VALUE,
                "remote_call_id": "fc-keep",
                "job_params": _faceless(),
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
            assert method == "GET"
            assert "remote_worker=eq.modal_cpu" in query
            return _Response()

        def update_task(self, task_id: str, **kwargs: object) -> None:
            self.updates.append((task_id, kwargs))

    started = dispatch.resume_unspawned_cpu_jobs(
        _State(), spawn=lambda task_id, params, stop_at: f"fc-{task_id}"
    )
    assert started == 1


def test_app_name_defaults_and_can_be_overridden(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv(dispatch.APP_NAME_ENV, raising=False)
    assert dispatch.worker_app_name() == "moneyprint-cpu-worker"
    monkeypatch.setenv(dispatch.APP_NAME_ENV, "moneyprint-cpu-worker-dev")
    assert dispatch.worker_app_name() == "moneyprint-cpu-worker-dev"


def test_worker_env_requires_supabase_and_the_tts_secret(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("MPT_STATE_BACKEND", raising=False)
    monkeypatch.setenv("CHATTERBOX_HTTP_SECRET", "secret")
    with pytest.raises(RuntimeError, match="MPT_STATE_BACKEND"):
        prepare_worker_env()
    monkeypatch.setenv("MPT_STATE_BACKEND", "memory")
    with pytest.raises(RuntimeError, match="MPT_STATE_BACKEND"):
        prepare_worker_env()
    monkeypatch.setenv("MPT_STATE_BACKEND", "supabase")
    monkeypatch.delenv("CHATTERBOX_HTTP_SECRET", raising=False)
    with pytest.raises(RuntimeError, match="CHATTERBOX_HTTP_SECRET"):
        prepare_worker_env()


def test_worker_entrypoint_scales_to_zero_and_skips_boot() -> None:
    modal_source = (ENGINE / "modal_cpu_worker.py").read_text()
    run_source = (ENGINE / "app/services/cpu_worker_run.py").read_text()
    dockerfile = (ENGINE / "Dockerfile.cpu-worker").read_text()
    assert "min_containers=0" in modal_source
    assert "scaledown_window=1" in modal_source
    assert "buffer_containers" not in modal_source
    assert "max_containers=1" not in modal_source
    assert "memory=10240" in modal_source
    assert "cpu-worker-voices" in modal_source
    assert "def register_clone" in modal_source
    assert "def delete_clone" in modal_source
    assert 'Secret.from_name("cpu-worker")' in modal_source
    assert "reconcile_orphaned_tasks" not in modal_source
    assert "reconcile_orphaned_tasks" not in run_source
    assert "asgi" not in run_source
    assert "ffmpeg" in dockerfile
    assert "WhisperModel" in dockerfile
    assert "chatterbox-tts" in dockerfile
    assert "MPT_STATE_BACKEND=supabase" in dockerfile
    house = (ENGINE / "local_tts/requirements-house.txt").read_text()
    assert "kokoro" in house
    assert "ptts" in house
    assert "chatterbox" not in house
    assert "modal.App(DEFAULT_APP_NAME)" in modal_source
    assert dispatch.DEFAULT_APP_NAME == "moneyprint-cpu-worker"
    assert dispatch.FUNCTION_NAME == "render_video"
    assert "def render_video" in modal_source


def test_migrate_lists_clone_wavs_without_uploading(tmp_path: Path) -> None:
    from chatterbox_registry_volume import register_voice_on_volume
    from scripts.migrate_clone_voices import clone_files

    wav = b"RIFF" + b"\x00\x00\x00\x00" + b"WAVE" + b"rest"
    register_voice_on_volume(
        tmp_path,
        tmp_path / "voices.toml",
        "u0123456789ab_0123456789ab",
        "pt",
        wav,
    )
    rows = clone_files(tmp_path)
    expected = tmp_path / "u0123456789ab_0123456789ab" / "reference.wav"
    assert rows == [("u0123456789ab_0123456789ab", "pt", expected)]


def test_publish_clone_requires_modal_tokens(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("MODAL_TOKEN_ID", raising=False)
    monkeypatch.delenv("MODAL_TOKEN_SECRET", raising=False)
    with pytest.raises(RuntimeError, match="MODAL_TOKEN_ID"):
        dispatch.publish_clone_reference("u0123456789ab_0123456789ab", "en", b"wav")
