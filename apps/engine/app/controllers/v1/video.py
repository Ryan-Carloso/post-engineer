import asyncio
import glob
import json
import os
import pathlib
import shutil
import time
from typing import Optional, Union

from fastapi import BackgroundTasks, Depends, Path, Query, Request, UploadFile
from fastapi.params import File
from fastapi.responses import RedirectResponse, StreamingResponse
from loguru import logger

from app.config import config
from app.controllers import base
from app.controllers.manager.base_manager import TaskQueueFullError
from app.controllers.manager.memory_manager import InMemoryTaskManager
from app.controllers.manager.redis_manager import RedisTaskManager
from app.controllers.v1.base import new_router
from app.models.exception import HttpException
from app.models import const
from app.models.schema import (
    AudioRequest,
    BgmRetrieveResponse,
    BgmUploadResponse,
    SubtitleRequest,
    TaskDeletionResponse,
    TaskQueryRequest,
    TaskQueryResponse,
    TaskResponse,
    PersonaParams,
    TaskVideoRequest,
    LipSyncQuality,
    VideoMaterialUploadResponse,
    VideoMaterialRetrieveResponse
)
from app.services import state as sm
from app.services import task as tm
from app.services import video_storage
from app.utils import file_security, upload_limits, utils

# Upload size caps: the handlers stream uploads in chunks instead of
# buffering the whole body in RAM.
_BGM_MAX_UPLOAD_BYTES = 50 * 1024 * 1024  # 50 MB
_VIDEO_MATERIAL_MAX_UPLOAD_BYTES = 500 * 1024 * 1024  # 500 MB

# Auth dependency
# router = new_router(dependencies=[Depends(base.verify_token)])
router = new_router()

_enable_redis = config.app.get("enable_redis", False)
_redis_host = config.app.get("redis_host", "localhost")
_redis_port = config.app.get("redis_port", 6379)
_redis_db = config.app.get("redis_db", 0)
_redis_password = config.app.get("redis_password", None)
_max_concurrent_tasks = config.app.get("max_concurrent_tasks", 5)
_max_queued_tasks = config.app.get("max_queued_tasks", 100)

redis_url = f"redis://:{_redis_password}@{_redis_host}:{_redis_port}/{_redis_db}"
# Select the task manager according to the configuration
if _enable_redis:
    task_manager = RedisTaskManager(
        max_concurrent_tasks=_max_concurrent_tasks,
        redis_url=redis_url,
        max_queued_tasks=_max_queued_tasks,
    )
else:
    task_manager = InMemoryTaskManager(
        max_concurrent_tasks=_max_concurrent_tasks,
        max_queued_tasks=_max_queued_tasks,
    )


def _sanitize_upload_filename(filename: str, request_id: str) -> str:
    # Browsers/clients sometimes include directory info, or even smuggle ../
    # traversal segments. Keep only the bare filename so the upload endpoint
    # never writes outside the target directory.
    normalized_name = (filename or "").replace("\\", "/").split("/")[-1].strip()
    if not normalized_name or normalized_name in {".", ".."}:
        raise HttpException(
            task_id=request_id,
            status_code=400,
            message=f"{request_id}: invalid filename",
        )
    return normalized_name


def _resolve_path_within_directory(base_dir: str, unsafe_path: str, request_id: str) -> str:
    try:
        return file_security.resolve_path_within_directory(base_dir, unsafe_path)
    except ValueError as exc:
        logger.warning(
            f"reject unsafe file path, request_id: {request_id}, path: {unsafe_path}, "
            f"error: {str(exc)}"
        )
        raise HttpException(
            task_id=request_id,
            status_code=404 if str(exc) == "file does not exist" else 403,
            message=f"{request_id}: invalid file path",
        )


def _finished_task(task_id: str, user_id: str, request_id: str) -> dict:
    """Return the task only when it COMPLETED.

    final-1.mp4 is written progressively by moviepy between progress 75 and
    100 (task.py), so a PROCESSING task whose file exists on disk is a
    half-written render. Serving it is how truncated videos reached users.
    Publishing reads the finished file straight off disk
    (fill_schedule/publish.py), never through this endpoint, so the gate
    cannot break the batch.

    404, not 403: indistinguishable from "does not exist", and it never
    confirms the file's existence to the caller.
    """
    task = sm.state.get_task(task_id, user_id=user_id)
    if task is None or task.get("state") != const.TASK_STATE_COMPLETE:
        raise HttpException(
            task_id=request_id,
            status_code=404,
            message=f"{request_id}: file not found",
        )
    return task


def _storage_fallback_redirect(
    request: Request, file_path: str, request_id: str, original_exc: HttpException
):
    """302 to the R2 object — the ONLY source for serving a video.

    Engine disk is ephemeral (a restart wipes every generated file) and the
    local path is no longer authoritative: final videos are archived and
    size-verified at generation time, so the archive is the source of truth
    and the local disk is never read for delivery. The task lookup is scoped
    to the caller's user_id, so one user's object can never leak to another.

    Re-raises the original 404 when there is no archived copy (or it cannot be
    signed) — which now means the upload never verified, and the task carries
    ``video_storage_error`` explaining why.
    """
    task_id = file_path.split("/")[0]
    auth = base.get_auth_context(request)
    task = sm.state.get_task(task_id, user_id=auth.user_id) or {}
    storage_path = task.get("video_storage_path")
    if isinstance(storage_path, str) and storage_path:
        signed_url = video_storage.create_signed_url(storage_path)
        if signed_url:
            logger.info(
                f"redirecting to archived object, request_id: {request_id}, "
                f"task_id: {task_id}, storage_path: {storage_path}"
            )
            return RedirectResponse(url=signed_url, status_code=302)
    archive_error = task.get("video_storage_error")
    if archive_error:
        logger.error(
            f"task {task_id} has no servable archive "
            f"(upload/verify failed at {archive_error}); video is unrecoverable"
        )
    raise original_exc


def _storage_redirect_if_archived(request: Request, task_id: str, request_id: str):
    """302 to the archived object when this task has a verified copy.

    Returns None when there is nothing archived (or it cannot be signed), so
    the caller decides the 404. The task lookup is scoped to the caller's
    user_id: one user's object can never be reached through another's task id.
    """
    auth = base.get_auth_context(request)
    task = sm.state.get_task(task_id, user_id=auth.user_id) or {}
    storage_path = task.get("video_storage_path")
    if isinstance(storage_path, str) and storage_path:
        signed_url = video_storage.create_signed_url(storage_path)
        if signed_url:
            logger.info(
                f"serving from archive, request_id: {request_id}, "
                f"task_id: {task_id}, storage_path: {storage_path}"
            )
            return RedirectResponse(url=signed_url, status_code=302)
    archive_error = task.get("video_storage_error")
    if archive_error:
        logger.error(
            f"task {task_id} has no servable archive (upload/verify failed at "
            f"{archive_error}); the video exists only on ephemeral local disk"
        )
    return None


def _validate_request_shape(
    tasks_dir: str, file_path: str, request_id: str, user_id: str
) -> str:
    """Validate the requested path and return the AUTHORITATIVE task id.

    The path is no longer opened (R2 serves the bytes), so this is purely the
    input guard. ``require_file=False`` is the point: the local file is
    irrelevant now — requiring it would 404 every archived video whose disk
    copy has been recycled, which is the normal state, not a failure.

    The task id is taken from the RESOLVED path, not from splitting the raw
    input: `wrong/../<task>/final-1.mp4` names <task>, and using the raw
    first segment ("wrong") would look the wrong task up and 404 a request
    that is perfectly valid.

    Returns the task id so callers gate on the same one the guard validated.
    """
    try:
        resolved = file_security.resolve_path_within_directory(
            tasks_dir, file_path, require_file=False
        )
    except ValueError as exc:
        logger.warning(
            f"reject unsafe file path, request_id: {request_id}, path: {file_path}, "
            f"error: {str(exc)}"
        )
        raise HttpException(
            task_id=request_id,
            status_code=403,
            message=f"{request_id}: invalid file path",
        )
    return _task_id_from_resolved_path(tasks_dir, resolved)


def _task_file_to_uri(file: str, endpoint: str, task_dir: str, request_id: str) -> str:
    if not isinstance(file, str):
        return file

    if file.startswith(("http://", "https://")):
        return file

    try:
        file_security.resolve_path_within_directory(task_dir, file)
    except ValueError as exc:
        # Task state should only ever hold artifact paths inside the task
        # directory. Don't build a URL from an abnormal path here — keep the
        # original value so historic bad data stays debuggable.
        logger.warning(
            f"skip unsafe task output path, request_id: {request_id}, path: {file}, "
            f"error: {str(exc)}"
        )
        return file

    logical_path = file
    if os.path.isabs(logical_path):
        relative_path = os.path.relpath(logical_path, task_dir)
    else:
        relative_path = os.path.relpath(os.path.join(task_dir, logical_path), task_dir)
    relative_path = relative_path.replace("\\", "/")
    uri_path = f"api/v1/download/{relative_path}"
    if endpoint:
        return f"{endpoint.rstrip('/')}/{uri_path}"
    return f"/{uri_path}"


def _task_id_from_resolved_path(task_dir: str, resolved_path: str) -> str:
    relative_path = os.path.relpath(resolved_path, task_dir)
    parts = pathlib.Path(relative_path).parts
    return parts[0] if parts else ""


@router.post("/videos", response_model=TaskResponse, summary="Generate a short video")
def create_video(
    background_tasks: BackgroundTasks, request: Request, body: TaskVideoRequest
):
    return create_task(request, body, stop_at="video")


def _persona_video_params(
    persona: PersonaParams,
    topic: str,
    goal: Optional[str],
    platform_ids: Optional[list],
    video_quality: LipSyncQuality,
    webhook_url: Optional[str] = None,
) -> TaskVideoRequest:
    """THE single builder for persona-video task params.

    Both the single-video endpoint (as a batch of one) and the batch
    endpoint go through this; there is no separate params construction
    for the single path.
    """
    max_script_characters = int(config.app.get("max_video_script_characters", 700))
    max_duration_seconds = int(config.app.get("max_video_duration_seconds", 40))
    # goal/platform_ids are optional per batch item; fall back to neutral
    # defaults so the prompt stays well-formed for the script LLM.
    goal_text = goal or "Create an engaging video about the topic."
    persona_prompt = (
        f"Create the script in {persona.language}. "
        f"Persona niche: {persona.niche}. "
        f"Speaking style: {persona.speaking_style}. "
        f"Audience: {persona.audience}. "
        f"Goal: {goal_text}. "
        "Write only the spoken words, with no headings or stage directions. "
        "Start with a standalone hook paragraph of 8 to 12 words designed to take "
        "3 to 6 seconds "
        "when spoken. The hook must contain complete sentences, end with terminal "
        "punctuation, and be followed by exactly one blank line. Continue the main "
        "content in a new paragraph. "
        f"Keep the script under {max_script_characters} characters and below "
        f"{max_duration_seconds} seconds when spoken."
    )
    return TaskVideoRequest(
        video_subject=topic,
        video_language=persona.language,
        persona=persona,
        platform_ids=platform_ids or [],
        video_quality=video_quality,
        paragraph_number=None,
        video_script_prompt=persona_prompt,
        webhook_url=webhook_url,
    )


@router.post("/subtitle", response_model=TaskResponse, summary="Generate subtitle only")
def create_subtitle(
    background_tasks: BackgroundTasks, request: Request, body: SubtitleRequest
):
    return create_task(request, body, stop_at="subtitle")


@router.post("/audio", response_model=TaskResponse, summary="Generate audio only")
def create_audio(
    background_tasks: BackgroundTasks, request: Request, body: AudioRequest
):
    return create_task(request, body, stop_at="audio")


def _persona_tracking_kwargs(
    body: Union[TaskVideoRequest, SubtitleRequest, AudioRequest],
) -> dict[str, str]:
    """persona_id for the task row (read back by the PostHog tracking
    context). Omitted when the request carries no persona, so the row —
    and the events — stay free of blank props."""
    persona = getattr(body, "persona", None)
    persona_id = getattr(persona, "id", None)
    if isinstance(persona_id, str) and persona_id:
        return {"persona_id": persona_id}
    return {}


def _generation_tracking_kwargs(
    body: Union[TaskVideoRequest, SubtitleRequest, AudioRequest],
) -> dict[str, str]:
    """generation_id for the task row (read back by the PostHog tracking
    context). Only TaskVideoRequest carries one; omitted when absent so
    the row — and the events — stay free of blank props."""
    generation_id = getattr(body, "generation_id", None)
    if isinstance(generation_id, str) and generation_id:
        return {"generation_id": generation_id}
    return {}


def _generation_id_for_task(task_id: str) -> str | None:
    """Best-effort: resolve the web generation_id for an engine task id.

    Used on the 404 path, where the task row is gone and the row-based
    tracking context can't help. A lost task is exceptional (not hot),
    so one indexed Supabase lookup is acceptable. Never raises: without
    Supabase credentials (or on any failure) the 404 still goes out,
    just without the generation_id property.
    """
    try:
        import requests

        base_url = os.getenv("SUPABASE_URL")
        key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        if not base_url or not key:
            return None
        resp = requests.get(
            f"{base_url.rstrip('/')}/rest/v1/video_generations",
            params={
                "select": "generation_id",
                "engine_task_id": f"eq.{task_id}",
                "limit": "1",
            },
            headers={"apikey": key, "Authorization": f"Bearer {key}"},
            timeout=5,
        )
        if resp.status_code != 200:
            return None
        rows = resp.json()
        if rows and isinstance(rows[0], dict):
            value = rows[0].get("generation_id")
            return value if isinstance(value, str) and value else None
        return None
    except Exception:  # noqa: BLE001 — telemetry degrades, the 404 still goes out
        return None


def create_task(
    request: Request,
    body: Union[TaskVideoRequest, SubtitleRequest, AudioRequest],
    stop_at: str,
):
    task_id = utils.get_uuid()
    request_id = base.get_task_id(request)
    auth = base.get_auth_context(request)
    try:
        task = {
            "task_id": task_id,
            "request_id": request_id,
            "params": body.model_dump(),
            "user_id": auth.user_id,
        }
        sm.state.update_task(
            task_id, user_id=auth.user_id, flow="direct", pipeline=stop_at,
            # New tasks start at explicit 0/PROCESSING: update_task() only
            # overwrites state/progress when they are passed, so the initial
            # values are set here rather than relying on defaults.
            state=const.TASK_STATE_PROCESSING,
            progress=0,
            # Identity for PostHog: the lifecycle events (started/progress/
            # failed/generated) read persona_id from the task row, so the
            # funnel can be broken down per persona instead of "unknown".
            **_persona_tracking_kwargs(body),
            **_generation_tracking_kwargs(body),
        )
        # Funnel entry: requested fires from on_accepted once the task is
        # ACCEPTED into the queue — strictly before the worker thread
        # starts on the immediate path, and never on a 429 queue-full
        # rejection.
        task_manager.add_task(
            tm.start,
            task_id=task_id,
            params=body,
            stop_at=stop_at,
            on_accepted=lambda: tm.track_generation_requested(
                task_id, user_id=auth.user_id, flow="direct", pipeline=stop_at,
                **_generation_tracking_kwargs(body),
            ),
        )
        logger.success(f"Task created: task_id={task_id}")
        return utils.get_response(200, task)
    except TaskQueueFullError as e:
        sm.state.delete_task(task_id)
        logger.warning(
            f"reject task because queue is full, request_id: {request_id}, task_id: {task_id}"
        )
        raise HttpException(
            task_id=task_id, status_code=429, message=f"{request_id}: {str(e)}"
        )
    except ValueError as e:
        raise HttpException(
            task_id=task_id, status_code=400, message=f"{request_id}: {str(e)}"
        )


@router.get("/tasks", response_model=TaskQueryResponse, summary="Get all tasks")
def get_all_tasks(request: Request, page: int = Query(1, ge=1), page_size: int = Query(10, ge=1)):
    auth = base.get_auth_context(request)
    tasks, total = sm.state.get_all_tasks(page, page_size, user_id=auth.user_id)

    response = {
        "tasks": tasks,
        "total": total,
        "page": page,
        "page_size": page_size,
    }
    return utils.get_response(200, response)



@router.get(
    "/tasks/{task_id}", response_model=TaskQueryResponse, summary="Query task status"
)
def get_task(
    request: Request,
    task_id: str = Path(..., description="Task ID"),
    query: TaskQueryRequest = Depends(),
):
    request_id = base.get_task_id(request)
    endpoint = config.app.get("endpoint", "").rstrip("/")
    auth = base.get_auth_context(request)
    task = sm.state.get_task(task_id, user_id=auth.user_id)
    if task:
        task_dir = utils.task_dir()
        response_task = dict(task)

        if "videos" in task:
            response_task["videos"] = [
                _task_file_to_uri(v, endpoint, task_dir, request_id)
                for v in task["videos"]
            ]
        if "combined_videos" in task:
            response_task["combined_videos"] = [
                _task_file_to_uri(v, endpoint, task_dir, request_id)
                for v in task["combined_videos"]
            ]
        final_videos = task.get("videos") or []
        if final_videos:
            # The authoritative finished render. Consumers must never guess
            # the filename (the web used to hardcode final-1.mp4); the key
            # is absent (not null) when the task has no finished videos.
            response_task["final_video"] = _task_file_to_uri(
                final_videos[0], endpoint, task_dir, request_id
            )
        # Whether a durable R2 archive exists (restart-proof
        # playback even after the ephemeral disk is wiped).
        response_task["has_archive"] = bool(task.get("video_storage_path"))
        return utils.get_response(200, response_task)

    raise HttpException(
        task_id=task_id,
        status_code=404,
        message=f"{request_id}: task not found",
        generation_id=_generation_id_for_task(task_id),
    )


@router.get(
    "/tasks/{task_id}/events",
    summary="Stream task progress via Server-Sent Events",
)
async def task_events(
    request: Request,
    task_id: str = Path(..., description="Task ID"),
):
    request_id = base.get_task_id(request)
    auth = base.get_auth_context(request)
    task = sm.state.get_task(task_id, user_id=auth.user_id)
    if not task:
        raise HttpException(
            task_id=task_id,
            status_code=404,
            message=f"{request_id}: task not found",
            generation_id=_generation_id_for_task(task_id),
        )
    return StreamingResponse(
        _task_event_stream(task_id, auth.user_id, request.is_disconnected),
        media_type="text/event-stream",
    )


SSE_POLL_SECONDS = 0.5
SSE_HEARTBEAT_SECONDS = 15


async def _task_event_stream(
    task_id: str,
    user_id: str,
    is_disconnected,
    poll_interval: float = SSE_POLL_SECONDS,
    heartbeat_interval: float = SSE_HEARTBEAT_SECONDS,
):
    """Yield SSE snapshots for a task until it terminates or disconnects.

    Emits ``data: {task_id, state, progress, stage}`` only when the snapshot
    changes, a ``:heartbeat`` comment to keep idle connections alive, and
    closes the stream after a terminal state (complete/failed).
    """
    last_snapshot = None
    last_heartbeat = time.monotonic()
    while True:
        if await is_disconnected():
            break
        task = sm.state.get_task(task_id, user_id=user_id)
        if task is None:
            break
        snapshot = {
            "task_id": task_id,
            "state": task.get("state"),
            "progress": task.get("progress", 0),
            "stage": task.get("stage"),
        }
        if snapshot != last_snapshot:
            yield f"data: {json.dumps(snapshot)}\n\n"
            last_snapshot = snapshot
            if snapshot["state"] in (
                const.TASK_STATE_COMPLETE,
                const.TASK_STATE_FAILED,
            ):
                break
        if time.monotonic() - last_heartbeat >= heartbeat_interval:
            yield ":heartbeat\n\n"
            last_heartbeat = time.monotonic()
        await asyncio.sleep(poll_interval)


@router.delete(
    "/tasks/{task_id}",
    response_model=TaskDeletionResponse,
    summary="Delete a generated short video task",
)
def delete_video(request: Request, task_id: str = Path(..., description="Task ID")):
    request_id = base.get_task_id(request)
    auth = base.get_auth_context(request)
    task = sm.state.get_task(task_id, user_id=auth.user_id)
    if task:
        tasks_dir = utils.task_dir()
        current_task_dir = os.path.join(tasks_dir, task_id)
        if os.path.exists(current_task_dir):
            shutil.rmtree(current_task_dir)

        sm.state.delete_task(task_id)
        logger.success(f"video deleted: task_id={task_id}")
        return utils.get_response(200)

    raise HttpException(
        task_id=task_id,
        status_code=404,
        message=f"{request_id}: task not found",
        generation_id=_generation_id_for_task(task_id),
    )


@router.get(
    "/musics", response_model=BgmRetrieveResponse, summary="Retrieve local BGM files"
)
def get_bgm_list(request: Request):
    suffix = "*.mp3"
    song_dir = utils.song_dir()
    files = glob.glob(os.path.join(song_dir, suffix))
    bgm_list = []
    for file in files:
        filename = os.path.basename(file)
        bgm_list.append(
            {
                "name": filename,
                "size": os.path.getsize(file),
                # Return only the filename — never expose the server's absolute
                # path to callers. The server resolves it back into the songs
                # allowlist directory when creating a task.
                "file": filename,
            }
        )
    response = {"files": bgm_list}
    return utils.get_response(200, response)


@router.post(
    "/musics",
    response_model=BgmUploadResponse,
    summary="Upload the BGM file to the songs directory",
)
def upload_bgm_file(request: Request, file: UploadFile = File(...)):
    request_id = base.get_task_id(request)
    safe_filename = _sanitize_upload_filename(file.filename, request_id)
    # check file ext
    if safe_filename.lower().endswith("mp3"):
        song_dir = utils.song_dir()
        save_path = os.path.join(song_dir, safe_filename)
        # Stream the upload with a 50 MB cap instead of buffering the whole
        # body in RAM; over-limit uploads get 413 and leave no partial file.
        try:
            upload_limits.save_upload_stream(
                file, save_path, max_bytes=_BGM_MAX_UPLOAD_BYTES
            )
        except upload_limits.UploadTooLargeError as exc:
            raise HttpException(
                request_id, status_code=413, message=f"{request_id}: {exc}"
            ) from exc
        response = {"file": safe_filename}
        return utils.get_response(200, response)

    raise HttpException(
        "", status_code=400, message=f"{request_id}: Only *.mp3 files can be uploaded"
    )

@router.get(
    "/video_materials", response_model=VideoMaterialRetrieveResponse, summary="Retrieve local video materials"
)
def get_video_materials_list(request: Request):
    allowed_suffixes = ("mp4", "mov", "avi", "flv", "mkv", "jpg", "jpeg", "png")
    local_videos_dir = utils.storage_dir("local_videos", create=True)
    files = []
    for suffix in allowed_suffixes:
        files.extend(glob.glob(os.path.join(local_videos_dir, f"*.{suffix}")))
    # Filesystem enumeration order is unstable; returning it directly would
    # make "sequential concat" behave differently across machines and runs.
    # Sort by filename so the server-side order is at least predictable.
    files.sort(key=lambda file_path: os.path.basename(file_path).lower())
    video_materials_list = []
    for file in files:
        filename = os.path.basename(file)
        video_materials_list.append(
            {
                "name": filename,
                "size": os.path.getsize(file),
                # Like BGM, return only the filename; it is resolved inside the
                # local_videos allowlist directory at task creation, so the
                # API never leaks host absolute paths.
                "file": filename,
            }
        )
    response = {"files": video_materials_list}
    return utils.get_response(200, response)


@router.post(
    "/video_materials",
    response_model=VideoMaterialUploadResponse,
    summary="Upload the video material file to the local videos directory",
)
def upload_video_material_file(request: Request, file: UploadFile = File(...)):
    request_id = base.get_task_id(request)
    safe_filename = _sanitize_upload_filename(file.filename, request_id)
    # check file ext
    allowed_suffixes = ("mp4", "mov", "avi", "flv", "mkv", "jpg", "jpeg", "png")
    normalized_filename = safe_filename.lower()
    # Validate by lowercase extension, so uppercase suffixes like .MOV work.
    if normalized_filename.endswith(allowed_suffixes):
        local_videos_dir = utils.storage_dir("local_videos", create=True)
        save_path = os.path.join(local_videos_dir, safe_filename)
        # Stream the upload with a 500 MB cap instead of buffering the whole
        # body in RAM; over-limit uploads get 413 and leave no partial file.
        try:
            upload_limits.save_upload_stream(
                file, save_path, max_bytes=_VIDEO_MATERIAL_MAX_UPLOAD_BYTES
            )
        except upload_limits.UploadTooLargeError as exc:
            raise HttpException(
                request_id, status_code=413, message=f"{request_id}: {exc}"
            ) from exc
        response = {"file": safe_filename}
        return utils.get_response(200, response)

    raise HttpException(
        "", status_code=400, message=f"{request_id}: Only files with extensions {', '.join(allowed_suffixes)} can be uploaded"
    )

@router.get("/stream/{file_path:path}")
async def stream_video(request: Request, file_path: str):
    request_id = base.get_task_id(request)
    tasks_dir = utils.task_dir()
    auth = base.get_auth_context(request)
    # R2 is the source of truth: the archived, size-verified object is served
    # and the ephemeral local disk is never consulted. The local path is only
    # resolved as a way to VALIDATE the request shape (task id + filename),
    # not as a file to read.
    task_id = _validate_request_shape(tasks_dir, file_path, request_id, auth.user_id)
    _finished_task(task_id, auth.user_id, request_id)
    redirect = _storage_redirect_if_archived(request, task_id, request_id)
    if redirect is not None:
        return redirect
    # No verified archive: the upload/verify step failed, so there is
    # intentionally nothing to serve. The task carries video_storage_error.
    raise HttpException(
        request_id,
        status_code=404,
        message=f"{request_id}: no archived video for this task",
    )


@router.get("/download/{file_path:path}")
async def download_video(request: Request, file_path: str):
    """
    Download the archived video.

    R2 is the source of truth and the local disk is never read: the archived,
    size-verified object is served through a time-limited signed URL, which
    also carries the attachment disposition R2 applies for a GET.

    :param request: Request request
    :param file_path: video file path, eg: /cd1727ed-3473-42a2-a7da-4faafafec72b/final-1.mp4
    :return: 302 to the signed archive URL, or 404 when nothing was archived
    """
    request_id = base.get_task_id(request)
    tasks_dir = utils.task_dir()
    auth = base.get_auth_context(request)
    task_id = _validate_request_shape(tasks_dir, file_path, request_id, auth.user_id)
    _finished_task(task_id, auth.user_id, request_id)
    redirect = _storage_redirect_if_archived(request, task_id, request_id)
    if redirect is not None:
        return redirect
    raise HttpException(
        request_id,
        status_code=404,
        message=f"{request_id}: no archived video for this task",
    )
