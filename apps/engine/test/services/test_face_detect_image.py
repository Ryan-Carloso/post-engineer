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
        cascade=FakeCascade(), image=np.zeros((240, 320, 3), dtype=np.uint8), resize_calls=[]
    )

    def _resize(frame, size, **kwargs):
        state.resize_calls.append(size)
        return frame

    cv2 = SimpleNamespace(
        CascadeClassifier=lambda path: state.cascade,
        imread=lambda path: state.image,
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
    assert face_detect.image_contains_face("photo.png") is None


def test_returns_false_when_the_file_is_unreadable(fake_cv2):
    fake_cv2.image = None
    assert face_detect.image_contains_face("photo.png") is False


def test_returns_true_when_a_face_is_detected(fake_cv2):
    fake_cv2.cascade = FakeCascade(faces=[FACE])
    assert face_detect.image_contains_face("photo.png") is True
    assert fake_cv2.cascade.calls == 1


def test_returns_false_when_no_face_is_detected(fake_cv2):
    assert face_detect.image_contains_face("photo.png") is False
    assert fake_cv2.cascade.calls == 1


def test_downscales_wide_images_before_detection(fake_cv2):
    fake_cv2.image = np.zeros((480, 640, 3), dtype=np.uint8)
    fake_cv2.cascade = FakeCascade(faces=[FACE])
    assert face_detect.image_contains_face("photo.png") is True
    assert fake_cv2.resize_calls == [(360, 270)]


def test_does_not_resize_a_360_wide_image(fake_cv2):
    fake_cv2.image = np.zeros((240, 360, 3), dtype=np.uint8)
    fake_cv2.cascade = FakeCascade(faces=[FACE])
    assert face_detect.image_contains_face("photo.png") is True
    assert fake_cv2.resize_calls == []


def test_returns_false_when_detection_raises(fake_cv2):
    fake_cv2.cascade = FakeCascade(raises=True)
    assert face_detect.image_contains_face("photo.png") is False


def test_real_cv2_reports_no_face_in_a_faceless_resource_image():
    # No mock: the real cascade on a real repo image. test/resources/1.png
    # has no detectable face (verified against the Haar cascade).
    resource = Path(__file__).resolve().parent.parent / "resources" / "1.png"
    assert face_detect.image_contains_face(str(resource)) is False
