"""Local CPU TTS providers (Phonon / Kokoro / Chatterbox-Nano).

Model loading is stubbed at the module's loader seams: unit tests never
download or run a real model. The fakes emit tiny valid WAVs so the
shared finish path (convert + measure + subtitle timeline) runs for
real against ffmpeg.
"""

import os
import tempfile
import unittest
import wave
from pathlib import Path
from unittest.mock import patch

import numpy as np

from app.services import local_tts


def _write_silence_wav(path: str, seconds: float = 0.2, rate: int = 24000) -> None:
    with wave.open(path, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(rate)
        wav.writeframes(b"\x00\x00" * int(seconds * rate))


class _FakePhonon:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str]] = []

    def save(self, path, text, voice=None):
        self.calls.append((text, voice))
        _write_silence_wav(path)


class _FakeKokoro:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str, float, str]] = []

    def create(self, text, voice, speed=1.0, lang="en-us"):
        self.calls.append((text, voice, speed, lang))
        return np.zeros(4800, dtype=np.float32), 24000


class _FakeTensor:
    def __init__(self, samples: np.ndarray) -> None:
        self._samples = samples

    def squeeze(self, _dim):
        return self

    def clamp(self, _min, _max):
        return self

    def numpy(self):
        return self._samples


class _FakeNano:
    sr = 24000

    def __init__(self) -> None:
        self.calls: list[tuple[str, str]] = []

    def generate(self, text, audio_prompt_path=None):
        self.calls.append((text, audio_prompt_path))
        return _FakeTensor(np.zeros(4800, dtype=np.float32))


class NanoNormLoudnessPatchTests(unittest.TestCase):
    def test_wrapped_norm_loudness_returns_float32(self):
        class _FakeModel:
            def norm_loudness(self, wav, sr, target_lufs=-27):
                # pyloudnorm's float64 gain promotes the reference under
                # numpy >= 2 (NEP 50); upstream returns that float64 array.
                return wav.astype(np.float64) * np.float64(1.5)

        model = _FakeModel()
        local_tts._patch_nano_norm_loudness(model)

        out = model.norm_loudness(np.zeros(4, dtype=np.float32), 24000)
        self.assertEqual(out.dtype, np.float32)


class LocalTtsTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.voice_file = os.path.join(self._tmp.name, "voice.mp3")

    def test_phonon_tts_synthesizes_via_ptts(self):
        fake = _FakePhonon()
        with patch.object(local_tts, "_load_phonon", return_value=fake):
            result = local_tts.phonon_tts("Hello world.", "Easton", self.voice_file)
        self.assertTrue(result.ok, result.error)
        self.assertEqual(fake.calls, [("Hello world.", "Easton")])
        self.assertTrue(os.path.getsize(self.voice_file) > 0)
        self.assertTrue(result.sub_maker.subs)

    def test_phonon_tts_rejects_empty_text(self):
        result = local_tts.phonon_tts("  ", "Easton", self.voice_file)
        self.assertFalse(result.ok)
        self.assertIn("empty", result.error)

    def test_phonon_tts_reports_loader_failure(self):
        with patch.object(local_tts, "_load_phonon", side_effect=RuntimeError("boom")):
            result = local_tts.phonon_tts("Hello.", "Easton", self.voice_file)
        self.assertFalse(result.ok)
        self.assertIn("Phonon", result.error)

    def test_kokoro_tts_uses_voice_id_and_locale(self):
        fake = _FakeKokoro()
        with patch.object(local_tts, "_load_kokoro", return_value=fake):
            result = local_tts.kokoro_tts("Hello world.", "bm_george", self.voice_file, voice_rate=1.2)
        self.assertTrue(result.ok, result.error)
        self.assertEqual(fake.calls[0][1], "bm_george")
        self.assertEqual(fake.calls[0][2], 1.2)
        self.assertEqual(fake.calls[0][3], "en-gb")

    def test_kokoro_tts_rejects_empty_text(self):
        result = local_tts.kokoro_tts("", "af_heart", self.voice_file)
        self.assertFalse(result.ok)

    def test_clone_tts_uses_the_registered_reference(self):
        reference = os.path.join(self._tmp.name, "u0123456789ab_c0123456789a.wav")
        _write_silence_wav(reference)
        fake = _FakeNano()
        with (
            patch.object(local_tts, "_load_nano", return_value=fake),
            patch.object(local_tts, "reference_path_for", return_value=Path(reference)),
        ):
            result = local_tts.clone_tts("Hello.", "u0123456789ab_c0123456789a", self.voice_file)
        self.assertTrue(result.ok, result.error)
        self.assertEqual(fake.calls[0][1], reference)

    def test_clone_tts_fails_loudly_without_a_reference(self):
        missing = Path(self._tmp.name) / "nope.wav"
        with patch.object(local_tts, "reference_path_for", return_value=missing):
            result = local_tts.clone_tts("Hello.", "u0123456789ab_c0123456789a", self.voice_file)
        self.assertFalse(result.ok)
        self.assertIn("not available", result.error)

    def test_nano_tts_rejects_empty_text(self):
        result = local_tts.nano_clone_tts(" ", "/tmp/ref.wav", self.voice_file)
        self.assertFalse(result.ok)


if __name__ == "__main__":
    unittest.main()
