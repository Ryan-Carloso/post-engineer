"""POST /api/v1/media/image-short: an image in, an MP4 Short out."""

import io

import pytest
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient

from app.controllers.v1 import image_short as controller
from app.models.exception import HttpException
from app.services import image_short


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setenv("MONEYPRINT_API_SECRET", "test-secret")
    app = FastAPI()

    async def http_exception_handler(request: Request, exc: HttpException):
        return JSONResponse(status_code=exc.status_code, content={"message": exc.message})

    app.add_exception_handler(HttpException, http_exception_handler)
    app.include_router(controller.router)
    return TestClient(app, raise_server_exceptions=False)


def _post(client, body: bytes, headers: dict[str, str] | None = None):
    return client.post(
        "/api/v1/media/image-short",
        files={"file": ("image.jpg", io.BytesIO(body), "image/jpeg")},
        headers=headers if headers is not None else {"Authorization": "Bearer test-secret", "x-user-id": "user-1"},
    )


def test_returns_the_rendered_mp4(client, monkeypatch):
    received: list[bytes] = []

    def fake_render(image_bytes, work_dir):
        received.append(image_bytes)
        return b"mp4-bytes"

    monkeypatch.setattr(image_short, "render_image_short", fake_render)
    response = _post(client, b"jpeg-bytes")
    assert response.status_code == 200
    assert response.headers["content-type"] == "video/mp4"
    assert response.content == b"mp4-bytes"
    assert received == [b"jpeg-bytes"]


def test_rejects_a_caller_without_the_server_secret(client, monkeypatch):
    monkeypatch.setattr(image_short, "render_image_short", lambda image_bytes, work_dir: b"mp4")
    response = _post(client, b"jpeg-bytes", headers={"Authorization": "Bearer wrong", "x-user-id": "user-1"})
    assert response.status_code == 401


def test_an_invalid_image_is_a_400_with_its_code(client, monkeypatch):
    def invalid(image_bytes, work_dir):
        raise image_short.ImageShortError("invalid_image", "image could not be decoded")

    monkeypatch.setattr(image_short, "render_image_short", invalid)
    response = _post(client, b"nope")
    assert response.status_code == 400
    assert response.json() == {"status": 400, "body": {"code": "invalid_image"}, "message": "image could not be decoded"}


def test_an_oversized_upload_is_a_413_before_rendering(client, monkeypatch):
    rendered: list[bytes] = []
    monkeypatch.setattr(image_short, "render_image_short", lambda image_bytes, work_dir: rendered.append(image_bytes) or b"")
    response = _post(client, b"\xff" * (image_short.MAX_IMAGE_SHORT_BYTES + 1))
    assert response.status_code == 413
    assert response.json()["body"] == {"code": "image_too_large"}
    assert rendered == []


def test_a_render_failure_is_a_500_without_the_ffmpeg_detail(client, monkeypatch):
    def failed(image_bytes, work_dir):
        raise image_short.ImageShortError("render_failed", "image Short render failed (exit 1): /srv/tmp/x.png boom")

    monkeypatch.setattr(image_short, "render_image_short", failed)
    response = _post(client, b"jpeg-bytes")
    assert response.status_code == 500
    assert response.json() == {"status": 500, "body": {"code": "render_failed"}, "message": "image Short render failed"}
