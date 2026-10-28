"""POST /api/v1/media/check: auth, URL shape, and the code passthrough."""

import sys
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.controllers.v1 import media_check
from app.models.exception import HttpException


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setenv("MONEYPRINT_API_SECRET", "test-secret")
    app = FastAPI()

    async def http_exception_handler(request: Request, exc: HttpException):
        return JSONResponse(status_code=exc.status_code, content={"message": exc.message})

    app.add_exception_handler(HttpException, http_exception_handler)
    app.include_router(media_check.router)
    return TestClient(app, raise_server_exceptions=False)


def _auth_headers():
    return {"Authorization": "Bearer test-secret", "x-user-id": "user-1"}


def test_check_returns_the_engine_code(client):
    with patch("app.controllers.v1.media_check.user_media.check_media_code", return_value="face_detected") as check:
        response = client.post(
            "/api/v1/media/check", json={"url": "https://e.com/porto.jpg"}, headers=_auth_headers()
        )
    assert response.status_code == 200
    assert response.json()["body"]["code"] == "face_detected"
    check.assert_called_once()
    assert check.call_args[0][0] == "https://e.com/porto.jpg"


def test_check_rejects_missing_engine_secret(client):
    response = client.post("/api/v1/media/check", json={"url": "https://e.com/porto.jpg"})
    assert response.status_code == 401


def test_check_rejects_a_non_http_url(client):
    response = client.post(
        "/api/v1/media/check", json={"url": "ftp://e.com/porto.jpg"}, headers=_auth_headers()
    )
    assert response.status_code == 400
