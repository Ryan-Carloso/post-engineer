"""DELETE /api/v1/tasks/{task_id} marks the task cancelled before rmtree.

A worker mid-stage fails on the files that rmtree removes (audio.mp3,
combined-1.mp4, final-1.mp4). The cancel mark has to be set first, so that
failure is already a cancel when the worker notices the missing files.
"""

import shutil
from pathlib import Path

from loguru import logger
from starlette.requests import Request

from app.controllers import base
from app.controllers.v1 import video as video_controller
from app.models import const
from app.services import state as sm
from app.services.task_cancellation import is_cancelled
from app.utils import utils


def _request(user_id: str = "u-1") -> Request:
    request = Request({"type": "http", "headers": [], "query_string": b""})
    request.state.auth = base.AuthContext(user_id=user_id)
    return request


def test_delete_video_marks_cancelled_before_removing_the_directory(monkeypatch, tmp_path):
    task_id = "delete-order-1"
    monkeypatch.setenv("MPT_STORAGE_DIR", str(tmp_path))
    sm.state.update_task(
        task_id, user_id="u-1", state=const.TASK_STATE_PROCESSING, progress=40
    )
    current = Path(utils.task_dir()) / task_id
    current.mkdir()
    (current / "audio.mp3").write_text("audio", encoding="utf-8")

    seen: dict[str, object] = {"called": False}

    def _rmtree(path, *args, **kwargs):
        seen["called"] = True
        seen["cancelled"] = is_cancelled(task_id)
        seen["row_gone"] = sm.state.get_task(task_id) is None
        real_rmtree(path, *args, **kwargs)

    real_rmtree = shutil.rmtree
    monkeypatch.setattr(shutil, "rmtree", _rmtree)

    response = video_controller.delete_video(_request(), task_id)

    assert seen["called"] is True
    assert seen["cancelled"] is True
    assert seen["row_gone"] is True
    assert not current.exists()
    assert response["status"] == 200
    sm.state.delete_task(task_id)


def test_delete_video_succeeds_when_rmtree_raises_and_logs_error(monkeypatch, tmp_path):
    task_id = "delete-rmtree-fails-1"
    monkeypatch.setenv("MPT_STORAGE_DIR", str(tmp_path))
    sm.state.update_task(
        task_id, user_id="u-1", state=const.TASK_STATE_PROCESSING, progress=40
    )
    current = Path(utils.task_dir()) / task_id
    current.mkdir()
    (current / "audio.mp3").write_text("audio", encoding="utf-8")

    def _rmtree(path, *args, **kwargs):
        raise OSError(13, f"Permission denied: '{path}'")

    monkeypatch.setattr(shutil, "rmtree", _rmtree)
    lines: list[str] = []
    sink = logger.add(lambda message: lines.append(str(message)), level="ERROR")
    try:
        response = video_controller.delete_video(_request(), task_id)
    finally:
        logger.remove(sink)

    assert response["status"] == 200
    assert sm.state.get_task(task_id) is None
    assert current.exists()
    errors = [line for line in lines if "ERROR" in line]
    assert any(task_id in line for line in errors)
    assert not any(str(tmp_path) in line for line in errors)
    sm.state.delete_task(task_id)


def test_delete_video_cancels_a_live_modal_call_first(monkeypatch, tmp_path):
    from app.services import cpu_worker_dispatch as dispatch

    task_id = "delete-modal-1"
    monkeypatch.setenv("MPT_STORAGE_DIR", str(tmp_path))
    sm.state.update_task(
        task_id,
        user_id="u-1",
        state=const.TASK_STATE_PROCESSING,
        progress=40,
        remote_worker=dispatch.REMOTE_WORKER_VALUE,
        remote_call_id="fc-1",
    )
    current = Path(utils.task_dir()) / task_id
    current.mkdir()
    (current / "audio.mp3").write_text("audio", encoding="utf-8")
    cancelled: list[str] = []
    monkeypatch.setattr(
        dispatch,
        "_cancel_modal_call",
        lambda call_id: cancelled.append(call_id),
    )
    seen: dict[str, object] = {}

    real_rmtree = shutil.rmtree

    def _rmtree(path, *args, **kwargs):
        seen["cancelled_before_rmtree"] = list(cancelled)
        real_rmtree(path, *args, **kwargs)

    monkeypatch.setattr(shutil, "rmtree", _rmtree)

    response = video_controller.delete_video(_request(), task_id)

    assert cancelled == ["fc-1"]
    assert seen["cancelled_before_rmtree"] == ["fc-1"]
    assert sm.state.get_task(task_id) is None
    assert response["status"] == 200
    sm.state.delete_task(task_id)


def test_delete_video_does_not_cancel_a_local_task(monkeypatch, tmp_path):
    from app.services import cpu_worker_dispatch as dispatch

    task_id = "delete-local-1"
    monkeypatch.setenv("MPT_STORAGE_DIR", str(tmp_path))
    sm.state.update_task(
        task_id, user_id="u-1", state=const.TASK_STATE_PROCESSING, progress=40
    )
    current = Path(utils.task_dir()) / task_id
    current.mkdir()
    cancelled: list[str] = []
    monkeypatch.setattr(
        dispatch,
        "_cancel_modal_call",
        lambda call_id: cancelled.append(call_id),
    )

    response = video_controller.delete_video(_request(), task_id)

    assert cancelled == []
    assert response["status"] == 200
    sm.state.delete_task(task_id)
