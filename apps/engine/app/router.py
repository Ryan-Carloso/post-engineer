"""Application configuration - root APIRouter.

Defines all FastAPI application endpoints.

Resources:
    1. https://fastapi.tiangolo.com/tutorial/bigger-applications

"""

from fastapi import APIRouter

from app.controllers.v1 import llm, persona, temp_assets, video

root_api_router = APIRouter()
# v1
root_api_router.include_router(video.router)
root_api_router.include_router(llm.router)
root_api_router.include_router(persona.router)
# Authenticated upload + download by capability (see temp_assets.py)
root_api_router.include_router(temp_assets.upload_router)
root_api_router.include_router(temp_assets.router)
