"""Temporary asset storage for debug/debug-mode video generation.

The web app used to persist debug photo/voice uploads in the permanent
Supabase ``personas`` bucket. Those files are one-shot inputs: the engine
downloads them at task start and never needs them again. This module keeps
them out of permanent storage:

- ``POST /api/v1/temp_assets`` (authenticated): stores the upload in the
  engine's local ``storage/temp_assets`` directory under an unguessable
  UUID filename and returns a fetchable URL.
- ``GET /api/v1/temp_assets/{name}`` (token-gated, no bearer): serves the
  file so the engine can download it exactly like any other persona URL.
  The UUID filename is the capability — same trust model as a signed URL.

Files expire after ``TEMP_ASSET_TTL_SECONDS``; the sweeper runs on every
upload, so no background thread is required.
"""

import mimetypes
import os
import pathlib
import time

from fastapi import APIRouter, Request, UploadFile
from fastapi.params import File
from fastapi.responses import FileResponse

from app.config import config
from app.controllers import base
from app.controllers.v1.base import new_router
from app.models.exception import HttpException
from app.utils import file_security, upload_limits, utils

#---------------
# Routers: upload requires the bearer secret (same contract as the other
# v1 routes); download lives on an unauthenticated router because the engine
# itself fetches the URL without headers — the UUID name is the capability.
#---------------
upload_router = new_router()
router = APIRouter()
router.tags = ["V1"]
router.prefix = "/api/v1"

TEMP_ASSET_TTL_SECONDS = 60 * 60  # 1 hour — no job lives longer than that
_TEMP_ASSET_MAX_UPLOAD_BYTES = 50 * 1024 * 1024  # 50 MB

_ALLOWED_SUFFIXES = (
    "jpg", "jpeg", "png", "webp",
    "mp3", "wav", "m4a", "aac", "ogg", "flac", "webm",
)


def _temp_assets_dir() -> str:
    return utils.storage_dir("temp_assets", create=True)


def _purge_expired() -> None:
    now = time.time()
    try:
        entries = list(pathlib.Path(_temp_assets_dir()).iterdir())
    except OSError:
        return
    for entry in entries:
        try:
            if entry.is_file() and now - entry.stat().st_mtime > TEMP_ASSET_TTL_SECONDS:
                entry.unlink()
        except OSError:
            continue


def _sanitize_name(filename: str, request_id: str) -> str:
    normalized = (filename or "").replace("\\", "/").split("/")[-1].strip().lower()
    suffix = os.path.splitext(normalized)[1].lstrip(".")
    if suffix not in _ALLOWED_SUFFIXES:
        raise HttpException(
            task_id=request_id,
            status_code=400,
            message=f"{request_id}: only {', '.join(_ALLOWED_SUFFIXES)} files are allowed",
        )
    # The final name is always our own UUID — the client-supplied name never
    # touches the disk.
    return f"{utils.get_uuid(remove_hyphen=True)}.{suffix}"


def _public_base_url(request: Request) -> str:
    endpoint = str(config.app.get("endpoint", "") or "").rstrip("/")
    if endpoint:
        return endpoint
    return str(request.base_url).rstrip("/")


@upload_router.post(
    "/temp_assets",
    summary="Store a temporary input asset (debug flow)",
)
def upload_temp_asset(request: Request, file: UploadFile = File(...)):
    base.get_auth_context(request)
    request_id = base.get_task_id(request)
    _purge_expired()
    name = _sanitize_name(file.filename, request_id)
    save_path = os.path.join(_temp_assets_dir(), name)
    # Stream the upload with a 50 MB cap instead of buffering the whole body
    # in RAM; over-limit uploads get 413 and leave no partial file.
    try:
        upload_limits.save_upload_stream(
            file, save_path, max_bytes=_TEMP_ASSET_MAX_UPLOAD_BYTES
        )
    except upload_limits.UploadTooLargeError as exc:
        raise HttpException(
            request_id, status_code=413, message=f"{request_id}: {exc}"
        ) from exc
    url = f"{_public_base_url(request)}/api/v1/temp_assets/{name}"
    return utils.get_response(200, {"url": url})


@router.get("/temp_assets/{name}")
def get_temp_asset(request: Request, name: str):
    request_id = base.get_task_id(request)
    base_dir = _temp_assets_dir()
    try:
        file_path = file_security.resolve_path_within_directory(base_dir, os.path.join(base_dir, name))
    except ValueError as exc:
        raise HttpException(
            task_id=request_id,
            status_code=404,
            message=f"{request_id}: temp asset not found",
        ) from exc
    if not os.path.isfile(file_path):
        raise HttpException(
            task_id=request_id,
            status_code=404,
            message=f"{request_id}: temp asset not found",
        )
    media_type = mimetypes.guess_type(file_path)[0] or "application/octet-stream"
    return FileResponse(path=file_path, media_type=media_type)
