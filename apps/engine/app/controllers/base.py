import hmac
import os
from dataclasses import dataclass
from uuid import uuid4

from fastapi import Request

from app.models.exception import HttpException


def get_task_id(request: Request):
    task_id = request.headers.get("x-task-id")
    if not task_id:
        task_id = uuid4()
    return str(task_id)


@dataclass(frozen=True)
class AuthContext:
    user_id: str
    auth_type: str = "shared-secret"


def _unauthorized(request: Request) -> HttpException:
    return HttpException(task_id=get_task_id(request), status_code=401, message="unauthorized")


def _required_secret() -> str:
    value = os.getenv("MONEYPRINT_API_SECRET")
    if not value:
        raise RuntimeError("MONEYPRINT_API_SECRET is required for API authentication")
    return value


def _bearer_token(request: Request) -> str | None:
    authorization = request.headers.get("authorization", "")
    if authorization.lower().startswith("bearer "):
        return authorization[7:].strip()
    return None


def verify_token(request: Request) -> AuthContext:
    """Authenticate the request via the shared API secret.

    The web app owns Supabase auth: it validates the user session and calls
    the engine with ``Authorization: Bearer $MONEYPRINT_API_SECRET`` plus the
    ``x-user-id`` header. The user id is trusted only because the secret
    matched (constant-time compare).
    """
    token = _bearer_token(request)
    if not token or not hmac.compare_digest(token, _required_secret()):
        raise _unauthorized(request)
    user_id = request.headers.get("x-user-id")
    if not user_id:
        raise _unauthorized(request)
    context = AuthContext(user_id=user_id)
    request.state.auth = context
    return context


def get_auth_context(request: Request) -> AuthContext:
    context = getattr(request.state, "auth", None)
    if not isinstance(context, AuthContext):
        raise _unauthorized(request)
    return context
