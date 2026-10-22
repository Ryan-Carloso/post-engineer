"""Per-user Chatterbox cloned voice API (engine-authenticated)."""

from __future__ import annotations

import re
from typing import Any

from fastapi import BackgroundTasks, File, Form, Request, UploadFile
from fastapi.responses import JSONResponse, Response

from app.controllers import base
from app.controllers.v1.base import new_router
from app.models.schema import BaseResponse
from app.services.cloned_voices.audio import ReferenceAudioError
from app.services.cloned_voices.constants import (
    CHATTERBOX_VOICE_PREFIX,
    ERROR_AUDIO_TOO_LARGE,
    ERROR_NAME_TOO_LONG,
    ERROR_NOT_FOUND,
    ERROR_NOT_READY,
    MAX_CLONE_NAME_LENGTH,
    MAX_REFERENCE_BYTES,
)
from app.services.cloned_voices.service import ClonedVoiceService
from app.utils import utils

router = new_router()
cloned_router = router


def _public_row(row: dict[str, Any]) -> dict[str, Any]:
    engine_key = row.get("engine_voice_key")
    voice_id = (
        f"{CHATTERBOX_VOICE_PREFIX}{engine_key}"
        if isinstance(engine_key, str) and engine_key
        else None
    )
    return {
        "id": row.get("id"),
        "status": row.get("status"),
        "language": row.get("language"),
        "name": row.get("name"),
        "voice_id": voice_id,
        "error_code": row.get("error_code"),
        "consent_at": row.get("consent_at"),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
    }


def _audio_too_large_response() -> JSONResponse:
    return JSONResponse(
        status_code=400,
        content=utils.get_response(
            status=400,
            message=f"reference audio exceeds {MAX_REFERENCE_BYTES // 1024 // 1024} MB",
            body={"error_code": ERROR_AUDIO_TOO_LARGE},
        ),
    )


@cloned_router.get(
    "/cloned-voices",
    response_model=BaseResponse,
    summary="List the caller's cloned voices",
)
def list_cloned_voices(request: Request):
    auth = base.get_auth_context(request)
    service = ClonedVoiceService()
    rows = service._store.list_for_user(auth.user_id)
    return BaseResponse(body=[_public_row(row) for row in rows])


@cloned_router.get(
    "/cloned-voices/{clone_id}",
    response_model=BaseResponse,
    summary="Get one cloned voice (status polling)",
)
def get_cloned_voice(request: Request, clone_id: str):
    auth = base.get_auth_context(request)
    service = ClonedVoiceService()
    row = service._store.get_for_user(auth.user_id, clone_id)
    if row is None:
        return JSONResponse(
            status_code=404,
            content=utils.get_response(status=404, message="cloned voice not found"),
        )
    return BaseResponse(body=_public_row(row))


def _read_bounded_upload(file: UploadFile) -> bytes | JSONResponse:
    """Read an upload bounded by MAX_REFERENCE_BYTES (never buffer unbounded)."""
    if file.size is not None and file.size > MAX_REFERENCE_BYTES:
        return _audio_too_large_response()
    try:
        source_bytes = file.file.read(MAX_REFERENCE_BYTES + 1)
    except Exception:
        return JSONResponse(
            status_code=400,
            content=utils.get_response(status=400, message="could not read upload"),
        )
    if len(source_bytes) > MAX_REFERENCE_BYTES:
        return _audio_too_large_response()
    return source_bytes


@cloned_router.post(
    "/cloned-voices/clean-preview",
    summary="Cleaned reference audio for A/B preview (audio/wav)",
)
def clean_preview_cloned_voice(
    request: Request,
    file: UploadFile = File(...),
):
    base.get_auth_context(request)
    source = _read_bounded_upload(file)
    if isinstance(source, JSONResponse):
        return source
    service = ClonedVoiceService()
    try:
        wav_bytes = service.clean_preview_wav(source)
    except ReferenceAudioError as exc:
        # The stable error_code is the contract; the message stays
        # generic so no internal detail leaks through the exception.
        return JSONResponse(
            status_code=400,
            content=utils.get_response(
                status=400,
                message="invalid reference audio",
                body={"error_code": exc.error_code},
            ),
        )
    return Response(content=wav_bytes, media_type="audio/wav")


@cloned_router.post(
    "/cloned-voices",
    response_model=BaseResponse,
    summary="Register reference audio as a cloned Chatterbox voice",
)
def create_cloned_voice(
    request: Request,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    language: str = Form(...),
    consent: str = Form(...),
    name: str = Form(""),
    use_cleaned: str = Form("true"),
):
    auth = base.get_auth_context(request)
    request_id = base.get_task_id(request)
    consent_acknowledged = consent.strip().lower() == "true"
    lang = (language or "").strip()
    if not lang:
        return JSONResponse(
            status_code=400,
            content=utils.get_response(status=400, message="language is required"),
        )
    # The language is persisted on the clone row; only BCP-47-shaped
    # codes are accepted.
    if not re.fullmatch(r"[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?", lang):
        return JSONResponse(
            status_code=400,
            content=utils.get_response(status=400, message="language is invalid"),
        )
    clone_name = (name or "").strip()
    if len(clone_name) > MAX_CLONE_NAME_LENGTH:
        return JSONResponse(
            status_code=400,
            content=utils.get_response(
                status=400,
                message=f"name exceeds {MAX_CLONE_NAME_LENGTH} characters",
                body={"error_code": ERROR_NAME_TOO_LONG},
            ),
        )
    use_cleaned_flag = use_cleaned.strip().lower()
    if use_cleaned_flag not in ("true", "false"):
        return JSONResponse(
            status_code=400,
            content=utils.get_response(status=400, message="use_cleaned is invalid"),
        )

    source = _read_bounded_upload(file)
    if isinstance(source, JSONResponse):
        return source

    service = ClonedVoiceService()
    try:
        created = service.create_from_upload(
            auth.user_id,
            source,
            lang,
            consent_acknowledged=consent_acknowledged,
            name=clone_name or None,
            use_cleaned=use_cleaned_flag == "true",
        )
    except ReferenceAudioError as exc:
        return JSONResponse(
            status_code=400,
            content=utils.get_response(
                status=400,
                message=str(exc),
                body={"error_code": exc.error_code},
            ),
        )

    row = created["row"]
    clone_id = row.get("id")
    if isinstance(clone_id, str):
        background_tasks.add_task(
            service.complete_registration,
            auth.user_id,
            clone_id,
            created["wav_bytes"],
            created["language"],
        )

    payload = BaseResponse(
        status=202,
        message=f"{request_id}: cloned voice registration started",
        body=_public_row(row),
    )
    return JSONResponse(status_code=202, content=payload.model_dump())


@cloned_router.post(
    "/cloned-voices/{clone_id}/preview",
    summary="TTS preview for a ready cloned voice (audio/mpeg)",
)
def preview_cloned_voice(request: Request, clone_id: str, language: str | None = None):
    auth = base.get_auth_context(request)
    service = ClonedVoiceService()
    try:
        audio_bytes = service.preview_mp3(auth.user_id, clone_id, language=language)
    except ReferenceAudioError as exc:
        status = 404 if exc.error_code == ERROR_NOT_FOUND else 400
        if exc.error_code == ERROR_NOT_READY:
            status = 409
        return JSONResponse(
            status_code=status,
            content=utils.get_response(
                status=status,
                message=str(exc),
                body={"error_code": exc.error_code},
            ),
        )
    return Response(content=audio_bytes, media_type="audio/mpeg")


@cloned_router.delete(
    "/cloned-voices/{clone_id}",
    response_model=BaseResponse,
    summary="Delete a cloned voice",
)
def delete_cloned_voice(request: Request, clone_id: str):
    auth = base.get_auth_context(request)
    service = ClonedVoiceService()
    deleted = service.delete(auth.user_id, clone_id)
    if not deleted:
        return JSONResponse(
            status_code=404,
            content=utils.get_response(status=404, message="cloned voice not found"),
        )
    return BaseResponse(body={"deleted": True, "id": clone_id})
