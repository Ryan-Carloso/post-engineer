"""Persona API endpoints — stateless.

POST /api/v1/personas         — validate a persona payload (no persistence)
GET  /api/v1/personas/voices  — house voice catalog
"""

from typing import Optional

from fastapi import APIRouter
from fastapi.responses import JSONResponse, Response
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
def list_house_voices_endpoint():
    return BaseResponse(body=persona_service.get_house_voices())


@persona_router.get(
    "/personas/voices/sample-languages",
    response_model=BaseResponse,
    summary="Languages available for voice samples",
)
def list_sample_languages_endpoint():
    return BaseResponse(body=persona_service.get_sample_languages())


@persona_router.get(
    "/personas/voices/{voice_id}/sample",
    summary="Short TTS sample for a house voice (audio/mpeg)",
)
def voice_sample_endpoint(voice_id: str, language: str = "pt"):
    try:
        audio = persona_service.synthesize_voice_sample(voice_id, language=language)
    except persona_service.PersonaValidationError as e:
        return JSONResponse(
            status_code=400,
            content=utils.get_response(status=400, message=str(e)),
        )
    if audio is None:
        return JSONResponse(
            status_code=502,
            content=utils.get_response(
                status=502, message="voice sample synthesis failed"
            ),
        )
    return Response(content=audio, media_type="audio/mpeg")


router.include_router(persona_router)
