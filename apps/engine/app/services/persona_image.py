"""Persona image URL resolution for the lipsync intro download."""

import os
import re

from app.services import infinitetalk, task_publish

# House faces from the web persona picker are stored as a path relative to
# the web app (apps/web/public/caracter-samples/file-N.png).
_HOUSE_FACE_PATH = re.compile(r"/caracter-samples/file-\d+\.png")


def resolve_persona_image_url(image_url: str) -> str:
    """Return an absolute URL for a house-face path; other values unchanged.

    MPT_UPLOAD_API_BASE_URL is the web's public URL (the publish-back
    target), which also serves the house-face PNGs.
    """
    if not _HOUSE_FACE_PATH.fullmatch(image_url):
        return image_url
    base_url = os.getenv(task_publish.BASE_URL_ENV)
    if not base_url:
        raise infinitetalk.InfiniteTalkError(
            f"{task_publish.BASE_URL_ENV} is required to load the house face {image_url}"
        )
    return f"{base_url.rstrip('/')}{image_url}"
