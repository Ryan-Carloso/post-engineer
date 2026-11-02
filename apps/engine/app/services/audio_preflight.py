"""Measure narration duration BEFORE any token is charged.

The web generate-and-schedule route charges (spend_tokens) before it
dispatches the engine video task, and the engine only learns the real TTS
duration inside that task. That ordering is why a full lip-sync video over
the 60s cap used to be charged first and refunded after the engine
rejected it. This module closes the gap: the web route calls the engine
preflight endpoint (which calls this module) with exactly the inputs the
video task will use, and only charges when the measured duration fits.

Fidelity rules (the measurement must be the video task's measurement,
not a second opinion):
- TTS path: the same voice.tts call the video task makes
  (task.py generate_audio), with the same voice_rate default (1.0 — the
  VideoParams default, NOT AudioRequest's 1.2), the same trailing-silence
  trim, and the same duration computation (ceil of the subtitle-maker
  duration). A later trim_after_last_word in the video task can only
  shorten the narration, so a preflight duration at or under the cap
  stays at or under it in the video task, modulo provider nondeterminism
  (the engine 60s guard remains the backstop for that drift).
- Voice-audio path: the same _download_persona_voice download the video
  task makes, which itself enforces the 60s product limit (it raises
  PersonaVoiceError past it); on success the duration is the ffprobe
  duration of the downloaded file, exactly as the video task measures it.

Cost honesty: this synthesizes the narration once here AND once again
inside the video task (the video task re-synthesizes so its subtitle
timeline comes from its own TTS run). For local Chatterbox voices that is
CPU time, not money; for ElevenLabs/OpenRouter voices the provider is
billed twice for the same script. That double TTS cost is the price of a
true pre-charge guarantee with the current charge-before-dispatch flow,
and it is stated in the PR body rather than hidden.

The task.py import is lazy (inside the function) so importing this
module never pulls the whole video pipeline into a light controller.
"""

from __future__ import annotations

import math
import shutil
import tempfile
from pathlib import Path

from app.services import audio_trim, voice


class AudioPreflightError(RuntimeError):
    """The narration could not be synthesized or measured (engine problem)."""


class VoiceAudioRejectedError(ValueError):
    """The voice-audio narration was rejected by its own download check.

    Raised (not wrapped as a 502) when _download_persona_voice rejects
    the file — including its 60s product limit — so the caller maps it
    to a 400: the request itself is bad, and no charge must follow.
    """


def measure_narration_duration(
    script: str,
    language: str,
    voice_name: str,
    voice_audio_url: str | None,
    user_id: str,
    voice_rate: float = 1.0,
) -> float:
    """Return the narration duration in seconds for a video task's inputs.

    voice_audio_url wins when present, exactly as resolve_persona_audio
    resolves it in the video task (a voice sample becomes the narration
    and TTS is skipped). Raises AudioPreflightError on a synthesis or
    measurement failure, and VoiceAudioRejectedError when the
    voice-audio download itself rejects the file (including its 60s
    limit) so the caller can map it to a 400.
    """
    text = (script or "").strip()
    if not text:
        raise AudioPreflightError("empty script: nothing to synthesize")
    if voice_audio_url:
        return _measure_voice_audio_duration(voice_audio_url)
    if not (voice_name or "").strip():
        raise AudioPreflightError("no voice configured: no voice_name or voice_audio_url")
    work_dir = tempfile.mkdtemp(prefix="audio-preflight-")
    try:
        audio_file = str(Path(work_dir) / "audio.mp3")
        result = voice.tts(
            text=text,
            voice_name=voice.parse_voice_name(voice_name),
            voice_rate=voice_rate,
            voice_file=audio_file,
            language=language,
            user_id=user_id,
            task_id="audio-preflight",
        )
        if not result.ok:
            raise AudioPreflightError(result.error or "unknown TTS failure")
        audio_trim.trim_trailing_silence(audio_file)
        duration = math.ceil(voice.get_audio_duration(result.sub_maker))
        if duration <= 0:
            raise AudioPreflightError("failed to get audio duration")
        return float(duration)
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)


def _measure_voice_audio_duration(voice_audio_url: str) -> float:
    """Download a voice-audio narration and return its ffprobe duration."""
    # Lazy import: task.py is the whole video pipeline; this module must
    # stay importable from a light controller without pulling it in.
    from app.services.task import PersonaVoiceError, _download_persona_voice

    work_dir = tempfile.mkdtemp(prefix="audio-preflight-voice-")
    # _download_persona_voice downloads into utils.task_dir(task_id), not
    # into work_dir, so it gets a synthetic task id whose directory is
    # removed below. It enforces the 60s product limit itself; a
    # PersonaVoiceError from it becomes VoiceAudioRejectedError below.
    task_id = f"audio-preflight-{Path(work_dir).name}"
    try:
        audio_file = _download_persona_voice(task_id, voice_audio_url)
    except PersonaVoiceError as exc:
        raise VoiceAudioRejectedError(str(exc)) from exc
    try:
        duration = voice.get_audio_duration(audio_file)
        if duration <= 0:
            raise AudioPreflightError("failed to get audio duration from voice audio")
        return float(duration)
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)
        _remove_preflight_task_dir(task_id)


def _remove_preflight_task_dir(task_id: str) -> None:
    """Best-effort removal of the synthetic preflight task directory."""
    from app.utils import utils

    shutil.rmtree(utils.task_dir(task_id), ignore_errors=True)
