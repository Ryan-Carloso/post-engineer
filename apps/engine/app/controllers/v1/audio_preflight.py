"""POST /api/v1/audio/preflight-duration — measure narration pre-charge.

The web generate-and-schedule route charges before it dispatches the
video task, so it cannot learn the real TTS duration from the task
itself. It calls here, with exactly the inputs the video task will use,
and only charges when the returned duration fits the caller's cap
(full lip-sync: 60s). The cap itself lives on the caller: this endpoint
only measures, it never decides what is too long for a product mode —
except the voice-audio download, which enforces its own 60s product
limit inside _download_persona_voice and surfaces it as a 400 here.

Auth is the engine token (new_router dependency) plus the user id from
the auth context, which the cloned-voice ownership check inside
voice.tts requires. A synthesis/measurement failure is a 502: the caller
must fail closed (no charge) on an unknown duration, never proceed.
"""

from fastapi import Request
from pydantic import BaseModel, Field

from app.controllers import base
from app.controllers.v1.base import new_router
from app.models.exception import HttpException
from app.services import audio_preflight
from app.utils import utils

router = new_router()


class AudioPreflightRequest(BaseModel):
    video_script: str = Field(max_length=20000)
    video_language: str = Field(default="", max_length=32)
    # The resolved voice id (e.g. chatterbox:kokoro_af_heart), exactly as
    # the video task receives it in persona.voice_id. Empty when the
    # narration comes from voice_audio_url instead.
    voice_name: str = Field(default="", max_length=200)
    voice_audio_url: str | None = Field(default=None, max_length=2048)
    # Matches the VideoParams default (1.0), NOT AudioRequest's 1.2: the
    # video task synthesizes at 1.0 unless the caller sets a rate, and
    # the web caller never does, so a different default here would
    # measure a different duration than the video task produces.
    voice_rate: float = Field(default=1.0, ge=0.1, le=5.0)


@router.post(
    "/audio/preflight-duration",
    summary="Measure narration duration before charging (full lip-sync gate)",
)
def preflight_duration(request: Request, body: AudioPreflightRequest):
    auth = base.get_auth_context(request)
    request_id = base.get_task_id(request)
    if not body.video_script.strip():
        raise HttpException(
            task_id=request_id,
            status_code=400,
            message=f"{request_id}: video_script must not be empty",
        )
    if not body.voice_audio_url and not body.voice_name.strip():
        raise HttpException(
            task_id=request_id,
            status_code=400,
            message=f"{request_id}: one of voice_name or voice_audio_url is required",
        )
    if body.voice_audio_url and not body.voice_audio_url.startswith(("http://", "https://")):
        raise HttpException(
            task_id=request_id,
            status_code=400,
            message=f"{request_id}: voice_audio_url must be an http(s) URL",
        )
    try:
        duration = audio_preflight.measure_narration_duration(
            script=body.video_script,
            language=body.video_language,
            voice_name=body.voice_name,
            voice_audio_url=body.voice_audio_url,
            user_id=auth.user_id,
            voice_rate=body.voice_rate,
        )
    except audio_preflight.VoiceAudioRejectedError as exc:
        raise HttpException(
            task_id=request_id,
            status_code=400,
            message=f"{request_id}: voice audio rejected: {exc}",
        )
    except audio_preflight.AudioPreflightError as exc:
        raise HttpException(
            task_id=request_id,
            status_code=502,
            message=f"{request_id}: narration preflight failed: {exc}",
        )
    return utils.get_response(200, {"audio_duration_seconds": duration})
