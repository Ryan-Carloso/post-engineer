"""Direct tests for the extracted cleanup_task_intermediates helper.

The helper moved into its own module so task.py stays under the size
ratchet; these tests import it from its new home so mutation coverage
follows the code (mutmut rule in AGENTS.md).
"""

from pathlib import Path

from app.services.task_cleanup import abort_if_cancelled, cleanup_task_intermediates
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
