"""Task-intermediate cleanup, extracted from task.py (size ratchet)."""

import os
from collections.abc import Callable
from os import path
from typing import Sequence

from loguru import logger

from app.services.task_cancellation import is_cancelled
from app.utils import utils


def abort_if_cancelled(
    task_id: str, stage: str, on_abort: Callable[[str], None] | None = None
) -> bool:
    """Stop a cancelled pipeline before ``stage`` (issue #447).

    Logs once, runs the ``on_abort`` hook (the pipeline passes its
    milestone-cache pop so no boundary forgets it), removes intermediates,
    and returns True when the caller must return without running the
    stage; False otherwise.
    """
    if not is_cancelled(task_id):
        return False
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
