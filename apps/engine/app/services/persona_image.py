"""Persona image URL resolution for the lipsync intro download."""

import ipaddress
import os
import re
from urllib.parse import urlparse

from app.services import longcat, upload_publisher

# House faces from the web persona picker are stored as a path relative to
# the web app (apps/web/public/caracter-samples/file-N.png).
_HOUSE_FACE_PATH = re.compile(r"/caracter-samples/file-\d+\.png")


def is_engine_usable_persona_image_url(value: str) -> bool:
    """True when a stored persona image URL is a shape the engine can fetch.

    Mirrors the web's isEngineUsablePersonaImageUrl
    (apps/web/lib/engine-image-url.ts), which pre-flights the same shapes
    before any token charge: the engine re-checks everything at download
    time, so this exists only so a bad stored URL fails fast instead of
    dying mid-pipeline ("persona image download rejected").

    - a house-face path (/caracter-samples/file-N.png), which
      resolve_persona_image_url turns into an absolute URL;
    - a data:image/ URI with the payload separator the engine splits on;
    - an http(s) URL with a hostname, where a literal IP host must be
      public (hostnames are left to the engine's resolve-and-check).
    Anything else (a relative non-asset path, a non-http scheme, a
    host-less URL) is guaranteed to die at download time.
    """
    candidate = value.strip()
    if not candidate:
        return False
    if candidate.startswith("/"):
        return _HOUSE_FACE_PATH.fullmatch(candidate) is not None
    if candidate.startswith("data:image/"):
        return "," in candidate
    parsed = urlparse(candidate)
    if parsed.scheme.lower() not in ("http", "https"):
        return False
    hostname = parsed.hostname
    if not hostname:
        return False
    try:
        address = ipaddress.ip_address(hostname)
    except ValueError:
        return True
    return address.is_global


def resolve_persona_image_url(image_url: str) -> str:
    """Return an absolute URL for a house-face path; other values unchanged.

    MPT_UPLOAD_API_BASE_URL is the web's public URL (the publish-back
    target), which also serves the house-face PNGs.
    """
    if not _HOUSE_FACE_PATH.fullmatch(image_url):
        return image_url
    base_url = os.getenv(upload_publisher.BASE_URL_ENV)
    if not base_url:
        raise longcat.LongCatError(
            f"{upload_publisher.BASE_URL_ENV} is required to load the house face {image_url}"
        )
    return f"{base_url.rstrip('/')}{image_url}"
