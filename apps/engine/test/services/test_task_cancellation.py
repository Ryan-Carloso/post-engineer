"""Unit tests for the per-task cancellation registry.

The schedule cancel path (DELETE /api/schedule) and the engine delete
endpoint both mark a running pipeline task as cancelled; the task worker
reads this registry between stages. Registry operations are thread-safe
and idempotent.
"""

from app.services.task_cancellation import is_cancelled, request_cancel, forget


def test_task_is_not_cancelled_by_default():
    assert is_cancelled("never-seen-task") is False


def test_request_cancel_marks_task():
    request_cancel("cancel-me")
    assert is_cancelled("cancel-me") is True


def test_request_cancel_is_idempotent():
    request_cancel("cancel-twice")
    request_cancel("cancel-twice")
    assert is_cancelled("cancel-twice") is True


def test_forget_clears_cancel():
    request_cancel("forget-me")
    forget("forget-me")
    assert is_cancelled("forget-me") is False


def test_forget_unknown_is_noop():
    forget("never-seen-forget")
    assert is_cancelled("never-seen-forget") is False


def test_is_cancelled_separates_task_ids():
    request_cancel("task-a")
    assert is_cancelled("task-a") is True
    assert is_cancelled("task-b") is False
