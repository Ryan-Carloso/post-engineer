"""Persona API endpoints — stateless.

POST /api/v1/personas         — validate a persona payload (no persistence)
GET  /api/v1/personas/voices  — house voice catalog
"""

from typing import Optional

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, Response

from app.controllers import base
from pydantic import BaseModel

from app.controllers.v1.base import new_router
from app.models.schema import BaseResponse
from app.services import persona as persona_service
from app.utils import utils

router = new_router()
persona_router = APIRouter()


class PersonaRequest(BaseModel):
    name: str = ""
    photo_url: Optional[str] = None
    avatar_url: Optional[str] = None
    voice_id: Optional[str] = None
    voice_audio_url: Optional[str] = None


@persona_router.post(
    "/personas",
    response_model=BaseResponse,
    summary="Validate a persona payload (stateless — no persistence)",
)
def validate_persona_endpoint(request: PersonaRequest):
    try:
        normalized = persona_service.validate_persona(
            name=request.name,
            photo_url=request.photo_url,
            avatar_url=request.avatar_url,
            voice_id=request.voice_id,
            voice_audio_url=request.voice_audio_url,
        )
    except persona_service.PersonaValidationError as e:
        return JSONResponse(
            status_code=400,
            content=utils.get_response(status=400, message=str(e)),
        )
    return BaseResponse(body=normalized)


@persona_router.get("/personas/voices", response_model=BaseResponse, summary="House voice catalog")
def list_house_voices_endpoint(request: Request):
    auth = base.get_auth_context(request)
    return BaseResponse(body=persona_service.get_house_voices(user_id=auth.user_id))


@persona_router.get(
    "/personas/voices/sample-languages",
    response_model=BaseResponse,
    summary="Languages available for voice samples",
)
def list_sample_languages_endpoint():
    # Voice previews died with the per-language house voices: Chatterbox is
    # zero-shot cloning with a single voice list, so there is no per-language
    # sample matrix to expose. Answer with the one language the voices speak
    # instead of failing, so the UI's language picker keeps working.
    return BaseResponse(body=[{"code": "en", "label": "English"}])


@persona_router.get(
    "/personas/voices/{voice_id}/sample",
    summary="Short TTS sample for a house voice (audio/mpeg)",
)
def voice_sample_endpoint(voice_id: str, language: str = "pt"):
    # Explicit 501, not a silent degradation: the preview used to come from the
    # Azure house-voice matrix, which no longer exists. Returning silence or a
    # redirect would let the UI render a "sample" the user never asked for.
    return JSONResponse(
        status_code=501,
        content=utils.get_response(
            status=501,
            message="voice previews are unavailable: the voice catalog no longer "
            "maps per-language samples",
        ),
    )


class HouseVoicePreviewRequest(BaseModel):
    """Optional JSON body of the house preview endpoint: ``{"text": "..."}``.

    Only the string type is enforced here — a malformed body or a
    non-string text fails pydantic validation, which the app maps to a
    400. The trimmed-length check lives in validate_preview_text, so a
    string longer than the cap that trims into range is still accepted.
    """

    text: str | None = None


@persona_router.post(
    "/personas/voices/{voice_id}/preview",
    summary="TTS preview for a house voice (audio/mpeg)",
    # Plain Response (no media type): the handler always returns an
    # explicit Response/JSONResponse, so this only stops FastAPI from
    # auto-documenting a 200 application/json — the 200 content below
    # is then exactly audio/mpeg.
    response_class=Response,
    responses={
        200: {
            "description": "MP3 audio preview",
            "content": {"audio/mpeg": {"schema": {"type": "string", "format": "binary"}}},
        },
        400: {
            "description": "Invalid preview text (empty after trim or over 300 chars)",
            "content": {
                "application/json": {"schema": {"$ref": "#/components/schemas/BaseResponse"}}
            },
        },
        404: {
            "description": "Voice not found in the house catalog",
            "content": {
                "application/json": {"schema": {"$ref": "#/components/schemas/BaseResponse"}}
            },
        },
        502: {
            "description": "TTS synthesis failed",
            "content": {
                "application/json": {"schema": {"$ref": "#/components/schemas/BaseResponse"}}
            },
        },
    },
)
def preview_house_voice_endpoint(
    request: Request,
    voice_id: str,
    body: HouseVoicePreviewRequest | None = None,
):
    auth = base.get_auth_context(request)
    try:
        audio = persona_service.preview_house_voice_mp3(
            auth.user_id, voice_id, text=body.text if body is not None else None
        )
    except persona_service.HouseVoicePreviewError as exc:
        return JSONResponse(
            status_code=exc.status_code,
            content=utils.get_response(status=exc.status_code, message=exc.message),
        )
    return Response(content=audio, media_type="audio/mpeg")


router.include_router(persona_router)
