"""Cancel-aware terminal transitions for the video pipeline.

A worker cancelled mid-stage can lose its files (`delete_video` removes
the task directory) and then raise, or return empty. Those paths must
abort like a stage-boundary cancel: no failed event, no terminal webhook,
no Discord alert, and no completed webhook. A task that was not cancelled
keeps the existing failure and completion behaviour.

`task.py` is over the file-size cap, so the branch lives here.
"""

from loguru import logger

from app.services.task_cancellation import is_cancelled
from app.services.task_cleanup import abort_if_cancelled, cleanup_task_intermediates

_OMIT = object()


def crash_or_stop(task_id, exc, params, stage, music_mood, preserved) -> None:
    """Handle an exception from `start`.

    A cancelled task is an abort (info log, milestone hook, intermediate
    cleanup) and returns without `_fail_task`. Anything else is today's
    crash path: error log, `_fail_task`, then cleanup that keeps
    ``preserved`` paths.
    """
    from app.services import task as task_mod
    from app.services.notify import safe_reason

    if is_cancelled(task_id):
        abort_if_cancelled(
            task_id, stage or "pipeline", task_mod._forget_milestone, stopped=True
        )
        return
    logger.exception("task %s crashed", task_id)
    task_mod._fail_task(
        task_id, safe_reason(exc), params, stage=stage, exc=exc, music_mood=music_mood
    )
    try:
        cleanup_task_intermediates(task_id, preserved)
    except OSError as cleanup_error:
        logger.warning(
            "failed to clean task intermediates for failed task %s: %s",
            task_id,
            cleanup_error,
        )


def fail_or_stop(task_id, error, params=None, stage=None, exc=_OMIT, **kwargs) -> None:
    """Record a stage failure, or abort when the task is already cancelled.

    Call sites that used `_fail_task` after a stage returned empty (the
    files vanished) or from inside a stage helper go through here, so a
    cancelled worker cannot emit a terminal failure.
    """
    from app.services import task as task_mod

    if is_cancelled(task_id):
        abort_if_cancelled(
            task_id, stage or "pipeline", task_mod._forget_milestone, stopped=True
        )
        return
    if exc is not _OMIT:
        kwargs["exc"] = exc
    task_mod._fail_task(task_id, error, params, stage=stage, **kwargs)


def finish_or_stop(task_id, params, stage, payload, **kwargs):
    """Complete a stage, or abort when the task is already cancelled.

    Returns ``payload`` after a real completion, or None when the caller
    must stop (no completed webhook).
    """
    from app.services import task as task_mod

    if is_cancelled(task_id):
        abort_if_cancelled(
            task_id, stage, task_mod._forget_milestone, stopped=True
        )
        return None
    task_mod._complete_task(task_id, params, **kwargs)
    return payload
