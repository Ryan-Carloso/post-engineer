"""POST /api/v1/temp_assets: mp4 clips join the photos (PR-B).

The upload gate is the suffix allowlist: mp4 is admitted, other video
containers are refused with 400 before any bytes are stored. Photos keep
working exactly as before.
"""

import io
import sys
from pathlib import Path

import pytest
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from app.controllers.v1 import temp_assets
from app.models.exception import HttpException


@pytest.fixture()
def client(monkeypatch, tmp_path):
    monkeypatch.setenv("MONEYPRINT_API_SECRET", "test-secret")
    monkeypatch.setattr(
        temp_assets.utils, "storage_dir", lambda *args, **kwargs: str(tmp_path)
    )
    app = FastAPI()

    async def http_exception_handler(request: Request, exc: HttpException):
        return JSONResponse(status_code=exc.status_code, content={"message": exc.message})

    app.add_exception_handler(HttpException, http_exception_handler)
    app.include_router(temp_assets.upload_router)
    return TestClient(app, raise_server_exceptions=False)


def _auth_headers():
    return {"Authorization": "Bearer test-secret", "x-user-id": "user-1"}


def _upload(client, filename, body=b"\x00\x00\x00\x18ftypisom"):
    return client.post(
        "/api/v1/temp_assets",
        files={"file": (filename, io.BytesIO(body), "application/octet-stream")},
        headers=_auth_headers(),
    )


def test_mp4_upload_is_accepted_and_stored_under_a_uuid_name(client, tmp_path):
    response = _upload(client, "broll.mp4")
    assert response.status_code == 200
    url = response.json()["body"]["url"]
    assert url.endswith(".mp4")
    name = url.rsplit("/", 1)[-1]
    assert len(name) == 32 + len(".mp4")
    assert (tmp_path / name).exists()


def test_photo_uploads_still_work(client, tmp_path):
    response = _upload(client, "photo.jpg")
    assert response.status_code == 200
    assert response.json()["body"]["url"].endswith(".jpg")


def test_mov_upload_is_refused_before_storing(client, tmp_path):
    response = _upload(client, "broll.mov")
    assert response.status_code == 400
    assert list(tmp_path.iterdir()) == []


def test_avi_upload_is_refused_before_storing(client, tmp_path):
    response = _upload(client, "broll.avi")
    assert response.status_code == 400
    assert list(tmp_path.iterdir()) == []
