"""POST /api/v1/media/check — mechanical check of one image URL or media id.

The MCP media (action: check) tool's engine side: the web route authenticates the
user, then calls here with the server secret, and this endpoint runs
the SSRF-safe download and the mechanical checks in user_media
(download refusal, real image type, size bounds) and
returns a single code plus the probed dimensions. No judgement, no
relevance score, and the URL is never logged: a URL can carry
credentials in its query string.

With video_aspect given, a photo that cannot fill the frame reports
wrong_aspect instead of ok, so the caller can reject it before any
token is charged. A media id that expired or never existed reports
media_expired: in the images modes the skip fails the task
(images_do_not_cover_audio names the photo); full lip sync only
records the warning.
"""

import tempfile
from typing import Optional

from fastapi import Request
from pydantic import BaseModel, Field, model_validator

from app.controllers import base
from app.controllers.v1.base import new_router
from app.models.exception import HttpException
from app.models.schema import VideoAspect
from app.services import user_media
from app.utils import utils

router = new_router()


class MediaCheckRequest(BaseModel):
    url: Optional[str] = Field(default=None, max_length=2048)
    media_id: Optional[str] = Field(default=None, max_length=64)
    video_aspect: Optional[VideoAspect] = None

    @model_validator(mode="after")
    def _check_exactly_one_source(self) -> "MediaCheckRequest":
        if (self.url is None) == (self.media_id is None):
            raise ValueError("exactly one of url or media_id is required")
        return self


@router.post(
    "/media/check",
    summary="Mechanically check one image URL or media id (MCP media check)",
)
def check_media(request: Request, body: MediaCheckRequest):
    base.get_auth_context(request)
    request_id = base.get_task_id(request)
    if body.url is not None and not body.url.startswith(("http://", "https://")):
        raise HttpException(
            task_id=request_id,
            status_code=400,
            message=f"{request_id}: url must be an http(s) URL",
        )
    with tempfile.TemporaryDirectory() as work_dir:
        result = user_media.check_media_detail(
            url=body.url, media_id=body.media_id, aspect=body.video_aspect, work_dir=work_dir
        )
    return utils.get_response(200, result)
