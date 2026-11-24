"""Persona image URL resolution for the lipsync intro download."""

import ipaddress
import re
from urllib.parse import urlparse

_HOUSE_FACE_PATH = re.compile(r"/caracter-samples/file-\d+\.png")


def is_engine_usable_persona_image_url(value: str) -> bool:
    """True when a stored persona image URL is a shape the engine can fetch.

    Mirrors the web's isEngineUsablePersonaImageUrl
    (apps/web/lib/engine-image-url.ts), which pre-flights the same shapes
    before any token charge: the engine re-checks everything at download
    time, so this exists only so a bad stored URL fails fast instead of
    dying mid-pipeline ("persona image download rejected").

    - a house-face path (/caracter-samples/file-N.png);
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
