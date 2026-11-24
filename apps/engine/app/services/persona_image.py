"""Stored persona image URL shape check for the batch fill gate."""

import ipaddress
import re
from urllib.parse import urlparse

_HOUSE_FACE_PATH = re.compile(r"/caracter-samples/file-\d+\.png")


def is_engine_usable_persona_image_url(value: str) -> bool:
    """True when a stored persona image URL is a shape the engine can fetch.

    Mirrors the web's isEngineUsablePersonaImageUrl
    (apps/web/lib/engine-image-url.ts), which pre-flights the same shapes
    before any token charge: this exists only so a bad stored avatar_url
    fails the batch fill gate at accept time instead of failing the video
    after the job starts ("{video_type} requires a usable persona photo").

    The photo itself is never downloaded as a video frame: the hook image
    is the first photo of the video (issue #766).

    - a house-face path (/caracter-samples/file-N.png);
    - a data:image/ URI with the payload separator the engine splits on;
    - an http(s) URL with a hostname, where a literal IP host must be
      public (hostnames are accepted by shape only; the engine does not
      fetch the avatar).
    Anything else (a relative non-asset path, a non-http scheme, a
    host-less URL) is guaranteed to fail the gate.
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
