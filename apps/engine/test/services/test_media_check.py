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
    detail = {"code": "too_small", "width": 100, "height": 100}
    with patch(
        "app.controllers.v1.media_check.user_media.check_media_detail", return_value=detail
    ) as check:
        response = client.post(
            "/api/v1/media/check", json={"url": "https://e.com/porto.jpg"}, headers=_auth_headers()
        )
    assert response.status_code == 200
    assert response.json()["body"] == detail
    check.assert_called_once()
    assert check.call_args.kwargs["url"] == "https://e.com/porto.jpg"
    assert check.call_args.kwargs["media_id"] is None
    assert check.call_args.kwargs["aspect"] is None


def test_check_forwards_a_media_id_and_an_aspect(client):
    detail = {"code": "wrong_aspect", "width": 1920, "height": 1080}
    with patch(
        "app.controllers.v1.media_check.user_media.check_media_detail", return_value=detail
    ) as check:
        response = client.post(
            "/api/v1/media/check",
            json={"media_id": "aabbccddeeff00112233445566778899.jpg", "video_aspect": "9:16"},
            headers=_auth_headers(),
        )
    assert response.status_code == 200
    assert response.json()["body"] == detail
    check.assert_called_once()
    assert check.call_args.kwargs["media_id"] == "aabbccddeeff00112233445566778899.jpg"
    assert check.call_args.kwargs["aspect"] == "9:16"
    assert check.call_args.kwargs["url"] is None


def test_check_rejects_both_a_url_and_a_media_id(client):
    response = client.post(
        "/api/v1/media/check",
        json={"url": "https://e.com/porto.jpg", "media_id": "aabbccddeeff00112233445566778899.jpg"},
        headers=_auth_headers(),
    )
    assert response.status_code == 422


def test_check_rejects_neither_a_url_nor_a_media_id(client):
    response = client.post("/api/v1/media/check", json={}, headers=_auth_headers())
    assert response.status_code == 422


def test_check_rejects_missing_engine_secret(client):
    response = client.post("/api/v1/media/check", json={"url": "https://e.com/porto.jpg"})
    assert response.status_code == 401


def test_check_rejects_a_non_http_url(client):
    response = client.post(
        "/api/v1/media/check", json={"url": "ftp://e.com/porto.jpg"}, headers=_auth_headers()
    )
    assert response.status_code == 400
