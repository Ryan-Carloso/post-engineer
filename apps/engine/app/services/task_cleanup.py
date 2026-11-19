"""Task-intermediate cleanup, extracted from task.py (size ratchet)."""

import os
import shutil
from collections.abc import Callable
from os import path
from typing import Sequence

from loguru import logger

from app.services.task_cancellation import is_cancelled
from app.utils import utils


def abort_if_cancelled(
    task_id: str,
    stage: str,
    on_abort: Callable[[str], None] | None = None,
    *,
    stopped: bool = False,
) -> bool:
    """Stop a cancelled pipeline before ``stage`` (issue #447).

    Logs once, runs the ``on_abort`` hook (the pipeline passes its
    milestone-cache pop so no boundary forgets it), removes intermediates,
    and returns True when the caller must return without running the
    stage; False otherwise.

    ``stopped=True`` is the mid-stage path: the stage already started and
    then lost its files (or returned empty) after the cancel mark. The log
    says the cancelled task stopped, instead of "stopping before".
    """
    if not is_cancelled(task_id):
        return False
    if stopped:
        logger.info(f"task {task_id} cancelled, stopped during {stage}")
    else:
        logger.info(f"task {task_id} cancelled, stopping before {stage}")
    if on_abort is not None:
        on_abort(task_id)
    cleanup_task_intermediates(task_id, ())
    return True


def _first_http_url(paths: object) -> str | None:
    """First http(s) URL in ``paths`` (local artifact paths are not URLs)."""
    if not isinstance(paths, (list, tuple)):
        return None
    for item in paths:
        if isinstance(item, str) and item.startswith(("http://", "https://")):
            return item
    return None


def remove_task_directory(task_id: str) -> None:
    """Remove a deleted task's directory; log loudly, never raise, on OSError.

    The caller deletes the state row first (so a running worker aborts),
    so the delete is already committed when this runs: raising would fail
    a committed delete, and a retry would 404, stranding the directory
    with no API recourse.
    """
    task_directory = utils.task_dir(task_id)
    if not path.isdir(task_directory):
        return
    try:
        shutil.rmtree(task_directory)
    except OSError as exc:
        logger.error(
            f"failed to remove task directory {path.basename(task_directory)} "
            f"for deleted task {task_id}: {type(exc).__name__} (errno {exc.errno})"
        )


def cleanup_task_intermediates(task_id: str, preserved_paths: Sequence[str]) -> None:
    """Remove task-local files except paths still needed for recovery/publishing."""
    task_directory = path.realpath(utils.task_dir(task_id))
    preserved = {
        path.realpath(file_path)
        for file_path in preserved_paths
        if file_path
    }

    if not path.isdir(task_directory):
        return

    for root, directories, files in os.walk(task_directory, topdown=False):
        for file_name in files:
            file_path = path.realpath(path.join(root, file_name))
            if file_path not in preserved:
                os.remove(file_path)
        for directory_name in directories:
            directory_path = path.join(root, directory_name)
            if not os.listdir(directory_path):
                os.rmdir(directory_path)
