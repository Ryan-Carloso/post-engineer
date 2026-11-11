"""Direct unit tests for video_contains_face (stock B-roll filter).

The image face check was deleted; this is the only function left in
face_detect.py, so without these tests the mutmut shard for the file
finds no covering test case and fails. The fake cv2 keeps the tests
off real video files: detection is driven by the frames the fake
capture returns and the faces the fake cascade reports.
"""

from types import SimpleNamespace

import numpy as np
import pytest

from app.services import face_detect

FACE = [(10, 10, 50, 50)]


class FakeCascade:
    """Reports the next queued face list per sampled frame."""

    def __init__(self, faces=None, empty=False):
        self._faces = list(faces or [])
        self._empty = empty
        self.calls = 0

    def empty(self):
        return self._empty

    def detectMultiScale(self, gray, **kwargs):
        self.calls += 1
        return self._faces.pop(0) if self._faces else []


class FakeCapture:
    def __init__(self, frames, opened=True, total=None):
        self._frames = list(frames)
        self._opened = opened
        self._total = len(frames) if total is None else total
        self.read_calls = 0
        self.released = False

    def isOpened(self):
        return self._opened

    def get(self, prop):
        return self._total

    def read(self):
        self.read_calls += 1
        if not self._frames:
            return False, None
        return True, self._frames.pop(0)

    def release(self):
        self.released = True


def _frame(width=320, height=240):
    return np.zeros((height, width, 3), dtype=np.uint8)


@pytest.fixture
def fake_cv2(monkeypatch):
    """A fake cv2 module whose cascade/capture the test controls."""
    state = SimpleNamespace(cascade=FakeCascade(), capture=None, resize_calls=[])

    def _resize(frame, size, **kwargs):
        state.resize_calls.append(size)
        return frame

    cv2 = SimpleNamespace(
        CascadeClassifier=lambda path: state.cascade,
        VideoCapture=lambda path: state.capture,
        data=SimpleNamespace(haarcascades=""),
        CAP_PROP_FRAME_COUNT=1,
        INTER_AREA=0,
        COLOR_BGR2GRAY=0,
        resize=_resize,
        cvtColor=lambda frame, code: frame,
    )
    monkeypatch.setattr(face_detect, "_load_cv2", lambda: cv2)
    return state


def _run(state, frames, **kwargs):
    state.capture = FakeCapture(frames)
    return face_detect.video_contains_face("video.mp4", force_exclude=True, **kwargs)


def test_returns_false_when_opencv_is_missing(monkeypatch):
    monkeypatch.setattr(face_detect, "_load_cv2", lambda: None)
    assert face_detect.video_contains_face("video.mp4", force_exclude=True) is False


def test_returns_false_when_the_filter_is_disabled(fake_cv2):
    fake_cv2.capture = FakeCapture([_frame()])
    assert (
        face_detect.video_contains_face("video.mp4", force_exclude=False) is False
    )
    assert fake_cv2.capture.read_calls == 0


def test_reads_the_config_flag_when_force_exclude_is_not_given(fake_cv2, monkeypatch):
    monkeypatch.setitem(face_detect.config.app, "material_exclude_people", True)
    fake_cv2.cascade = FakeCascade(faces=[FACE])
    fake_cv2.capture = FakeCapture([_frame()])
    # No force_exclude: the config flag enables the filter.
    assert face_detect.video_contains_face("video.mp4") is True


def test_returns_false_when_the_cascade_fails_to_load(fake_cv2):
    fake_cv2.cascade = FakeCascade(empty=True)
    assert _run(fake_cv2, [_frame()]) is False


def test_returns_false_when_the_video_cannot_be_opened(fake_cv2):
    fake_cv2.capture = FakeCapture([_frame()], opened=False)
    assert face_detect.video_contains_face("video.mp4", force_exclude=True) is False


def test_returns_false_when_the_video_has_no_frames(fake_cv2):
    fake_cv2.capture = FakeCapture([], total=0)
    assert face_detect.video_contains_face("video.mp4", force_exclude=True) is False


def test_returns_true_when_a_sampled_frame_has_a_face(fake_cv2):
    fake_cv2.cascade = FakeCascade(faces=[FACE])
    assert _run(fake_cv2, [_frame(), _frame()]) is True
    assert fake_cv2.capture.released is True


def test_returns_false_when_no_sampled_frame_has_a_face(fake_cv2):
    assert _run(fake_cv2, [_frame(), _frame(), _frame()]) is False
    assert fake_cv2.cascade.calls == 3


def test_ignores_faces_on_unsampled_frames(fake_cv2):
    # 16 frames, 8 samples: step 2, so only even frames are checked.
    # Mark odd frames as "face" frames via their pixel value; the cascade
    # reports a face exactly on those. A face on an unsampled frame must
    # not count — if the step were 1, this test would fail.
    frames = [np.full((240, 320, 3), i % 2, dtype=np.uint8) for i in range(16)]

    class MarkingCascade(FakeCascade):
        def detectMultiScale(self, gray, **kwargs):
            self.calls += 1
            return FACE if gray[0, 0, 0] == 1 else []

    fake_cv2.cascade = MarkingCascade()
    assert _run(fake_cv2, frames, frames_to_sample=8) is False
    assert fake_cv2.cascade.calls == 8


def test_downscales_wide_frames_before_detection(fake_cv2):
    fake_cv2.cascade = FakeCascade(faces=[FACE])
    assert _run(fake_cv2, [_frame(width=640, height=480)]) is True
    assert fake_cv2.resize_calls == [(360, 270)]


def test_returns_false_and_releases_when_decoding_raises(fake_cv2):
    class RaisingCapture(FakeCapture):
        def read(self):
            raise RuntimeError("decode boom")

    fake_cv2.capture = RaisingCapture([_frame()])
    assert face_detect.video_contains_face("video.mp4", force_exclude=True) is False
    assert fake_cv2.capture.released is True
