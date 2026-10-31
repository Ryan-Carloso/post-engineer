"""Tests for the resident (load-once) LongCat renderer.

``ResidentRenderer`` needs a GPU and the upstream ``longcat_video`` package, so
the model path cannot run here. These tests cover the pure helpers, the failure
paths that run before any GPU work, and source pins on the wiring that makes the
model load once per container instead of once per clip.
"""

import ast
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import modal_longcat_resident as resident
from app.services import longcat

ENGINE_DIR = Path(__file__).resolve().parents[2]


def _source(name: str) -> str:
    return (ENGINE_DIR / name).read_text()


class TestClipArithmeticSync(unittest.TestCase):
    def test_generate_seconds_matches_the_client_for_every_segment_count(self):
        # The client sizes num_segments from the narration; if the renderer's
        # clip length drifts the audio gets padded or cut at the wrong place.
        for segments in range(1, longcat.MAX_SEGMENTS + 1):
            with self.subTest(segments=segments):
                self.assertAlmostEqual(
                    resident.generate_seconds(segments),
                    longcat.clip_seconds(segments),
                )


class TestPaddingSamples(unittest.TestCase):
    def test_pads_silent_audio_to_the_full_clip(self):
        self.assertEqual(
            resident.padding_samples(1, 0), round(3.72 * resident.AUDIO_SAMPLE_RATE)
        )

    def test_no_padding_when_audio_already_covers_the_clip(self):
        self.assertEqual(resident.padding_samples(1, 10 * resident.AUDIO_SAMPLE_RATE), 0)

    def test_padding_grows_with_the_segment_count(self):
        self.assertGreater(
            resident.padding_samples(3, 16000), resident.padding_samples(1, 16000)
        )

    def test_padding_fills_exactly_the_missing_tail(self):
        one_second = resident.AUDIO_SAMPLE_RATE
        padded = one_second + resident.padding_samples(2, one_second)
        self.assertAlmostEqual(
            padded / resident.AUDIO_SAMPLE_RATE,
            resident.generate_seconds(2),
            delta=1 / resident.AUDIO_SAMPLE_RATE,
        )


class TestRenderFailsBeforeGpuWork(unittest.TestCase):
    def _renderer(self) -> resident.ResidentRenderer:
        # __new__ skips the GPU-only constructor; the validation under test runs
        # before anything touches torch.
        return resident.ResidentRenderer.__new__(resident.ResidentRenderer)

    def test_unknown_resolution_is_rejected(self):
        with self.assertRaises(ValueError) as caught:
            self._renderer().render(Path("i.png"), Path("a.wav"), "1080p", 1, Path("o"))
        self.assertIn("1080p", str(caught.exception))

    def test_zero_segments_is_rejected(self):
        with self.assertRaises(ValueError):
            self._renderer().render(Path("i.png"), Path("a.wav"), "480p", 0, Path("o"))


class TestDecodeSpeech(unittest.TestCase):
    def test_ffmpeg_failure_raises_with_its_stderr(self):
        failed = subprocess.CompletedProcess([], 1, stdout="", stderr="no such codec")
        with tempfile.TemporaryDirectory() as work, mock.patch.object(
            resident.subprocess, "run", return_value=failed
        ):
            with self.assertRaises(RuntimeError) as caught:
                resident._decode_speech(Path(work) / "voice.wav", Path(work))
        self.assertIn("no such codec", str(caught.exception))

    def test_decodes_to_16khz_mono(self):
        done = subprocess.CompletedProcess([], 0, stdout="", stderr="")
        with tempfile.TemporaryDirectory() as work, mock.patch.object(
            resident.subprocess, "run", return_value=done
        ) as run:
            (Path(work) / "speech_16k.wav").write_bytes(b"x")
            target = resident._decode_speech(Path(work) / "voice.wav", Path(work))
        command = run.call_args[0][0]
        self.assertEqual(command[command.index("-ac") + 1], "1")
        self.assertEqual(command[command.index("-ar") + 1], "16000")
        self.assertEqual(target.name, "speech_16k.wav")


class TestModelLoadsOncePerContainer(unittest.TestCase):
    """Pin the wiring: reverting to a per-clip subprocess fails these."""

    def test_no_torchrun_subprocess_remains(self):
        for name in (
            "modal_longcat.py",
            "modal_longcat_gpu.py",
            "modal_longcat_resident.py",
        ):
            with self.subTest(module=name):
                self.assertNotIn('"torchrun"', _source(name))

    def test_vocal_patch_is_fully_removed(self):
        self.assertFalse((ENGINE_DIR / "app/utils/longcat_vocal_patch.py").exists())
        self.assertNotIn("longcat_vocal_patch", _source("modal_longcat_gpu.py"))

    def _generate_avatar_methods(self) -> dict[str, ast.FunctionDef]:
        tree = ast.parse(_source("modal_longcat.py"))
        for node in ast.walk(tree):
            if isinstance(node, ast.ClassDef) and node.name == "GenerateAvatar":
                return {
                    item.name: item
                    for item in node.body
                    if isinstance(item, ast.FunctionDef)
                }
        self.fail("GenerateAvatar not found")

    @staticmethod
    def _decorators(method: ast.FunctionDef) -> set[str]:
        return {ast.unparse(decorator) for decorator in method.decorator_list}

    def test_model_is_built_in_the_enter_hook(self):
        methods = self._generate_avatar_methods()
        enter = [
            name
            for name, method in methods.items()
            if "modal.enter()" in self._decorators(method)
        ]
        self.assertEqual(len(enter), 1, "exactly one enter hook builds the model")
        body = ast.unparse(methods[enter[0]])
        self.assertIn("ResidentRenderer(", body)
        self.assertNotIn("ResidentRenderer(", ast.unparse(methods["generate_bytes"]))

    def test_each_job_renders_with_the_resident_renderer(self):
        handler = ast.unparse(self._generate_avatar_methods()["generate_bytes"])
        self.assertIn("run_longcat(self.renderer", handler)

    def test_generator_is_reseeded_for_every_clip(self):
        # A long-lived process must not let one clip's randomness leak into the
        # next: the seed is applied inside the per-clip path, not the loader.
        tree = ast.parse(_source("modal_longcat_resident.py"))
        for node in ast.walk(tree):
            if isinstance(node, ast.FunctionDef) and node.name == "_render":
                self.assertIn("manual_seed(SEED)", ast.unparse(node))
                return
        self.fail("_render not found")

    def test_gpu_cache_is_released_even_when_a_clip_fails(self):
        tree = ast.parse(_source("modal_longcat_resident.py"))
        for node in ast.walk(tree):
            if isinstance(node, ast.FunctionDef) and node.name == "render":
                tries = [item for item in ast.walk(node) if isinstance(item, ast.Try)]
                self.assertTrue(tries)
                cleanup = "\n".join(ast.unparse(stmt) for stmt in tries[0].finalbody)
                self.assertIn("empty_cache()", cleanup)
                return
        self.fail("render not found")

    def test_missing_distill_lora_is_an_error_not_a_silent_skip(self):
        source = _source("modal_longcat_resident.py")
        self.assertIn("raise FileNotFoundError", source)
        self.assertIn("dmd_lora.safetensors", source)


if __name__ == "__main__":
    unittest.main()
