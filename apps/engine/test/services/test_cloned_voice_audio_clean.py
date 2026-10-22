"""Audio cleaning chain for clone references (ffmpeg, real decode)."""

import io
import subprocess
import tempfile
import unittest
import wave
from pathlib import Path

from app.services.cloned_voices.audio import ReferenceAudioError
from app.services.cloned_voices.audio_clean import clean_reference_audio
from app.services.cloned_voices.constants import ERROR_INVALID_AUDIO


def _noisy_fixture_bytes() -> bytes:
    """1.5s of tone over light noise, then 1.0s of trailing silence."""
    with tempfile.TemporaryDirectory() as work:
        out = Path(work) / "fixture.wav"
        result = subprocess.run(
            [
                "ffmpeg", "-y",
                "-f", "lavfi", "-i", "sine=frequency=440:duration=1.5",
                "-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono",
                "-f", "lavfi", "-i", "anoisesrc=duration=2.5:amplitude=0.01",
                "-filter_complex",
                "[0:a][1:a]concat=n=2:v=0:a=1[voice];[voice][2:a]amix=inputs=2:duration=first[aout]",
                "-map", "[aout]", "-ac", "1", "-ar", "24000", "-t", "2.5",
                str(out),
            ],
            capture_output=True,
            text=True,
        )
        assert result.returncode == 0, result.stderr
        return out.read_bytes()


class CleanReferenceAudioTests(unittest.TestCase):
    def test_clean_produces_mono_24k_wav_and_trims_trailing_silence(self):
        source = _noisy_fixture_bytes()
        cleaned = clean_reference_audio(source)

        with wave.open(io.BytesIO(cleaned.wav_bytes), "rb") as wav:
            self.assertEqual(wav.getnchannels(), 1)
            self.assertEqual(wav.getframerate(), 24000)
        # The 1.0s silent tail is trimmed; the 1.5s of tone survives.
        self.assertLess(cleaned.duration_seconds, 2.2)
        self.assertGreater(cleaned.duration_seconds, 1.0)
        self.assertNotEqual(cleaned.wav_bytes, source)

    def test_clean_rejects_garbage(self):
        with self.assertRaises(ReferenceAudioError) as ctx:
            clean_reference_audio(b"this is not audio at all")
        self.assertEqual(ctx.exception.error_code, ERROR_INVALID_AUDIO)

    def test_clean_rejects_empty(self):
        with self.assertRaises(ReferenceAudioError) as ctx:
            clean_reference_audio(b"")
        self.assertEqual(ctx.exception.error_code, ERROR_INVALID_AUDIO)


if __name__ == "__main__":
    unittest.main()
