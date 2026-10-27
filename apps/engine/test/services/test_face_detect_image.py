"""face_detect.image_contains_face: the still-image twin of the video check."""

from unittest.mock import MagicMock, patch

import numpy as np

from app.services import face_detect


def _fake_cv2(faces, cascade_empty=False, image=None):
    cv2 = MagicMock()
    cv2.data.haarcascades = "/cascades/"
    cv2.imread.return_value = np.zeros((100, 100, 3), dtype=np.uint8) if image is None else image
    cascade = MagicMock()
    cascade.empty.return_value = cascade_empty
    cascade.detectMultiScale.return_value = faces
    cv2.CascadeClassifier.return_value = cascade
    return cv2


def test_a_detected_face_is_reported():
    with patch.object(face_detect, "_load_cv2", return_value=_fake_cv2([[1, 1, 30, 30]])):
        assert face_detect.image_contains_face("photo.jpg") is True


def test_no_face_is_reported_as_false():
    with patch.object(face_detect, "_load_cv2", return_value=_fake_cv2([])):
        assert face_detect.image_contains_face("photo.jpg") is False


def test_missing_opencv_never_blocks_the_photo():
    with patch.object(face_detect, "_load_cv2", return_value=None):
        assert face_detect.image_contains_face("photo.jpg") is False


def test_an_unloadable_cascade_never_blocks_the_photo():
    with patch.object(face_detect, "_load_cv2", return_value=_fake_cv2([[1, 1, 30, 30]], cascade_empty=True)):
        assert face_detect.image_contains_face("photo.jpg") is False


def test_an_unreadable_image_never_blocks_the_photo():
    cv2 = _fake_cv2([[1, 1, 30, 30]])
    cv2.imread.return_value = None
    with patch.object(face_detect, "_load_cv2", return_value=cv2):
        assert face_detect.image_contains_face("photo.jpg") is False


def test_a_plain_image_has_no_face_with_the_real_detector(tmp_path):
    import cv2

    path = tmp_path / "blue.jpg"
    cv2.imwrite(str(path), np.full((400, 300, 3), (200, 80, 40), dtype=np.uint8))
    assert face_detect.image_contains_face(str(path)) is False
