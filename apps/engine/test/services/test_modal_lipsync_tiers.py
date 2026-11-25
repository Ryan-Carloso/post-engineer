"""Tests for the cheap lip-sync tier helpers and their two Modal apps."""

import ast
import subprocess
import tempfile
import unittest
from pathlib import Path

import modal_lipsync_job as job

ENGINE_DIR = Path(__file__).resolve().parents[2]


def _source(name: str) -> str:
    return (ENGINE_DIR / name).read_text()


def _package_name(spec: str) -> str:
    name = spec.split("[")[0]
    for sep in ("==", ">=", "<=", "!=", "~=", ">", "<"):
        name = name.split(sep)[0]
    return name.strip()


def _installed_binaries(source: str) -> set[str]:
    tree = ast.parse(source)
    installed = set()
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        func = node.func
        if not isinstance(func, ast.Attribute) or func.attr not in ("apt_install", "pip_install"):
            continue
        for arg in node.args:
            if isinstance(arg, ast.Constant) and isinstance(arg.value, str):
                installed.add(_package_name(arg.value))
    return installed


def _shelled_binaries(source: str) -> set[str]:
    tree = ast.parse(source)
    binaries = set()
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        func = node.func
        if not (
            isinstance(func, ast.Attribute)
            and func.attr in ("run", "check_call", "check_output", "Popen")
            and isinstance(func.value, ast.Name)
            and func.value.id == "subprocess"
        ):
            continue
        assert node.args, "subprocess call without arguments"
        first = node.args[0]
        if isinstance(first, ast.List) and first.elts:
            head = first.elts[0]
            assert isinstance(head, ast.Constant) and isinstance(head.value, str), (
                "subprocess command is not a literal list of strings"
            )
            binaries.add(head.value)
        elif isinstance(first, ast.Constant) and isinstance(first.value, str):
            binaries.add(first.value.split()[0])
        else:
            raise AssertionError("subprocess command is not a literal")
    return binaries


def _completed(stdout: str = "") -> subprocess.CompletedProcess[str]:
    return subprocess.CompletedProcess(args=[], returncode=0, stdout=stdout, stderr="")


class FakeRunner:
    """Stands in for ffmpeg/ffprobe: records calls, writes the files they would."""

    def __init__(self, duration: str = "15.0") -> None:
        self.calls: list[list[str]] = []
        self.duration = duration

    def __call__(self, args: list[str], cwd: str | None = None) -> subprocess.CompletedProcess[str]:
        self.calls.append(args)
        if args[0] == "ffprobe":
            return _completed(self.duration + "\n")
        Path(args[-1]).write_bytes(b"media")
        return _completed()


class BaseClipArgsTests(unittest.TestCase):
    def test_renders_a_25fps_clip_of_the_configured_length(self):
        args = job.base_clip_args("in.png", "out.mp4")
        self.assertEqual(args[:6], ["ffmpeg", "-y", "-loop", "1", "-i", "in.png"])
        self.assertEqual(args[-1], "out.mp4")
        frames_index = args.index("-frames:v")
        self.assertEqual(args[frames_index + 1], str(job.BASE_CLIP_SECONDS * job.MODEL_FPS))

    def test_zoom_is_one_full_cosine_cycle(self):
        video_filter = job.base_clip_args("in.png", "out.mp4")[7]
        frames = job.BASE_CLIP_SECONDS * job.MODEL_FPS
        self.assertIn(f"1+{job.ZOOM_AMPLITUDE / 2}*(1-cos(2*PI*on/{frames}))", video_filter)
        self.assertIn(f"fps={job.MODEL_FPS}", video_filter)
        self.assertIn(f"s={job.BASE_CLIP_SIZE}x{job.BASE_CLIP_SIZE}", video_filter)


class ModelArgsTests(unittest.TestCase):
    def test_audio_is_decoded_to_16k_mono(self):
        self.assertEqual(
            job.audio_decode_args("in.mp3", "out.wav"),
            ["ffmpeg", "-y", "-i", "in.mp3", "-ac", "1", "-ar", "16000", "out.wav"],
        )

    def test_musetalk_config_names_one_task(self):
        self.assertEqual(
            job.musetalk_config_yaml("/w/base.mp4", "/w/voice.wav"),
            'task_0:\n  video_path: "/w/base.mp4"\n  audio_path: "/w/voice.wav"\n'
            '  result_name: "result.mp4"\n',
        )

    def test_musetalk_runs_version_15_in_fp16_at_25fps(self):
        args = job.musetalk_args("/w/task.yaml", "/w/results")
        self.assertEqual(args[:3], ["python", "-m", "scripts.inference"])
        pairs = dict(zip(args[3::2], args[4::2]))
        self.assertEqual(pairs["--inference_config"], "/w/task.yaml")
        self.assertEqual(pairs["--result_dir"], "/w/results")
        self.assertEqual(pairs["--version"], "v15")
        self.assertEqual(pairs["--fps"], "25")
        self.assertEqual(args[-1], "--use_float16")
        self.assertEqual(job.musetalk_output_path("/w/results"), "/w/results/v15/result.mp4")

    def test_tbdub_runs_the_two_step_student(self):
        args = job.tbdub_args("/w/base.mp4", "/w/voice.wav", "/weights", "/w/results")
        self.assertEqual(args[:2], ["python", "inference.py"])
        self.assertIn("--motion-from-latents", args)
        flags = [arg for arg in args[2:] if arg != "--motion-from-latents"]
        pairs = dict(zip(flags[::2], flags[1::2]))
        self.assertEqual(pairs["--video"], "/w/base.mp4")
        self.assertEqual(pairs["--audio"], "/w/voice.wav")
        self.assertEqual(pairs["--checkpoint-dir"], "/weights")
        self.assertEqual(pairs["--inference-mode"], "student")
        self.assertEqual(pairs["--num-student-steps"], "2")
        self.assertEqual(pairs["--sample-name"], "clip")
        self.assertEqual(job.tbdub_output_path("/w/results"), "/w/results/clip_tbdub.mp4")


class CostTests(unittest.TestCase):
    def test_usd_for_seconds_uses_the_gpu_rate(self):
        self.assertAlmostEqual(job.usd_for_seconds(100.0, "L4"), 100.0 * 0.000222)
        self.assertAlmostEqual(job.usd_for_seconds(100.0, "L40S"), 100.0 * 0.000542)

    def test_unknown_gpu_and_negative_seconds_raise(self):
        with self.assertRaisesRegex(ValueError, "no Modal rate"):
            job.usd_for_seconds(1.0, "H100")
        with self.assertRaisesRegex(ValueError, "must not be negative"):
            job.usd_for_seconds(-1.0, "L4")

    def test_reference_video_scales_the_render_to_60_seconds(self):
        self.assertAlmostEqual(
            job.usd_per_reference_video(30.0, 15.0, "L4"),
            job.usd_for_seconds(120.0, "L4"),
        )

    def test_reference_video_needs_positive_audio(self):
        with self.assertRaisesRegex(ValueError, "must be positive"):
            job.usd_per_reference_video(30.0, 0.0, "L4")

    def test_every_tier_gpu_has_a_rate(self):
        self.assertEqual(job.TIER_GPUS, {"very_cheap": "L4", "cheap": "L40S"})
        for gpu in job.TIER_GPUS.values():
            self.assertIn(gpu, job.GPU_RATES_USD_S)


class RenderClipTests(unittest.TestCase):
    def test_runs_audio_base_clip_then_model_and_reports_cost(self):
        runner = FakeRunner(duration="15.0")
        seen: list[tuple[str, str]] = []

        def model(work: str, base_clip: str, audio_path: str, run: object) -> Path:
            seen.append((Path(base_clip).name, Path(audio_path).name))
            output = Path(work) / "out.mp4"
            output.write_bytes(b"lipsync")
            return output

        result = job.render_clip("cheap", b"png", b"mp3", model, run=runner)

        self.assertEqual(result["video"], b"lipsync")
        self.assertEqual(result["tier"], "cheap")
        self.assertEqual(result["gpu"], "L40S")
        self.assertEqual(result["audio_seconds"], 15.0)
        self.assertEqual(seen, [("base.mp4", "voice.wav")])
        self.assertEqual([call[0] for call in runner.calls], ["ffmpeg", "ffprobe", "ffmpeg"])
        self.assertIn("-loop", runner.calls[2])
        total = result["total_s"]
        self.assertIsInstance(total, float)
        self.assertEqual(result["cost_usd"], round(job.usd_for_seconds(total, "L40S"), 4))
        self.assertEqual(
            result["usd_per_60s_video"],
            round(job.usd_per_reference_video(total, 15.0, "L40S"), 4),
        )

    def test_a_model_that_writes_nothing_raises(self):
        def model(work: str, base_clip: str, audio_path: str, run: object) -> Path:
            return Path(work) / "missing.mp4"

        with self.assertRaisesRegex(RuntimeError, "very_cheap renderer produced no video"):
            job.render_clip("very_cheap", b"png", b"mp3", model, run=FakeRunner())

    def test_unknown_tier_raises_before_any_work(self):
        runner = FakeRunner()
        with self.assertRaises(KeyError):
            job.render_clip("free", b"png", b"mp3", lambda *args: Path("x"), run=runner)
        self.assertEqual(runner.calls, [])


class RunCheckedTests(unittest.TestCase):
    def test_returns_output_on_success(self):
        result = job.run_checked(["python3", "-c", "print('ok')"])
        self.assertEqual(result.stdout.strip(), "ok")

    def test_raises_with_the_output_tail_on_failure(self):
        with self.assertRaisesRegex(RuntimeError, "python3 failed: boom"):
            job.run_checked(["python3", "-c", "import sys; sys.stderr.write('boom'); sys.exit(3)"])


class SaveBenchRunTests(unittest.TestCase):
    def test_writes_the_video_and_returns_the_rest(self):
        with tempfile.TemporaryDirectory() as out:
            summary = job.save_bench_run(
                {"video": b"mp4", "tier": "cheap", "cost_usd": 0.1}, Path(out) / "bench", 2
            )
            self.assertEqual(summary, {"tier": "cheap", "cost_usd": 0.1})
            self.assertEqual((Path(out) / "bench" / "cheap-2.mp4").read_bytes(), b"mp4")

    def test_a_run_without_video_raises(self):
        with tempfile.TemporaryDirectory() as out:
            with self.assertRaisesRegex(RuntimeError, "returned no video"):
                job.save_bench_run({"tier": "cheap"}, Path(out), 1)


class ModalWiringTests(unittest.TestCase):
    APPS = {
        "modal_musetalk.py": ("MUSETALK_REPO_COMMIT", "gpu=MUSETALK_GPU,", '"very_cheap"'),
        "modal_tbdub.py": ("TBDUB_REPO_COMMIT", "gpu=TBDUB_GPU,", '"cheap"'),
    }

    def test_each_app_pins_upstream_runs_its_tier_gpu_and_ships_the_job_module(self):
        for name, (commit, gpu, tier) in self.APPS.items():
            with self.subTest(app=name):
                source = _source(name)
                self.assertRegex(source, commit + r' = "[0-9a-f]{40}"')
                self.assertIn(gpu, source)
                self.assertIn(f"render_clip({tier}", source)
                self.assertIn('"/root/modal_lipsync_job.py"', source)

    def test_musetalk_relative_model_paths_resolve_to_the_weights_volume(self):
        self.assertIn("ln -s {WEIGHTS_DIR} {CHECKOUT_DIR}/models", _source("modal_musetalk.py"))

    def test_tbdub_face_landmarker_is_checked_against_upstream_sha256(self):
        source = _source("modal_tbdub.py")
        self.assertIn(
            'FACE_LANDMARKER_SHA256 = "64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff"',
            source,
        )
        self.assertIn("if digest != FACE_LANDMARKER_SHA256:", source)

    def test_every_binary_the_app_shells_out_to_is_installed_in_its_image(self):
        for name in ("modal_musetalk.py", "modal_tbdub.py"):
            with self.subTest(app=name):
                source = _source(name)
                missing = _shelled_binaries(source) - _installed_binaries(source)
                self.assertEqual(missing, set())


if __name__ == "__main__":
    unittest.main()
