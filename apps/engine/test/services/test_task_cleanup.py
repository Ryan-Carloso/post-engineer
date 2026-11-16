"""Direct tests for the extracted task_cleanup helpers.

The helpers moved into their own module so task.py stays under the size
ratchet; these tests import them from their new home so mutation coverage
follows the code (mutmut rule in AGENTS.md).
"""

from pathlib import Path

from app.services.task_cleanup import (
    _first_http_url,
    abort_if_cancelled,
    cleanup_task_intermediates,
)
from app.services.task_cancellation import request_cancel
from app.utils import utils


def test_cleanup_removes_unpreserved_and_keeps_preserved(tmp_path, monkeypatch):
    monkeypatch.setenv("MPT_STORAGE_DIR", str(tmp_path))
    task_directory = Path(utils.task_dir("task-1"))
    preserved = task_directory / "final.mp4"
    removed = task_directory / "intermediate.wav"
    preserved.write_text("final", encoding="utf-8")
    removed.write_text("temporary", encoding="utf-8")

    cleanup_task_intermediates("task-1", [str(preserved)])

    assert preserved.is_file()
    assert not removed.exists()


def test_cleanup_missing_dir_is_noop(tmp_path, monkeypatch):
    monkeypatch.setenv("MPT_STORAGE_DIR", str(tmp_path))
    cleanup_task_intermediates("missing", [])


def test_cleanup_removes_emptied_subdirectory(tmp_path, monkeypatch):
    monkeypatch.setenv("MPT_STORAGE_DIR", str(tmp_path))
    task_directory = Path(utils.task_dir("task-subdir"))
    subdir = task_directory / "nested"
    subdir.mkdir()
    (subdir / "tmp.wav").write_text("tmp", encoding="utf-8")
    keep = task_directory / "final.mp4"
    keep.write_text("final", encoding="utf-8")

    cleanup_task_intermediates("task-subdir", [str(keep)])

    assert keep.is_file()
    assert not subdir.exists()


def test_cleanup_vanished_dir_is_noop(tmp_path, monkeypatch):
    monkeypatch.setenv("MPT_STORAGE_DIR", str(tmp_path))
    # The guard's only reachable shape in production: task_dir creates the
    # directory, so a missing dir means it vanished mid-cleanup.
    monkeypatch.setattr(
        "app.services.task_cleanup.utils.task_dir",
        lambda task_id: str(tmp_path / "gone" / task_id),
    )
    cleanup_task_intermediates("gone", [])


def test_abort_if_cancelled_true_only_when_cancelled(tmp_path, monkeypatch):
    monkeypatch.setenv("MPT_STORAGE_DIR", str(tmp_path))
    task_directory = Path(utils.task_dir("cancel-clean-1"))
    staged = task_directory / "stage.tmp"
    staged.write_text("tmp", encoding="utf-8")
    assert abort_if_cancelled("cancel-clean-1", "audio") is False
    assert staged.is_file()
    request_cancel("cancel-clean-1")
    assert abort_if_cancelled("cancel-clean-1", "audio") is True
    assert not staged.exists()


def test_abort_if_cancelled_stopped_logs_that_the_task_stopped(tmp_path, monkeypatch):
    from loguru import logger

    monkeypatch.setenv("MPT_STORAGE_DIR", str(tmp_path))
    task_directory = Path(utils.task_dir("cancel-stopped-1"))
    staged = task_directory / "audio.mp3"
    staged.write_text("tmp", encoding="utf-8")
    request_cancel("cancel-stopped-1")
    lines: list[str] = []
    sink = logger.add(lambda message: lines.append(str(message)), level="INFO")
    try:
        assert abort_if_cancelled("cancel-stopped-1", "audio", stopped=True) is True
    finally:
        logger.remove(sink)
    assert not staged.exists()
    assert any("cancelled, stopped during audio" in line for line in lines)
    assert not any("stopping before" in line for line in lines)


def test_abort_if_cancelled_runs_on_abort_hook_only_when_cancelled(tmp_path, monkeypatch):
    monkeypatch.setenv("MPT_STORAGE_DIR", str(tmp_path))
    calls: list[str] = []
    assert abort_if_cancelled("cancel-hook-1", "audio", calls.append) is False
    assert calls == []
    request_cancel("cancel-hook-1")
    assert abort_if_cancelled("cancel-hook-1", "audio", calls.append) is True
    assert calls == ["cancel-hook-1"]


def test_first_http_url_returns_first_url_or_none():
    assert _first_http_url(["/tmp/final.mp4", "https://cdn/a.mp4", "https://cdn/b.mp4"]) == "https://cdn/a.mp4"
    assert _first_http_url(["http://cdn/a.mp4"]) == "http://cdn/a.mp4"
    assert _first_http_url(["/tmp/final.mp4", ""]) is None
    assert _first_http_url(None) is None
    assert _first_http_url("https://cdn/a.mp4") is None
