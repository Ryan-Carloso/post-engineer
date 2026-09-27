from pathlib import Path

import pytest

from app.services import replicate_lipsync


def test_missing_replicate_token_fails_explicitly(monkeypatch):
    monkeypatch.delenv("REPLICATE_API_TOKEN", raising=False)

    with pytest.raises(replicate_lipsync.LipSyncError, match="REPLICATE_API_TOKEN"):
        replicate_lipsync.replicate_token()


def test_missing_replicate_model_fails_explicitly(monkeypatch):
    monkeypatch.delenv("REPLICATE_LIPSYNC_MODEL", raising=False)

    with pytest.raises(replicate_lipsync.LipSyncError, match="REPLICATE_LIPSYNC_MODEL"):
        replicate_lipsync.replicate_model()


def test_prediction_uses_image_and_audio_and_returns_video(tmp_path, monkeypatch):
    monkeypatch.setenv("REPLICATE_API_TOKEN", "test-token")
    monkeypatch.setenv("REPLICATE_LIPSYNC_MODEL", "cjwbw/sadtalker")
    image = tmp_path / "persona.png"
    audio = tmp_path / "audio.mp3"
    image.write_bytes(b"png")
    audio.write_bytes(b"mp3")
    calls = []

    class FakeResponse:
        def __init__(self, status_code, body, content=b""):
            self.status_code = status_code
            self._body = body
            self.content = content

        def json(self):
            return self._body

    def fake_request(method, url, **kwargs):
        calls.append((method, url, kwargs))
        if method == "GET" and url.endswith("/models/cjwbw/sadtalker"):
            return FakeResponse(
                200, {"latest_version": {"id": "mocked-version-id"}}
            )
        if method == "POST":
            return FakeResponse(201, {"urls": {"get": "https://replicate.test/prediction"}})
        if url.endswith("prediction"):
            return FakeResponse(200, {"status": "succeeded", "output": "https://replicate.test/output.mp4"})
        return FakeResponse(200, {}, b"video")

    output = replicate_lipsync.run_prediction(str(image), str(audio), request=fake_request, poll_seconds=0)

    assert output == b"video"
    post = next(call for call in calls if call[0] == "POST")
    assert post[2]["json"]["version"] == "mocked-version-id"
    assert post[2]["json"]["input"]["source_image"].startswith("data:image/")
    assert post[2]["json"]["input"]["driven_audio"].startswith("data:audio/")


def test_create_lipsync_video_writes_replicate_output(tmp_path, monkeypatch):
    audio = tmp_path / "audio.mp3"
    image = tmp_path / "persona.png"
    output = tmp_path / "avatar.mp4"
    audio.write_bytes(b"audio")
    image.write_bytes(b"image")
    monkeypatch.setattr(replicate_lipsync, "trim_audio", lambda source, target: Path(target).write_bytes(b"short"))

    created = replicate_lipsync.create_lipsync_video(
        str(image), str(audio), str(output), run=lambda image_path, audio_path: b"generated-video"
    )

    assert created == str(output)
    assert output.read_bytes() == b"generated-video"
