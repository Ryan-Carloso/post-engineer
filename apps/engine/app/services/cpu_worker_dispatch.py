"""Dispatch one image-only video onto a Modal CPU container.

Every faceless video, house voice or ``chatterbox_nano:`` clone, is
spawned on ``moneyprint-cpu-worker``. Lip-sync stays on the VPS because
it calls LongCat. A spawn failure falls back to the local thread.

Clone reference audio already lives in Supabase Storage (the ``personas``
bucket, path on ``cloned_voices.storage_path``). The worker downloads
that object once per container. The VPS ``tts_voices`` volume is only
the local TTS server's copy.

A spawned job is marked ``remote_worker=modal_cpu`` with ``job_params``
and ``remote_call_id`` on the task row before the VPS can restart. Boot
reconcile leaves a call that is still running alone. A row with params
and no call id is spawned again at boot.
"""

from __future__ import annotations

import os
from typing import Any, Callable

from loguru import logger

from app.models import const

APP_NAME_ENV = "MPT_CPU_WORKER_APP_NAME"
MAX_CONTAINERS_ENV = "MPT_CPU_WORKER_MAX_CONTAINERS"
DEFAULT_APP_NAME = "moneyprint-cpu-worker"
FUNCTION_NAME = "render_video"
REMOTE_WORKER_VALUE = "modal_cpu"
CLONE_PREFIX = "chatterbox_nano:"
DEFAULT_MAX_CONTAINERS = 30

Spawn = Callable[[str, dict[str, Any], str], str]
CallStatus = Callable[[str], str]


def worker_app_name() -> str:
    """Deployed app. ``MPT_CPU_WORKER_APP_NAME`` overrides the fixed default."""
    name = os.environ.get(APP_NAME_ENV, "").strip()
    return name or DEFAULT_APP_NAME


def configured_max_containers() -> int:
    """Ceiling on concurrent CPU containers. Default 30. Never a warm pool."""
    raw = os.environ.get(MAX_CONTAINERS_ENV)
    if raw is None:
        return DEFAULT_MAX_CONTAINERS
    raw = raw.strip()
    if raw == "":
        return DEFAULT_MAX_CONTAINERS
    if not raw.isdecimal():
        raise RuntimeError(
            f"{MAX_CONTAINERS_ENV} must be an integer >= {DEFAULT_MAX_CONTAINERS}"
        )
    value = int(raw)
    if value < DEFAULT_MAX_CONTAINERS:
        raise RuntimeError(
            f"{MAX_CONTAINERS_ENV}={value} is below {DEFAULT_MAX_CONTAINERS}"
        )
    return value


def _video_type(params: Any) -> str:
    if isinstance(params, dict):
        value = params.get("video_type")
    else:
        value = getattr(params, "video_type", "")
    enum_value = getattr(value, "value", None)
    if isinstance(enum_value, str):
        return enum_value
    return str(value or "")


def _voice_names(params: Any) -> list[str]:
    names: list[str] = []
    if isinstance(params, dict):
        voice = params.get("voice_name")
        if isinstance(voice, str) and voice:
            names.append(voice)
        persona = params.get("persona")
        if isinstance(persona, dict):
            voice_id = persona.get("voice_id")
            if isinstance(voice_id, str) and voice_id:
                names.append(voice_id)
        return names
    voice = getattr(params, "voice_name", None)
    if isinstance(voice, str) and voice:
        names.append(voice)
    persona = getattr(params, "persona", None)
    voice_id = getattr(persona, "voice_id", None) if persona is not None else None
    if isinstance(voice_id, str) and voice_id:
        names.append(voice_id)
    return names


def is_clone_voice(params: Any) -> bool:
    return any(name.startswith(CLONE_PREFIX) for name in _voice_names(params))


def should_dispatch(params: Any, stop_at: str) -> bool:
    """True for every faceless render, including clone voices."""
    if stop_at != "video":
        return False
    return _video_type(params) == "faceless"


def job_params_of(body: Any) -> dict[str, Any]:
    if isinstance(body, dict):
        return body
    dumped = body.model_dump(mode="json")
    if not isinstance(dumped, dict):
        raise RuntimeError("video params did not dump to an object")
    return dumped


def _clear_remote(state: Any, task_id: str) -> None:
    state.update_task(
        task_id,
        remote_worker="",
        remote_call_id="",
        job_params=None,
    )


def _require_modal_tokens() -> None:
    if not os.environ.get("MODAL_TOKEN_ID") or not os.environ.get("MODAL_TOKEN_SECRET"):
        raise RuntimeError(
            "MODAL_TOKEN_ID and MODAL_TOKEN_SECRET are required to call the CPU worker"
        )


def _modal_spawn(task_id: str, params: dict[str, Any], stop_at: str) -> str:
    _require_modal_tokens()
    import modal

    function = modal.Function.from_name(worker_app_name(), FUNCTION_NAME)
    call = function.spawn(task_id, params, stop_at)
    return str(getattr(call, "object_id", "") or "")


def _spawn(
    task_id: str,
    params: dict[str, Any],
    stop_at: str,
    spawn: Spawn | None,
) -> str:
    call_id = spawn(task_id, params, stop_at) if spawn is not None else _modal_spawn(
        task_id, params, stop_at
    )
    if not isinstance(call_id, str) or not call_id:
        raise RuntimeError("modal cpu spawn returned no call id")
    return call_id


def try_remote_dispatch(
    state: Any,
    task_id: str,
    body: Any,
    stop_at: str,
    on_accepted: Callable[[], None] | None = None,
    spawn: Spawn | None = None,
) -> tuple[bool, bool]:
    """Spawn when the job is eligible.

    Returns ``(spawned, on_accepted_already_ran)``. A spawn failure clears
    the remote marker and returns ``(False, False)`` so the caller can run
    the local thread with the original callback. ``on_accepted`` runs only
    after the call id is recorded, so a rejected job never reports
    requested. ``on_accepted`` errors propagate.
    """
    if not should_dispatch(body, stop_at):
        return False, False
    params = job_params_of(body)
    state.update_task(
        task_id,
        remote_worker=REMOTE_WORKER_VALUE,
        remote_call_id="",
        job_params=params,
    )
    try:
        call_id = _spawn(task_id, params, stop_at, spawn)
    except Exception as exc:
        logger.error(
            f"modal cpu spawn failed for {task_id}: {type(exc).__name__}"
        )
        _clear_remote(state, task_id)
        return False, False
    state.update_task(task_id, remote_call_id=call_id)
    accepted = False
    if on_accepted is not None:
        on_accepted()
        accepted = True
    return True, accepted


def accept_direct_task(
    task_manager: Any,
    task_id: str,
    body: Any,
    stop_at: str,
    user_id: str,
    persona_tracking: dict[str, Any],
    tracking: dict[str, Any],
    spawn: Spawn | None = None,
    event_tracking: dict[str, Any] | None = None,
) -> None:
    """Queue a direct task locally, or spawn a CPU container."""
    from app.services import state as sm
    from app.services import task as tm

    sm.state.update_task(
        task_id,
        user_id=user_id,
        flow="direct",
        pipeline=stop_at,
        state=const.TASK_STATE_QUEUED,
        progress=0,
        **persona_tracking,
        **tracking,
    )

    def on_accepted() -> None:
        tm.track_generation_requested(
            task_id,
            user_id=user_id,
            flow="direct",
            pipeline=stop_at,
            **tracking,
            **(event_tracking or {}),
        )

    spawned, accepted = try_remote_dispatch(
        sm.state, task_id, body, stop_at, on_accepted, spawn
    )
    if spawned:
        return
    task_manager.add_task(
        tm.start,
        task_id=task_id,
        params=body,
        stop_at=stop_at,
        on_accepted=None if accepted else on_accepted,
    )


def try_remote_batch(
    state: Any,
    task_id: str,
    request: Any,
    user_id: str,
    tracking_ids: dict[str, str],
    on_accepted: Callable[[], None] | None = None,
    spawn: Spawn | None = None,
) -> tuple[bool, bool]:
    """Spawn a batch slot without taking a local running slot.

    ``on_accepted`` runs only after the call id is recorded, so a spawn
    failure or a deferred slot never reports requested; the caller then
    runs the original callback on the local path instead.
    """
    if not should_dispatch(request, "video"):
        return False, False
    params = job_params_of(request)
    state.update_task(
        task_id,
        user_id=user_id,
        flow="batch",
        pipeline="video",
        state=const.TASK_STATE_PROCESSING,
        progress=0,
        remote_worker=REMOTE_WORKER_VALUE,
        remote_call_id="",
        job_params=params,
        **tracking_ids,
    )
    try:
        call_id = _spawn(task_id, params, "video", spawn)
    except Exception as exc:
        logger.error(
            f"modal cpu spawn failed for {task_id}: {type(exc).__name__}"
        )
        _clear_remote(state, task_id)
        return False, False
    state.update_task(task_id, remote_call_id=call_id)
    accepted = False
    if on_accepted is not None:
        on_accepted()
        accepted = True
    return True, accepted


_TERMINAL_CALL_ERRORS = frozenset(
    {
        "RemoteError",
        "FunctionTimeoutError",
        "OutputExpiredError",
        "NotFoundError",
    }
)


def _exception_means_call_finished(exc: BaseException) -> bool:
    """True when Modal is reporting that this call has ended.

    A poll timeout and every Modal client error stay open. ``grpclib``
    stream failures stay open too: the client retries, then re-raises
    that type, and the container may still be rendering. A result is
    different. Modal re-raises the container's own exception as that
    same type, so a normal ``RuntimeError`` or ``OSError`` means the
    call finished and boot triage may recover the task.
    """
    name = type(exc).__name__
    module = type(exc).__module__
    if not isinstance(module, str):
        return True
    if name in {"TimeoutError", "ExecutionTimeoutError"}:
        return False
    if module == "modal" or module.startswith("modal."):
        return name in _TERMINAL_CALL_ERRORS
    if module == "grpclib" or module.startswith("grpclib."):
        return False
    return True


def modal_call_status(call_id: str) -> str:
    """``running`` until this call is known to have ended.

    Client and transport failures stay ``running``, so a blip cannot
    refund a live render. A returned result, a container exception, a
    function timeout, or an expired or missing call is ``finished``.
    """
    try:
        import modal
    except Exception:
        return "running"
    try:
        modal.FunctionCall.from_id(call_id).get(timeout=0)
    except Exception as exc:
        if _exception_means_call_finished(exc):
            return "finished"
        return "running"
    return "finished"


def remote_worker_in_flight(data: Any, status_of: CallStatus | None = None) -> bool:
    """True when this non-terminal row is a Modal call that is still going."""
    if not isinstance(data, dict):
        return False
    if data.get("remote_worker") != REMOTE_WORKER_VALUE:
        return False
    call_id = data.get("remote_call_id")
    if not isinstance(call_id, str) or not call_id:
        return False
    checker = status_of if status_of is not None else modal_call_status
    return checker(call_id) == "running"


def _remote_rows(state: Any) -> list[dict[str, Any]]:
    request = getattr(state, "_request", None)
    if request is None:
        return []
    response = request(
        "GET",
        "select=task_id,data"
        f"&state=not.in.({const.TASK_STATE_FAILED},{const.TASK_STATE_COMPLETE})"
        "&data->>remote_worker=eq.modal_cpu"
        "&order=updated_at.asc&limit=100",
    )
    rows = response.json()
    if not isinstance(rows, list):
        return []
    return [row for row in rows if isinstance(row, dict)]


def resume_unspawned_cpu_jobs(state: Any, spawn: Spawn | None = None) -> int:
    """Spawn rows that were marked for Modal and never received a call id.

    Rows that already have a call id are left for reconcile, which skips
    them while the call is running.
    """
    started = 0
    for row in _remote_rows(state):
        data = row.get("data")
        if not isinstance(data, dict):
            continue
        if data.get("remote_worker") != REMOTE_WORKER_VALUE:
            continue
        call_id = data.get("remote_call_id")
        if isinstance(call_id, str) and call_id:
            continue
        params = data.get("job_params")
        if not isinstance(params, dict):
            continue
        task_id = row.get("task_id")
        if not isinstance(task_id, str) or not task_id:
            continue
        pipeline = data.get("pipeline")
        stop_at = pipeline if isinstance(pipeline, str) and pipeline else "video"
        try:
            new_id = _spawn(task_id, params, stop_at, spawn)
        except Exception as exc:
            logger.error(
                f"modal cpu resume failed for {task_id}: {type(exc).__name__}"
            )
            continue
        state.update_task(task_id, remote_call_id=new_id)
        started += 1
    return started
