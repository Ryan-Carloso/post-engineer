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


@persona_router.get(
    "/personas/voices", response_model=BaseResponse, summary="House voice catalog"
)
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
    summary="Short TTS sample for a catalog voice (audio/mpeg)",
)
def voice_sample_endpoint(voice_id: str, language: str = "en"):
    # Samples are synthesized on demand by the local providers (the
    # catalog is English-only, so the sample text is the en-us one
    # regardless of the legacy `language` param) and cached per voice.
    sample = persona_service.get_voice_sample(voice_id)
    if sample is None:
        return JSONResponse(
            status_code=400,
            content=utils.get_response(
                status=400,
                message=f"voice sample unavailable for {voice_id}",
            ),
        )
    return Response(content=sample, media_type="audio/mpeg")


router.include_router(persona_router)
