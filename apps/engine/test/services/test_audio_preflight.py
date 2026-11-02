"""POST /api/v1/audio/preflight-duration + the narration measurement.

The preflight is the pre-charge gate for full lip-sync: the web route
must learn the real narration duration before spend_tokens, from the
same synthesis the video task will run. Tests pin: TTS duration uses
the video task's computation (ceil of the subtitle-maker duration after
the trailing-silence trim, voice_rate 1.0), voice_audio_url wins over
voice_name and its 60s download limit surfaces as a 400 (not a 502),
and any synthesis failure fails closed as a 502 (never a duration).
"""

import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).parent.parent))

from app.controllers.v1 import audio_preflight as controller
from app.models.exception import HttpException
from app.services import audio_preflight as service


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setenv("MONEYPRINT_API_SECRET", "test-secret")
    app = FastAPI()

    async def http_exception_handler(request: Request, exc: HttpException):
        return JSONResponse(status_code=exc.status_code, content={"message": exc.message})

    app.add_exception_handler(HttpException, http_exception_handler)
    app.include_router(controller.router)
    return TestClient(app, raise_server_exceptions=False)


def _auth_headers():
    return {"Authorization": "Bearer test-secret", "x-user-id": "user-1"}


def _body(**overrides):
    body = {
        "video_script": "Hello Lisbon, this is a test narration.",
        "video_language": "en-US",
        "voice_name": "chatterbox:kokoro_af_heart",
    }
    body.update(overrides)
    return body


def test_preflight_returns_measured_duration(client):
    with patch(
        "app.controllers.v1.audio_preflight.audio_preflight.measure_narration_duration",
        return_value=51.36,
    ) as measure:
        response = client.post(
            "/api/v1/audio/preflight-duration", json=_body(), headers=_auth_headers()
        )
    assert response.status_code == 200
    assert response.json()["body"]["audio_duration_seconds"] == 51.36
    measure.assert_called_once()
    assert measure.call_args.kwargs["script"] == _body()["video_script"]
    assert measure.call_args.kwargs["voice_rate"] == 1.0


def test_preflight_rejects_missing_auth(client):
    response = client.post("/api/v1/audio/preflight-duration", json=_body())
    assert response.status_code == 401


def test_preflight_rejects_empty_script_and_missing_voice(client):
    response = client.post(
        "/api/v1/audio/preflight-duration",
        json=_body(video_script="   "),
        headers=_auth_headers(),
    )
    assert response.status_code == 400
    response = client.post(
        "/api/v1/audio/preflight-duration",
        json=_body(voice_name=""),
        headers=_auth_headers(),
    )
    assert response.status_code == 400


def test_preflight_maps_voice_audio_rejection_to_400(client):
    with patch(
        "app.controllers.v1.audio_preflight.audio_preflight.measure_narration_duration",
        side_effect=service.VoiceAudioRejectedError("is 71s long — the limit is 60 seconds"),
    ):
        response = client.post(
            "/api/v1/audio/preflight-duration",
            json=_body(voice_name="", voice_audio_url="https://e.com/narration.mp3"),
            headers=_auth_headers(),
        )
    assert response.status_code == 400


def test_preflight_maps_synthesis_failure_to_502(client):
    with patch(
        "app.controllers.v1.audio_preflight.audio_preflight.measure_narration_duration",
        side_effect=service.AudioPreflightError("provider unavailable"),
    ):
        response = client.post(
            "/api/v1/audio/preflight-duration", json=_body(), headers=_auth_headers()
        )
    assert response.status_code == 502


def test_measure_tts_uses_video_task_duration_computation():
    result = SimpleNamespace(ok=True, sub_maker=SimpleNamespace())
    with (
        patch("app.services.audio_preflight.voice.tts", return_value=result) as tts,
        patch("app.services.audio_preflight.audio_trim.trim_trailing_silence") as trim,
        patch("app.services.audio_preflight.voice.get_audio_duration", return_value=61.2) as duration,
    ):
        measured = service.measure_narration_duration(
            script="  Hello Lisbon.  ",
            language="en-US",
            voice_name="chatterbox:kokoro_af_heart-Female",
            voice_audio_url=None,
            user_id="user-1",
        )
    # Ceil of the subtitle-maker duration, after the trim — the video
    # task's audio_duration, not a fresh estimate.
    assert measured == 62.0
    assert tts.call_args.kwargs["text"] == "Hello Lisbon."
    assert tts.call_args.kwargs["voice_name"] == "chatterbox:kokoro_af_heart"
    assert tts.call_args.kwargs["voice_rate"] == 1.0
    trim.assert_called_once()
    duration.assert_called_once_with(result.sub_maker)


def test_measure_tts_failure_raises_instead_of_returning_duration():
    result = SimpleNamespace(ok=False, error="provider unavailable", sub_maker=None)
    with patch("app.services.audio_preflight.voice.tts", return_value=result):
        with pytest.raises(service.AudioPreflightError):
            service.measure_narration_duration(
                script="Hello.",
                language="en-US",
                voice_name="elevenlabs:abc",
                voice_audio_url=None,
                user_id="user-1",
            )


def test_measure_voice_audio_wins_over_voice_name_and_probes_file():
    with (
        patch(
            "app.services.task._download_persona_voice",
            return_value="/tmp/preflight-narration.mp3",
        ) as download,
        patch("app.services.audio_preflight.voice.tts") as tts,
        patch("app.services.audio_preflight.voice.get_audio_duration", return_value=45.0),
    ):
        measured = service.measure_narration_duration(
            script="Hello.",
            language="en-US",
            voice_name="chatterbox:kokoro_af_heart",
            voice_audio_url="https://e.com/narration.mp3",
            user_id="user-1",
        )
    assert measured == 45.0
    tts.assert_not_called()
    assert download.call_args[0][1] == "https://e.com/narration.mp3"


def test_measure_voice_audio_limit_becomes_rejection_not_502():
    from app.services.task import PersonaVoiceError

    with patch(
        "app.services.task._download_persona_voice",
        side_effect=PersonaVoiceError("is 71s long — the limit is 60 seconds"),
    ):
        with pytest.raises(service.VoiceAudioRejectedError):
            service.measure_narration_duration(
                script="Hello.",
                language="en-US",
                voice_name="",
                voice_audio_url="https://e.com/narration.mp3",
                user_id="user-1",
            )
