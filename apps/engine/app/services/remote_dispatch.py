"""Run each video pipeline in its own Modal CPU container.

``start`` has the signature of ``app.services.task.start`` and replaces it
as the function every caller hands to the task manager (direct create,
fill-schedule batch, boot redispatch). With ``[modal_worker] app_name``
set, a video task is spawned on the ``modal_cpu_worker.py`` function that
fits it, the call id is stored on the task row, and the manager thread
waits for the call so the running-slot count stays honest. A failed spawn
runs the pipeline on a local thread instead, bounded by
``local_max_concurrent_tasks`` so a Modal outage cannot start every
running slot on the VPS at once. With no app name, ``start`` is
``task.start``.

The worker writes progress and the terminal state through the same
Supabase task row. When a call ends and the row is still not terminal
(the container was killed, timed out or ran out of memory), the waiting
thread fails the task through the normal failure path.
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass
from typing import Any, Callable

from loguru import logger

from app.config import config
from app.models import const
from app.services.cloned_voices.constants import CHATTERBOX_NANO_VOICE_PREFIX

FACELESS_FUNCTION = "render_faceless"
FACELESS_CLONE_FUNCTION = "render_faceless_clone"
LIPSYNC_FUNCTION = "render_lipsync"
WORKER_FUNCTIONS = (FACELESS_FUNCTION, FACELESS_CLONE_FUNCTION, LIPSYNC_FUNCTION)

CALL_ID_FIELD = "modal_call_id"
FUNCTION_FIELD = "modal_function"
WEBHOOK_FIELD = "webhook_url"
WORKER_STOPPED_ERROR = "render worker stopped before the video finished"
TERMINAL_STATES = (const.TASK_STATE_FAILED, const.TASK_STATE_COMPLETE)

_DEFAULT_POLL_SECONDS = 30.0
_DEFAULT_LOCAL_MAX = 1
_DEFAULT_MAX_WAIT_SECONDS = 14400 + 3600

_local_slots_lock = threading.Lock()
_local_slots: threading.BoundedSemaphore | None = None


def app_name() -> str:
    """The deployed worker app, or '' when dispatch is off."""
    return str(config.modal_worker.get("app_name", "") or "").strip()


def poll_seconds() -> float:
    return float(config.modal_worker.get("poll_seconds", _DEFAULT_POLL_SECONDS))


def max_wait_seconds() -> float:
    """Seconds in a row a waiter tolerates Modal going unanswered.

    The worker's longest timeout plus one hour of grace, so the dead waiter
    never beats a render that is still going.
    """
    return float(config.modal_worker.get("max_wait_seconds", _DEFAULT_MAX_WAIT_SECONDS))


@dataclass(frozen=True)
class _AdoptedParams:
    webhook_url: str | None = None


def _local_semaphore() -> threading.BoundedSemaphore:
    global _local_slots
    with _local_slots_lock:
        if _local_slots is None:
            limit = int(config.modal_worker.get("local_max_concurrent_tasks", _DEFAULT_LOCAL_MAX))
            _local_slots = threading.BoundedSemaphore(max(1, limit))
        return _local_slots


def _pipeline_start() -> Callable[..., Any]:
    from app.services import task as tm

    return tm.start


def _effective_voice(params: Any) -> str:
    from app.services.task import resolve_persona_audio

    voice_name, _voice_audio = resolve_persona_audio(params)
    return voice_name or ""


def worker_function_for(params: Any, voice_name: str) -> str:
    """Pick the worker function from the video type and the voice.

    Any lip-sync type goes to the lip-sync function (it calls LongCat and
    has the memory for a clone). A faceless clone needs 10 GiB for
    Chatterbox Nano; a faceless house voice fits in 4 GiB.
    """
    if getattr(params, "video_type", "faceless") != "faceless":
        return LIPSYNC_FUNCTION
    if voice_name.startswith(CHATTERBOX_NANO_VOICE_PREFIX):
        return FACELESS_CLONE_FUNCTION
    return FACELESS_FUNCTION


def worker_payload(params: Any) -> dict[str, Any]:
    """The JSON-safe params the worker validates back into a request."""
    return params.model_dump(mode="json")


def _modal() -> Any:
    import modal

    return modal


def spawn(
    task_id: str, params: Any, stop_at: str, modal_module: Any | None = None
) -> tuple[str, str] | None:
    """Spawn the task on its worker function.

    Returns ``(call_id, function_name)``, or None when the spawn failed
    (logged at error; the caller runs the task locally).
    """
    function_name = "unresolved"
    try:
        function_name = worker_function_for(params, _effective_voice(params))
        modal = modal_module if modal_module is not None else _modal()
        function = modal.Function.from_name(app_name(), function_name)
        call = function.spawn(task_id, worker_payload(params), stop_at)
        call_id = str(call.object_id)
    except Exception as exc:
        logger.error(
            f"modal worker spawn failed for task {task_id} on {function_name}; "
            f"running it locally: {type(exc).__name__}: {exc}"
        )
        return None
    logger.info(f"task {task_id} spawned on {function_name}, call {call_id}")
    return call_id, function_name


def _row_state(task_id: str) -> Any:
    from app.services import state as sm

    task = sm.state.get_task(task_id) or {}
    return task.get("state"), task.get("stage")


def _fail_unfinished(task_id: str, params: Any, reason: str) -> None:
    state, stage = _row_state(task_id)
    if state in TERMINAL_STATES:
        return
    from app.services.task_outcome import fail_or_stop

    logger.error(f"task {task_id}: {reason}; the task row was not terminal")
    fail_or_stop(task_id, WORKER_STOPPED_ERROR, params, stage=str(stage or "worker"))


def _cancel_remote(task_id: str, call: Any) -> None:
    from app.services import state as sm

    try:
        call.cancel(terminate_containers=True)
    except Exception as exc:
        logger.error(f"task {task_id}: cancelling the modal call failed: {exc}")
    try:
        sm.state.delete_task(task_id)
    except Exception as exc:
        logger.error(f"task {task_id}: deleting the cancelled row failed: {exc}")


def wait_for_call(
    task_id: str,
    call_id: str,
    params: Any,
    *,
    modal_module: Any | None = None,
    sleep: Callable[[float], None] = time.sleep,
    now: Callable[[], float] = time.monotonic,
) -> None:
    """Block until the call ends, then settle a row the worker left open."""
    from app.services.task_cancellation import is_cancelled

    reason = "the modal call ended"
    limit = max_wait_seconds()
    unreachable_since: float | None = None
    try:
        modal = modal_module if modal_module is not None else _modal()
        call = modal.FunctionCall.from_id(call_id)
    except Exception as exc:
        logger.error(f"task {task_id}: looking up modal call {call_id} failed: {exc}")
        return
    while True:
        if is_cancelled(task_id):
            _cancel_remote(task_id, call)
            return
        try:
            call.get(timeout=poll_seconds())
            break
        except TimeoutError:
            unreachable_since = None
            continue
        except modal.exception.InputCancellation:
            reason = "the modal call was cancelled"
            break
        except Exception as exc:
            if modal_unreachable(modal, exc):
                logger.warning(f"task {task_id}: polling modal call {call_id} failed: {exc}")
                if unreachable_since is None:
                    unreachable_since = now()
                sleep(poll_seconds())
                if now() - unreachable_since >= limit:
                    reason = f"modal did not answer within {int(limit)} seconds"
                    break
                continue
            reason = f"the modal call ended with {type(exc).__name__}: {exc}"
            break
    _fail_unfinished(task_id, params, reason)


def modal_unreachable(modal: Any, exc: BaseException) -> bool:
    """True when Modal itself could not answer, not when the call ended."""
    unreachable = (
        ConnectionError,
        modal.exception.ConnectionError,
        modal.exception.InternalError,
        modal.exception.ServiceError,
        modal.exception.AuthError,
        modal.exception.ClientClosed,
    )
    return isinstance(exc, unreachable)


def run_local(task_id: str, params: Any, stop_at: str) -> Any:
    with _local_semaphore():
        return _pipeline_start()(task_id, params, stop_at)


def pipeline_entry() -> Callable[..., Any]:
    """What callers hand to the task manager: ``start`` when dispatch is
    on, ``task.start`` itself when it is off."""
    if app_name():
        return start
    return _pipeline_start()


def start(task_id: str, params: Any, stop_at: str = "video") -> Any:
    """Has ``task.start``'s signature; returns None once the task is spawned
    (the worker's result stays in Modal)."""
    if not app_name():
        return _pipeline_start()(task_id, params, stop_at)
    if stop_at != "video":
        return run_local(task_id, params, stop_at)
    spawned = spawn(task_id, params, stop_at)
    if spawned is None:
        return run_local(task_id, params, stop_at)
    call_id, function_name = spawned
    from app.services import state as sm

    fields: dict[str, object] = {CALL_ID_FIELD: call_id, FUNCTION_FIELD: function_name}
    webhook_url = getattr(params, "webhook_url", None)
    if isinstance(webhook_url, str) and webhook_url:
        fields[WEBHOOK_FIELD] = webhook_url
    sm.state.update_task(task_id, **fields)
    wait_for_call(task_id, call_id, params)
    return None


def call_is_live(call_id: str, modal_module: Any | None = None) -> bool:
    """True while the call is still running (or Modal cannot answer).

    An unreachable Modal counts as live: re-running a render that is still
    going would pay for it twice (a lip-sync one on the GPU), while a row
    left open is settled by the adopted waiter once Modal answers.
    """
    modal = modal_module if modal_module is not None else _modal()
    try:
        modal.FunctionCall.from_id(call_id).get(timeout=0)
    except TimeoutError:
        return True
    except modal.exception.InputCancellation:
        return False
    except Exception as exc:
        if modal_unreachable(modal, exc):
            logger.error(f"modal call {call_id}: liveness check failed, treating it as live: {exc}")
            return True
        return False
    return False


def adopt_live_call(
    task_id: str,
    data: dict[str, Any],
    *,
    is_live: Callable[[str], bool] | None = None,
    spawn_thread: Callable[..., Any] | None = None,
) -> bool:
    """Boot triage: keep a task whose worker is still running.

    Returns True (claimed: no requeue, no redispatch, no refund) when the
    row names a modal call that is still running, and starts a waiter that
    fails the row if the call ends without a terminal state. Returns False
    otherwise, so the row falls through to the usual orphan triage.
    """
    call_id = data.get(CALL_ID_FIELD)
    if not isinstance(call_id, str) or not call_id:
        return False
    if not (is_live or call_is_live)(call_id):
        return False
    logger.info(f"orphan {task_id}: modal call {call_id} is still running; adopted")
    stored_webhook = data.get(WEBHOOK_FIELD)
    adopted_params = (
        _AdoptedParams(webhook_url=stored_webhook)
        if isinstance(stored_webhook, str) and stored_webhook
        else None
    )
    (spawn_thread or threading.Thread)(target=wait_for_call, args=(task_id, call_id, adopted_params), daemon=True).start()
    return True


__all__ = [
    "CALL_ID_FIELD",
    "FACELESS_CLONE_FUNCTION",
    "FACELESS_FUNCTION",
    "FUNCTION_FIELD",
    "LIPSYNC_FUNCTION",
    "WEBHOOK_FIELD",
    "WORKER_FUNCTIONS",
    "adopt_live_call",
    "call_is_live",
    "max_wait_seconds",
    "modal_unreachable",
    "pipeline_entry",
    "spawn",
    "start",
    "wait_for_call",
    "worker_function_for",
]
