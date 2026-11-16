"""Direct tests for cancel-aware terminal transitions.

The helpers live in their own module so task.py stays under the size
ratchet. These tests import them from that module so the mutmut shard
attributes cases to it.
"""

from pathlib import Path

from loguru import logger

from app.services import task as tm
from app.services.task_cancellation import request_cancel
from app.services.task_outcome import crash_or_stop, fail_or_stop, finish_or_stop
from app.utils import utils


class _Params:
    webhook_url = None
    video_title = "outcome"


def _logs():
    lines: list[str] = []
    sink = logger.add(lambda message: lines.append(str(message)), level="INFO")
    return lines, sink


def test_crash_or_stop_aborts_when_cancelled(monkeypatch, tmp_path):
    monkeypatch.setenv("MPT_STORAGE_DIR", str(tmp_path))
    task_id = "outcome-crash-cancel"
    request_cancel(task_id)
    tm._progress_milestones[task_id] = 50
    staged = Path(utils.task_dir(task_id)) / "audio.mp3"
    staged.write_text("audio", encoding="utf-8")
    calls: list[tuple] = []
    monkeypatch.setattr(tm, "_fail_task", lambda *a, **k: calls.append(a))
    lines, sink = _logs()
    try:
        try:
            raise FileNotFoundError("/app/storage/tasks/outcome-crash-cancel/audio.mp3")
        except FileNotFoundError as exc:
            crash_or_stop(task_id, exc, _Params(), "audio", "pending", [str(staged)])
    finally:
        logger.remove(sink)
        tm._progress_milestones.pop(task_id, None)

    assert calls == []
    assert not staged.exists()
    assert task_id not in tm._progress_milestones
    assert any("cancelled, stopped" in line for line in lines)
    assert not any("crashed" in line for line in lines)


def test_crash_or_stop_fails_and_keeps_preserved_paths(monkeypatch, tmp_path):
    monkeypatch.setenv("MPT_STORAGE_DIR", str(tmp_path))
    task_id = "outcome-crash-fail"
    kept = Path(utils.task_dir(task_id)) / "final.mp4"
    dropped = Path(utils.task_dir(task_id)) / "audio.mp3"
    kept.write_text("final", encoding="utf-8")
    dropped.write_text("audio", encoding="utf-8")
    calls: list[tuple] = []
    monkeypatch.setattr(tm, "_fail_task", lambda *a, **k: calls.append((a, k)))
    lines, sink = _logs()
    try:
        try:
            raise RuntimeError("render blew up")
        except RuntimeError as exc:
            crash_or_stop(task_id, exc, _Params(), "render", "calm", [str(kept)])
    finally:
        logger.remove(sink)

    assert len(calls) == 1
    assert calls[0][0][0] == task_id
    assert calls[0][1]["stage"] == "render"
    assert calls[0][1]["music_mood"] == "calm"
    assert kept.is_file()
    assert not dropped.exists()
    assert any("crashed" in line for line in lines)


def test_crash_or_stop_logs_when_cleanup_raises(monkeypatch, tmp_path):
    monkeypatch.setenv("MPT_STORAGE_DIR", str(tmp_path))
    task_id = "outcome-crash-oserror"
    calls: list[str] = []
    monkeypatch.setattr(tm, "_fail_task", lambda *a, **k: calls.append("fail"))

    def _boom(*args, **kwargs):
        raise OSError("disk full")

    monkeypatch.setattr("app.services.task_outcome.cleanup_task_intermediates", _boom)
    lines, sink = _logs()
    try:
        try:
            raise RuntimeError("boom")
        except RuntimeError as exc:
            crash_or_stop(task_id, exc, _Params(), "render", "calm", [])
    finally:
        logger.remove(sink)

    assert calls == ["fail"]
    assert any("failed to clean task intermediates" in line for line in lines)


def test_fail_or_stop_aborts_when_cancelled_and_fails_otherwise(monkeypatch):
    task_id = "outcome-fail-cancel"
    request_cancel(task_id)
    tm._progress_milestones[task_id] = 70
    calls: list[str] = []
    monkeypatch.setattr(tm, "_fail_task", lambda *a, **k: calls.append("fail"))
    try:
        fail_or_stop(task_id, "failed to generate final videos", _Params(), stage="render")
    finally:
        tm._progress_milestones.pop(task_id, None)
    assert calls == []
    assert task_id not in tm._progress_milestones

    other = "outcome-fail-real"
    fail_or_stop(other, "failed to generate audio", _Params(), stage="audio")
    assert calls == ["fail"]


def test_finish_or_stop_returns_payload_only_when_not_cancelled(monkeypatch):
    task_id = "outcome-finish-cancel"
    request_cancel(task_id)
    tm._progress_milestones[task_id] = 50
    calls: list[str] = []
    monkeypatch.setattr(tm, "_complete_task", lambda *a, **k: calls.append("complete"))
    try:
        assert finish_or_stop(task_id, _Params(), "script", {"script": "x"}, script="x") is None
    finally:
        tm._progress_milestones.pop(task_id, None)
    assert calls == []
    assert task_id not in tm._progress_milestones

    other = "outcome-finish-real"
    payload = {"script": "hello"}
    assert finish_or_stop(other, _Params(), "script", payload, script="hello") is payload
    assert calls == ["complete"]
