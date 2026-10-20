"""Bearer auth helpers for the Modal Chatterbox FastAPI app."""

from __future__ import annotations

import hmac
import os

from fastapi.responses import JSONResponse

HTTP_SECRET = os.environ.get("CHATTERBOX_HTTP_SECRET")


def auth_error() -> object | None:
    """503 when the server itself has no secret configured."""
    if not HTTP_SECRET:
        return {"status_code": 503, "content": {"error": "server not configured"}}
    return None


def check_bearer(request) -> object | None:
    """401 unless the Authorization header matches the secret (constant-time)."""
    header = request.headers.get("authorization", "")
    expected = f"Bearer {HTTP_SECRET}"
    if not hmac.compare_digest(header.encode(), expected.encode()):
        return {"status_code": 401, "content": {"error": "unauthorized"}}
    return None


def auth_response(potential) -> JSONResponse | None:
    """Turn an auth-check result into a JSONResponse, or return None."""
    if potential is None:
        return None
    return JSONResponse(status_code=potential["status_code"], content=potential["content"])


def authorize_request(request) -> JSONResponse | None:
    return auth_response(auth_error()) or auth_response(check_bearer(request))
