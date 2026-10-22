"""Reference-audio cleaning for voice cloning.

The clean chain (the same one applied by hand to the first production
clone reference): decode to mono 24 kHz, 70 Hz high-pass to drop rumble,
FFT denoise (``afftdn``), loudness normalization (``loudnorm``), and a
trailing-silence trim (``silenceremove`` over the reversed stream, so
it cuts the END of the recording). Cloning from the cleaned reference
is the product default; the user can A/B it against the original in
the picker and opt out per clone.

Limits and error codes match ``normalize_reference_audio`` exactly:
cleaning never produces a reference the plain path would reject.
"""

from __future__ import annotations

import subprocess
import tempfile
from pathlib import Path

from app.services.cloned_voices.audio import (
    NormalizedReferenceAudio,
    ReferenceAudioError,
    _probe_duration_seconds,
)
from app.services.cloned_voices.constants import (
    ERROR_AUDIO_TOO_LARGE,
    ERROR_AUDIO_TOO_LONG,
    ERROR_INVALID_AUDIO,
    MAX_REFERENCE_BYTES,
    MAX_REFERENCE_SECONDS,
)

_CLEAN_FILTER = (
    "highpass=f=70,afftdn,loudnorm,"
    "areverse,silenceremove=start_periods=1:start_duration=0.05:start_threshold=-50dB,areverse"
)


def clean_reference_audio(source_bytes: bytes) -> NormalizedReferenceAudio:
    """Clean an uploaded reference recording into a mono 24 kHz WAV."""
    if len(source_bytes) == 0:
        raise ReferenceAudioError(ERROR_INVALID_AUDIO, "reference audio is empty")
    if len(source_bytes) > MAX_REFERENCE_BYTES:
        raise ReferenceAudioError(
            ERROR_AUDIO_TOO_LARGE,
            f"reference audio exceeds {MAX_REFERENCE_BYTES // 1024 // 1024} MB",
        )

    with tempfile.TemporaryDirectory(prefix="clone-clean-") as work:
        work_path = Path(work)
        source_path = work_path / "input.bin"
        wav_path = work_path / "cleaned.wav"
        source_path.write_bytes(source_bytes)

        result = subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-i",
                str(source_path),
                "-ac",
                "1",
                "-ar",
                "24000",
                "-af",
                _CLEAN_FILTER,
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
