"""image_fetch: SSRF-guarded photo download and portrait-still composing.

The download and still-composing halves are load-bearing for the
agent-images modes (issue #542).
"""

import io
import ipaddress
import os
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from PIL import Image

from app.models.schema import VideoAspect
from app.services import image_fetch
from app.utils import ssrf

PUBLIC_IP = [ipaddress.ip_address("93.184.216.34")]


def _jpeg(width=1200, height=800):
    buffer = io.BytesIO()
    Image.new("RGB", (width, height), (200, 80, 40)).save(buffer, "JPEG")
    return buffer.getvalue()


class _Session:
    """requests-like session that replays one canned response."""

    def __init__(self, body, content_type="image/jpeg", status=200):
        self.body, self.content_type, self.status, self.urls = body, content_type, status, []

    def get(self, url, **kwargs):
        self.urls.append(url)
        return SimpleNamespace(
            status_code=self.status,
            headers={"Content-Type": self.content_type, "Content-Length": str(len(self.body))},
            iter_content=lambda chunk_size: iter([self.body]),
            close=lambda: None,
        )


# ---- download


def test_download_writes_an_image_after_the_ssrf_checks(tmp_path):
    session = _Session(_jpeg())
    with patch.object(ssrf, "_resolve_global_ips", return_value=PUBLIC_IP):
        path = image_fetch.download_image("https://example.com/a.jpg", str(tmp_path / "a.raw"), session=session)
    assert os.path.getsize(path) > 0


def test_download_rejects_a_private_address_without_fetching(tmp_path):
    session = _Session(b"x")
    with patch.object(ssrf, "_resolve_global_ips", return_value=[ipaddress.ip_address("10.0.0.5")]):
        with pytest.raises(ssrf.UnsafeUrlError):
            image_fetch.download_image("https://internal.example/a.jpg", str(tmp_path / "a.raw"), session=session)
    assert session.urls == []


def test_download_rejects_non_images(tmp_path):
    session = _Session(b"<html>", content_type="text/html")
    with patch.object(ssrf, "_resolve_global_ips", return_value=PUBLIC_IP):
        with pytest.raises(ssrf.UnsafeUrlError):
            image_fetch.download_image("https://example.com/a", str(tmp_path / "a.raw"), session=session)


def test_download_rejects_oversized_photos(tmp_path):
    session = _Session(_jpeg())
    with patch.object(ssrf, "_resolve_global_ips", return_value=PUBLIC_IP), patch.object(
        image_fetch, "MAX_PHOTO_BYTES", 100
    ):
        with pytest.raises(ssrf.UnsafeUrlError):
            image_fetch.download_image("https://example.com/a.jpg", str(tmp_path / "a.raw"), session=session)


# ---- portrait still


def test_a_landscape_photo_becomes_a_full_portrait_still(tmp_path):
    source = tmp_path / "p.jpg"
    Image.new("RGB", (1200, 800), (10, 120, 200)).save(source)
    out = image_fetch.compose_portrait_still(str(source), str(tmp_path / "still.jpg"), VideoAspect.portrait)
    assert out == str(tmp_path / "still.jpg")
    assert Image.open(out).size == (1080, 1920)


@pytest.mark.parametrize(
    "size",
    [(300, 200), (500, 500), (1200, 200)],
    ids=["thumbnail", "long edge too short", "short edge too short"],
)
def test_small_or_sliver_photos_are_rejected(tmp_path, size):
    source = tmp_path / "p.jpg"
    Image.new("RGB", size).save(source)
    assert image_fetch.compose_portrait_still(str(source), str(tmp_path / "s.jpg"), VideoAspect.portrait) == ""


def test_decompression_bombs_are_rejected(tmp_path):
    source = tmp_path / "p.jpg"
    Image.new("RGB", (1200, 800)).save(source)
    with patch.object(image_fetch, "MAX_PHOTO_PIXELS", 1000):
        assert image_fetch.compose_portrait_still(str(source), str(tmp_path / "s.jpg"), VideoAspect.portrait) == ""


def test_an_unreadable_file_is_rejected(tmp_path):
    source = tmp_path / "p.jpg"
    source.write_bytes(b"not an image")
    assert image_fetch.compose_portrait_still(str(source), str(tmp_path / "s.jpg"), VideoAspect.portrait) == ""
