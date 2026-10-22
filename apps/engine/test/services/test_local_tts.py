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


class AtempoFilterTests(unittest.TestCase):
    def _factors(self, rate):
        value = local_tts._atempo_filter(rate)
        self.assertIsNotNone(value)
        return [float(part.split("=")[1]) for part in value.split(",")]

    def test_rate_one_is_no_filter(self):
        self.assertIsNone(local_tts._atempo_filter(1.0))

    def test_in_window_rates_use_a_single_factor(self):
        self.assertEqual(self._factors(1.5), [1.5])
        self.assertEqual(self._factors(0.75), [0.75])
        self.assertEqual(self._factors(2.0), [2.0])
        self.assertEqual(self._factors(0.5), [0.5])

    def test_out_of_window_rates_chain_to_the_exact_product(self):
        # The schema allows 0.1-5.0; a single atempo covers only
        # 0.5-2.0, so out-of-window rates must chain, never clamp.
        for rate in (3.0, 5.0, 0.3, 0.1):
            factors = self._factors(rate)
            self.assertGreater(len(factors), 1)
            for factor in factors:
                self.assertGreaterEqual(factor, 0.5)
                self.assertLessEqual(factor, 2.0)
            product = 1.0
            for factor in factors:
                product *= factor
            self.assertAlmostEqual(product, rate, places=6)


class LoaderTests(unittest.TestCase):
    def tearDown(self):
        local_tts._phonon_instance = None
        local_tts._kokoro_instance = None

    def test_load_phonon_builds_ptts_singleton(self):
        import sys
        import types

        fake_ptts = types.ModuleType("ptts")
        built = {}

        class _TTS:
            def __init__(self, model_id, lang=None, quant=None):
                built["args"] = (model_id, lang, quant)

        fake_ptts.TTS = _TTS
        with patch.dict(sys.modules, {"ptts": fake_ptts}):
            first = local_tts._load_phonon()
            second = local_tts._load_phonon()
        self.assertIs(first, second)
        self.assertEqual(built["args"], (local_tts.PHONON_MODEL_ID, "en", "q8"))

    def test_download_kokoro_files_fetches_only_missing(self):
        import io

        class _Response(io.BytesIO):
            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

            def raise_for_status(self):
                return None

            def iter_content(self, chunk_size=1):
                yield self.read()

        with tempfile.TemporaryDirectory() as tmp:
            model_dir = Path(tmp)
            (model_dir / "kokoro-v1.0.onnx").write_bytes(b"existing")
            fetched = []

            def fake_get(url, stream=None, timeout=None):
                fetched.append(url)
                return _Response(b"bytes")

            with patch.object(local_tts.requests, "get", side_effect=fake_get):
                local_tts._download_kokoro_files(model_dir)
            self.assertEqual(fetched, [local_tts.KOKORO_VOICES_URL])
            self.assertEqual((model_dir / "voices-v1.0.bin").read_bytes(), b"bytes")
            self.assertEqual((model_dir / "kokoro-v1.0.onnx").read_bytes(), b"existing")

    def test_load_kokoro_downloads_then_builds_singleton(self):
        import sys
        import types

        fake_module = types.ModuleType("kokoro_onnx")
        built = {}

        class _Kokoro:
            def __init__(self, model_path, voices_path):
                built["args"] = (model_path, voices_path)

        fake_module.Kokoro = _Kokoro
        with tempfile.TemporaryDirectory() as tmp, patch.dict(
            sys.modules, {"kokoro_onnx": fake_module}
        ), patch.object(local_tts, "_kokoro_model_dir", return_value=Path(tmp)), patch.object(
            local_tts, "_download_kokoro_files"
        ) as download:
            first = local_tts._load_kokoro()
            second = local_tts._load_kokoro()
        self.assertIs(first, second)
        download.assert_called_once()
        self.assertTrue(built["args"][0].endswith("kokoro-v1.0.onnx"))
        self.assertTrue(built["args"][1].endswith("voices-v1.0.bin"))


class NanoLoaderAndDirTests(unittest.TestCase):
    def tearDown(self):
        local_tts._nano_instance = None

    def test_load_nano_builds_singleton_and_patches_loudness(self):
        import sys
        import types

        fake_module = types.ModuleType("chatterbox.tts_turbo")
        built = {}

        class _Turbo:
            def norm_loudness(self, wav, sr, target_lufs=-27):
                return wav

            @classmethod
            def from_pretrained(cls, device=None, nano=None):
                built["args"] = (device, nano)
                return cls()

        fake_module.ChatterboxTurboTTS = _Turbo
        package = types.ModuleType("chatterbox")
        package.tts_turbo = fake_module
        with patch.dict(
            sys.modules, {"chatterbox": package, "chatterbox.tts_turbo": fake_module}
        ):
            first = local_tts._load_nano()
            second = local_tts._load_nano()
        self.assertIs(first, second)
        self.assertEqual(built["args"], ("cpu", True))
        # The numpy-2 loudness shim wraps the bound method: a float64
        # input comes back float32.
        out = first.norm_loudness(np.zeros(4, dtype=np.float64), 24000)
        self.assertEqual(out.dtype, np.float32)

    def test_kokoro_model_dir_env_override(self):
        with patch.dict(os.environ, {"KOKORO_MODEL_DIR": "/tmp/kokoro-x"}):
            self.assertEqual(local_tts._kokoro_model_dir(), Path("/tmp/kokoro-x"))

    def test_kokoro_model_dir_default(self):
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("KOKORO_MODEL_DIR", None)
            result = local_tts._kokoro_model_dir()
        self.assertEqual(result.name, "kokoro")
        self.assertEqual(result.parent.name, "models")

    def test_convert_raises_on_ffmpeg_failure(self):
        import subprocess as sp

        failed = sp.CompletedProcess(args=[], returncode=1, stdout="", stderr="bad input")
        with tempfile.TemporaryDirectory() as tmp, patch.object(
            local_tts.subprocess, "run", return_value=failed
        ):
            with self.assertRaises(RuntimeError):
                local_tts._convert_to_target(
                    str(Path(tmp) / "in.wav"), str(Path(tmp) / "out.mp3"), 1.0
                )


class KokoroResidualRateTests(unittest.TestCase):
    def test_rate_above_kokoro_window_splits_native_and_residual(self):
        fake = _FakeKokoro()
        captured = {}

        def fake_finish(text, wav_path, voice_file, rate):
            captured["rate"] = rate
            return local_tts.TtsResult(sub_maker=object())

        with tempfile.TemporaryDirectory() as tmp, patch.object(
            local_tts, "_load_kokoro", return_value=fake
        ), patch.object(local_tts, "_finish", side_effect=fake_finish):
            result = local_tts.kokoro_tts(
                "hello", "af_heart", str(Path(tmp) / "v.mp3"), voice_rate=3.0
            )
        self.assertTrue(result.ok)
        # Native speed clamps at 2.0; the residual 1.5 rides to _finish.
        self.assertEqual(fake.calls[0][2], 2.0)
        self.assertAlmostEqual(captured["rate"], 1.5)


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
            patch.object(local_tts, "local_registry_dir", return_value=Path(self._tmp.name)),
        ):
            result = local_tts.clone_tts("Hello.", "u0123456789ab_c0123456789a", self.voice_file)
        self.assertTrue(result.ok, result.error)
        self.assertEqual(fake.calls[0][1], reference)

    def test_clone_tts_fails_loudly_without_a_reference(self):
        with patch.object(local_tts, "local_registry_dir", return_value=Path(self._tmp.name)):
            result = local_tts.clone_tts("Hello.", "u0123456789ab_c0123456789a", self.voice_file)
        self.assertFalse(result.ok)
        self.assertIn("not available", result.error)

    def test_clone_tts_rejects_a_traversal_key(self):
        # The key-shape allowlist must refuse the crafted key before
        # any model loads.
        with patch.object(local_tts, "_load_nano") as load_nano:
            result = local_tts.clone_tts("Hello.", "../victim", self.voice_file)
        self.assertFalse(result.ok)
        self.assertIn("invalid cloned voice id", result.error)
        load_nano.assert_not_called()

    def test_nano_tts_rejects_empty_text(self):
        result = local_tts.nano_clone_tts(" ", "/tmp/ref.wav", self.voice_file)
        self.assertFalse(result.ok)


if __name__ == "__main__":
    unittest.main()
