"""POST /api/v1/media/image-short — render one JPEG/PNG into a vertical YouTube Short.

The web YouTube publish handler calls this with the server secret when the
media it must publish is an image: YouTube has no public image-post API yet
(see app.services.image_short). The response body is the MP4 itself.
"""

import tempfile

from fastapi import File, Request, UploadFile
from fastapi.responses import JSONResponse, Response

from app.controllers import base
from app.controllers.v1.base import new_router
from app.services import image_short
from app.utils import utils

router = new_router()

_STATUS_BY_CODE: dict[str, int] = {
    image_short.ERROR_INVALID_IMAGE: 400,
    image_short.ERROR_IMAGE_TOO_LARGE: 413,
    image_short.ERROR_RENDER_FAILED: 500,
}


def _error_response(code: str, message: str) -> JSONResponse:
    status = _STATUS_BY_CODE.get(code, 500)
    return JSONResponse(
        status_code=status,
        content=utils.get_response(status=status, body={"code": code}, message=message),
    )


@router.post(
    "/media/image-short",
    summary="Render one JPEG/PNG into an 8-second 9:16 MP4 Short (video/mp4)",
)
def render_image_short(request: Request, file: UploadFile = File(...)):
    base.get_auth_context(request)
    if file.size is not None and file.size > image_short.MAX_IMAGE_SHORT_BYTES:
        return _error_response(image_short.ERROR_IMAGE_TOO_LARGE, "image exceeds 8 MB")
    image_bytes = file.file.read(image_short.MAX_IMAGE_SHORT_BYTES + 1)
    try:
        with tempfile.TemporaryDirectory() as work_dir:
            video = image_short.render_image_short(image_bytes, work_dir)
    except image_short.ImageShortError as exc:
        public = "image Short render failed" if exc.code == image_short.ERROR_RENDER_FAILED else str(exc)
        return _error_response(exc.code, public)
    return Response(content=video, media_type="video/mp4")
