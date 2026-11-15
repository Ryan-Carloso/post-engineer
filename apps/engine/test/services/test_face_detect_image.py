"""Direct unit tests for image_contains_face (hook-photo face gate).

The hook image — the first photo of the video — must show a detectable
face before any lip-sync spend. The fake cv2 keeps the detection logic
off real photos: the cascade the test controls reports the faces. One
real-cv2 test pins the negative end to end on a repo resource image
(test/resources/1.png has no detectable face).
"""

from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest

from app.services import face_detect

FACE = [(10, 10, 50, 50)]
RESOURCE = Path(__file__).resolve().parent.parent / "resources" / "1.png"


def _png_header_bytes(width: int, height: int) -> bytes:
    """Minimal PNG: signature + IHDR + one compressed zero scanline +
    IEND. Image.open reads the header size without decoding pixels, so
    huge declared dimensions stay cheap (a 109-byte file)."""
    import struct
    import zlib

    def chunk(ctype: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + ctype
            + data
            + struct.pack(">I", zlib.crc32(ctype + data) & 0xFFFFFFFF)
        )

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    idat = zlib.compress(b"\x00" + b"\x00" * (width * 3))
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", idat)
        + chunk(b"IEND", b"")
    )


class FakeCascade:
    """Reports the queued face list per detection call."""

    def __init__(self, faces=None, empty=False, raises=False):
        self._faces = list(faces or [])
        self._empty = empty
        self._raises = raises
        self.calls = 0

    def empty(self):
        return self._empty

    def detectMultiScale(self, gray, **kwargs):
        self.calls += 1
        if self._raises:
            raise RuntimeError("cascade boom")
        return self._faces.pop(0) if self._faces else []


@pytest.fixture
def fake_cv2(monkeypatch):
    """A fake cv2 module whose cascade/imread the test controls."""
    state = SimpleNamespace(
        cascade=FakeCascade(),
        image=np.zeros((240, 320, 3), dtype=np.uint8),
        resize_calls=[],
        imread_calls=[],
    )

    def _resize(frame, size, **kwargs):
        state.resize_calls.append(size)
        return frame

    def _imread(path):
        state.imread_calls.append(path)
        return state.image

    cv2 = SimpleNamespace(
        CascadeClassifier=lambda path: state.cascade,
        imread=_imread,
        data=SimpleNamespace(haarcascades=""),
        INTER_AREA=0,
        COLOR_BGR2GRAY=0,
        resize=_resize,
        cvtColor=lambda frame, code: frame,
    )
    monkeypatch.setattr(face_detect, "_load_cv2", lambda: cv2)
    return state


def test_returns_none_when_opencv_is_missing(monkeypatch):
    monkeypatch.setattr(face_detect, "_load_cv2", lambda: None)
    assert face_detect.image_contains_face("photo.png") is None


def test_returns_none_when_the_cascade_fails_to_load(fake_cv2):
    fake_cv2.cascade = FakeCascade(empty=True)
    assert face_detect.image_contains_face(str(RESOURCE)) is None


def test_returns_false_when_the_file_is_unreadable(fake_cv2):
    # The header probes fine (a real PNG) but cv2 cannot decode the body:
    # unreadable stays False — only an over-cap file skips detection.
    fake_cv2.image = None
    assert face_detect.image_contains_face(str(RESOURCE)) is False


def test_returns_false_when_the_file_does_not_exist(fake_cv2):
    assert face_detect.image_contains_face("no-such-photo.png") is False
    assert fake_cv2.imread_calls == []


def test_returns_none_without_decoding_when_the_image_is_over_the_pixel_cap(
    fake_cv2, tmp_path
):
    # A small compressed file can declare enormous dimensions: the header
    # probe must skip the decode instead of letting cv2.imread allocate
    # gigabytes (OpenCode review on PR #590).
    over_cap = tmp_path / "huge.png"
    over_cap.write_bytes(_png_header_bytes(10_000, 6_000))
    assert face_detect.image_contains_face(str(over_cap)) is None
    assert fake_cv2.imread_calls == []


def test_detects_at_exactly_the_pixel_cap(fake_cv2, tmp_path):
    # The cap is "over", not "at": a 50,000,000-pixel image still runs
    # detection (fake cascade reports no faces here).
    at_cap = tmp_path / "at-cap.png"
    at_cap.write_bytes(_png_header_bytes(10_000, 5_000))
    assert face_detect.image_contains_face(str(at_cap)) is False
    assert fake_cv2.imread_calls == [str(at_cap)]


def test_returns_true_when_a_face_is_detected(fake_cv2):
    fake_cv2.cascade = FakeCascade(faces=[FACE])
    assert face_detect.image_contains_face(str(RESOURCE)) is True
    assert fake_cv2.cascade.calls == 1


def test_returns_false_when_no_face_is_detected(fake_cv2):
    assert face_detect.image_contains_face(str(RESOURCE)) is False
    assert fake_cv2.cascade.calls == 1


def test_downscales_wide_images_before_detection(fake_cv2):
    fake_cv2.image = np.zeros((480, 640, 3), dtype=np.uint8)
    fake_cv2.cascade = FakeCascade(faces=[FACE])
    assert face_detect.image_contains_face(str(RESOURCE)) is True
    assert fake_cv2.resize_calls == [(360, 270)]


def test_does_not_resize_a_360_wide_image(fake_cv2):
    fake_cv2.image = np.zeros((240, 360, 3), dtype=np.uint8)
    fake_cv2.cascade = FakeCascade(faces=[FACE])
    assert face_detect.image_contains_face(str(RESOURCE)) is True
    assert fake_cv2.resize_calls == []


def test_returns_none_when_detection_raises(fake_cv2):
    # A raise is a detector failure, not "no face": the caller must not
    # block on it (OpenCode review on PR #590).
    fake_cv2.cascade = FakeCascade(raises=True)
    assert face_detect.image_contains_face(str(RESOURCE)) is None


def test_real_cv2_reports_no_face_in_a_faceless_resource_image():
    # No mock: the real cascade on a real repo image. test/resources/1.png
    # has no detectable face (verified against the Haar cascade).
    assert face_detect.image_contains_face(str(RESOURCE)) is False
