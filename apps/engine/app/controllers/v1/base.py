from fastapi import APIRouter, Depends

from app.controllers import base


def new_router(dependencies=None):
    router = APIRouter()
    router.tags = ["V1"]
    router.prefix = "/api/v1"
    router.dependencies = [Depends(base.verify_token)]
    if dependencies:
        router.dependencies.extend(dependencies)
    return router
