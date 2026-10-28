"""POST /api/v1/media/check — mechanical check of one image URL.

The MCP check_media tool's engine side: the web route authenticates the
user, then calls here with the server secret, and this endpoint runs
the SSRF-safe download and the mechanical checks in user_media
(download refusal, real image type, size bounds, face detection) and
returns a single code. No judgement, no relevance score, and the URL is
never logged: a URL can carry credentials in its query string.
"""

import tempfile

from fastapi import Request
from pydantic import BaseModel, Field

from app.controllers import base
from app.controllers.v1.base import new_router
from app.models.exception import HttpException
from app.services import user_media
from app.utils import utils

router = new_router()


class MediaCheckRequest(BaseModel):
    url: str = Field(max_length=2048)


@router.post(
    "/media/check",
    summary="Mechanically check one image URL (MCP check_media)",
)
def check_media(request: Request, body: MediaCheckRequest):
    base.get_auth_context(request)
    request_id = base.get_task_id(request)
    if not body.url.startswith(("http://", "https://")):
        raise HttpException(
            task_id=request_id,
            status_code=400,
            message=f"{request_id}: url must be an http(s) URL",
        )
    with tempfile.TemporaryDirectory() as work_dir:
        code = user_media.check_media_code(body.url, work_dir)
    return utils.get_response(200, {"code": code})
