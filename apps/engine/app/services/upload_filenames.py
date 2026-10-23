"""Upload filename sanitizing for the media upload endpoints."""

from app.models.exception import HttpException


def sanitize_upload_filename(filename: str | None, request_id: str) -> str:
    # Browsers/clients sometimes include directory info, or even smuggle ../
    # traversal segments. Keep only the bare filename so the upload endpoint
    # never writes outside the target directory.
    normalized_name = (filename or "").replace("\\", "/").split("/")[-1].strip()
    if not normalized_name or normalized_name in {".", ".."}:
        raise HttpException(
            task_id=request_id,
            status_code=400,
            message=f"{request_id}: invalid filename",
        )
    return normalized_name
