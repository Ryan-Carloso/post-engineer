"""Reject an unusable voice at the start of a job, before any cost.

A persona with no voice, or a voice name no provider recognises (for
example ``energetic`` or ``en-US-GuyNeural``), used to fail only in the
audio stage, after the script and web-search work had already run
(and that stage is in ``GENERATION_STAGES``, so the job was retried even
though the configuration can never become valid). This mirrors the voice
that ``task.generate_audio`` will use and the routing ``voice.tts`` applies,
without synthesizing anything, so the failure happens first and the task is
failed and refunded.
"""

from app.models.schema import VideoParams
from app.services import voice
from app.services.openrouter_tts import is_openrouter_voice, parse_openrouter_voice


class VoiceConfigError(ValueError):
    """The job's voice cannot be used; the message is safe to show."""


def voice_problem(params: VideoParams) -> str | None:
    """Why the voice is unusable, or None when TTS (or custom audio) can run."""
    if getattr(params, "custom_audio_file", None):
        return None
    persona = getattr(params, "persona", None)
    if persona is not None and persona.voice_audio_url:
        return None
    raw_name = persona.voice_id if persona is not None and persona.voice_id else params.voice_name
    if not (raw_name or "").strip():
        return (
            "no voice configured: the persona has no voice_id/voice_audio_url "
            "and no voice_name was provided"
        )
    name = voice.parse_voice_name(raw_name)
    if voice.is_no_voice(name):
        return None
    if voice.is_elevenlabs_voice(name) or voice.is_chatterbox_voice(name):
        if not name.split(":", 1)[1].strip():
            return f"invalid voice name {name!r}: the id after the provider prefix is empty"
        return None
    if is_openrouter_voice(name):
        if parse_openrouter_voice(name) is None:
            return "invalid OpenRouter voice name (expected 'openrouter:<model>:<voice>')"
        return None
    return (
        f"unknown voice {name!r}; providers are ElevenLabs ('elevenlabs:<id>'), "
        "Chatterbox ('chatterbox:<name>') and OpenRouter ('openrouter:<model>:<voice>'); "
        f"use {voice.NO_VOICE_NAME!r} for silence"
    )


def check_voice(params: VideoParams) -> None:
    """Raise VoiceConfigError when the job's voice is unusable."""
    problem = voice_problem(params)
    if problem is not None:
        raise VoiceConfigError(problem)
