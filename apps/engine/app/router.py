"""Application configuration - root APIRouter.

Defines all FastAPI application endpoints.

Resources:
    1. https://fastapi.tiangolo.com/tutorial/bigger-applications

"""

from fastapi import APIRouter

from app.controllers.v1 import audio_preflight, cloned_voices, image_short, media_check, persona, temp_assets, video

root_api_router = APIRouter()
root_api_router.include_router(video.router)
root_api_router.include_router(audio_preflight.router)
root_api_router.include_router(persona.router)
root_api_router.include_router(cloned_voices.router)
root_api_router.include_router(temp_assets.upload_router)
root_api_router.include_router(temp_assets.router)
root_api_router.include_router(media_check.router)
root_api_router.include_router(image_short.router)
