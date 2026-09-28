"""Fire-and-forget terminal webhook for video tasks.

When a task reaches a terminal state (``completed``/``failed``), the engine
POSTs a small JSON payload to the caller-supplied ``webhook_url`` (if any):

    {"task_id": ..., "status": "completed|failed", "progress": 100,
     "video_url": ...|null, "error": ...}

Delivery is best-effort and never affects the task: the POST runs on a
short-lived daemon thread with a short timeout, and any delivery failure
only logs at ERROR (forwarded to Bugsink by the asgi sink). Each task
notifies at most once — the dedupe is a bounded deque with a lock, so a
task that fails in several phases still sends a single webhook.
"""

import threading
from collections import deque
from threading import Lock
from typing import Optional

import requests
from loguru import logger

WEBHOOK_TIMEOUT_SECONDS = 10

# Bound the dedupe cache so the process can't grow it forever (same
# pattern as the Discord failure-alert dedupe in app/services/task.py).
MAX_WEBHOOK_TASKS = 1000
_webhook_lock = Lock()
_notified_task_ids: deque[str] = deque(maxlen=MAX_WEBHOOK_TASKS)


def _already_notified(task_id: str) -> bool:
    """Atomically check-and-record ``task_id``; True when already sent."""
    with _webhook_lock:
        if task_id in _notified_task_ids:
            return True
        _notified_task_ids.append(task_id)
        return False


def _post(webhook_url: str, payload: dict, task_id: str) -> None:
    try:
        response = requests.post(
            webhook_url, json=payload, timeout=WEBHOOK_TIMEOUT_SECONDS
        )
        response.raise_for_status()
    except Exception as exc:  # noqa: BLE001 — delivery is best-effort by design
        # Never raise: a dead webhook must not fail or stall the task.
        # ERROR goes to Bugsink via the asgi sink so the user can see why
        # the callback never arrived.
        logger.bind(task_id=task_id).error(
            "terminal webhook delivery failed: {error}", error=str(exc)[:500]
        )


def notify_terminal_task(
    task_id: str,
    status: str,
    webhook_url: Optional[str],
    video_url: Optional[str] = None,
    error: Optional[str] = None,
) -> Optional[threading.Thread]:
    """Send the terminal webhook for ``task_id`` (at most once).

    Returns the worker thread (so tests can join it), or None when there
    is nothing to send.
    """
    if not webhook_url:
        return None
    if _already_notified(task_id):
        return None
    payload = {
        "task_id": task_id,
        "status": status,
        "progress": 100,
        "video_url": video_url,
    }
    if error is not None:
        payload["error"] = error
    thread = threading.Thread(
        target=_post,
        args=(webhook_url, payload, task_id),
        name=f"task-webhook-{task_id}",
        daemon=True,
    )
    thread.start()
    return thread
