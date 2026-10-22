"""Reference audio normalization for Chatterbox voice registration."""

from __future__ import annotations

import json
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path

from app.services.cloned_voices.constants import (
    ERROR_AUDIO_TOO_LARGE,
    ERROR_AUDIO_TOO_LONG,
    ERROR_INVALID_AUDIO,
    MAX_REFERENCE_BYTES,
    MAX_REFERENCE_SECONDS,
)


# Speech cleanup applied before cloning when the user keeps "clean audio" on:
# drop rumble below 80 Hz and hiss above 12 kHz, suppress steady background
# noise (FFT denoiser, -25 dB floor), then level loudness. A clone copies
# whatever noise its reference carries, so phone recordings sound better
# cleaned; studio recordings can opt out and keep the original.
DENOISE_FILTER = "highpass=f=80,lowpass=f=12000,afftdn=nf=-25,loudnorm=I=-20:TP=-2"


@dataclass(frozen=True)
class NormalizedReferenceAudio:
    wav_bytes: bytes
    duration_seconds: float


class ReferenceAudioError(ValueError):
    """Validation failure with a stable error_code for API/analytics."""

    def __init__(self, error_code: str, message: str) -> None:
        super().__init__(message)
        self.error_code = error_code


def _probe_duration_seconds(path: Path) -> float | None:
    try:
        result = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "stream=codec_type",
                "-show_entries",
                "format=duration",
                "-of",
                "json",
                str(path),
            ],
            capture_output=True,
            text=True,
            check=True,
        )
        info = json.loads(result.stdout or "{}")
    except (subprocess.CalledProcessError, json.JSONDecodeError, OSError):
        return None
    streams = info.get("streams") or []
    if not any(s.get("codec_type") == "audio" for s in streams):
        return None
    try:
        duration = float((info.get("format") or {}).get("duration", 0))
    except (TypeError, ValueError):
        return None
    if duration <= 0:
        return None
    return duration


def normalize_reference_audio(source_bytes: bytes, denoise: bool) -> NormalizedReferenceAudio:
    """Decode arbitrary upload bytes to mono 24 kHz WAV within product limits.

    With ``denoise`` the ``DENOISE_FILTER`` chain runs in the same ffmpeg pass.
    """
    if len(source_bytes) == 0:
        raise ReferenceAudioError(ERROR_INVALID_AUDIO, "reference audio is empty")
    if len(source_bytes) > MAX_REFERENCE_BYTES:
        raise ReferenceAudioError(
            ERROR_AUDIO_TOO_LARGE,
            f"reference audio exceeds {MAX_REFERENCE_BYTES // 1024 // 1024} MB",
        )

    with tempfile.TemporaryDirectory(prefix="clone-ref-") as work:
        work_path = Path(work)
        source_path = work_path / "input.bin"
        wav_path = work_path / "reference.wav"
        source_path.write_bytes(source_bytes)

        filter_args = ["-af", DENOISE_FILTER] if denoise else []
        result = subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-i",
                str(source_path),
                *filter_args,
                "-ac",
                "1",
                "-ar",
                "24000",
                "-f",
                "wav",
                str(wav_path),
            ],
            capture_output=True,
            text=True,
        )
        if result.returncode != 0 or not wav_path.is_file():
            raise ReferenceAudioError(ERROR_INVALID_AUDIO, "could not decode reference audio")

        wav_bytes = wav_path.read_bytes()
        if len(wav_bytes) > MAX_REFERENCE_BYTES:
            raise ReferenceAudioError(
                ERROR_AUDIO_TOO_LARGE,
                f"reference audio exceeds {MAX_REFERENCE_BYTES // 1024 // 1024} MB",
            )

        duration = _probe_duration_seconds(wav_path)
        if duration is None:
            raise ReferenceAudioError(ERROR_INVALID_AUDIO, "reference audio has no audio stream")
        if duration > MAX_REFERENCE_SECONDS:
            raise ReferenceAudioError(
                ERROR_AUDIO_TOO_LONG,
                f"reference audio exceeds {MAX_REFERENCE_SECONDS} seconds",
            )

        return NormalizedReferenceAudio(wav_bytes=wav_bytes, duration_seconds=duration)
