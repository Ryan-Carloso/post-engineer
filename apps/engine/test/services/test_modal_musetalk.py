"""Tests for the MuseTalk cheap-tier helpers and their Modal wiring."""

import math
import unittest
from pathlib import Path

import modal_musetalk_job as job

ENGINE_DIR = Path(__file__).resolve().parents[2]


def _app_source() -> str:
    return (ENGINE_DIR / "modal_musetalk.py").read_text()


class BaseClipArgsTests(unittest.TestCase):
    def test_renders_a_looping_25fps_clip_of_the_configured_length(self):
        args = job.base_clip_args("in.png", "out.mp4")
        self.assertEqual(args[:5], ["ffmpeg", "-y", "-loop", "1", "-i"])
        self.assertEqual(args[5], "in.png")
        self.assertEqual(args[-1], "out.mp4")
        frames_index = args.index("-frames:v")
        self.assertEqual(args[frames_index + 1], str(job.BASE_CLIP_SECONDS * job.MUSETALK_FPS))

    def test_zoom_is_a_full_cosine_cycle_so_the_clip_loops(self):
        video_filter = job.base_clip_args("in.png", "out.mp4")[7]
        frames = job.BASE_CLIP_SECONDS * job.MUSETALK_FPS
        self.assertIn(f"1+{job.ZOOM_AMPLITUDE / 2}*(1-cos(2*PI*on/{frames}))", video_filter)
        self.assertIn(f"fps={job.MUSETALK_FPS}", video_filter)
        self.assertIn(f"s={job.BASE_CLIP_SIZE}x{job.BASE_CLIP_SIZE}", video_filter)

    def test_zoom_starts_and_ends_at_one(self):
        frames = job.BASE_CLIP_SECONDS * job.MUSETALK_FPS
        for on in (0, frames):
            zoom = 1 + job.ZOOM_AMPLITUDE / 2 * (1 - math.cos(2 * math.pi * on / frames))
            self.assertAlmostEqual(zoom, 1.0)


class InferenceTests(unittest.TestCase):
    def test_config_names_one_task_with_the_inputs_and_output(self):
        text = job.inference_config_yaml("/w/base.mp4", "/w/voice.wav")
        self.assertEqual(
            text,
            'task_0:\n  video_path: "/w/base.mp4"\n  audio_path: "/w/voice.wav"\n'
            '  result_name: "result.mp4"\n',
        )

    def test_args_use_musetalk_15_in_fp16_at_the_training_fps(self):
        args = job.inference_args("/w/task.yaml", "/w/results")
        self.assertEqual(args[:3], ["python", "-m", "scripts.inference"])
        pairs = dict(zip(args[3::2], args[4::2]))
        self.assertEqual(pairs["--inference_config"], "/w/task.yaml")
        self.assertEqual(pairs["--result_dir"], "/w/results")
        self.assertEqual(pairs["--version"], "v15")
        self.assertEqual(pairs["--unet_model_path"], "models/musetalkV15/unet.pth")
        self.assertEqual(pairs["--fps"], "25")
        self.assertEqual(args[-1], "--use_float16")

    def test_output_path_is_where_upstream_writes_v15_results(self):
        self.assertEqual(job.output_path("/w/results"), "/w/results/v15/result.mp4")


class CostTests(unittest.TestCase):
    def test_usd_for_seconds_uses_the_gpu_rate(self):
        self.assertAlmostEqual(job.usd_for_seconds(100.0), 100.0 * job.GPU_RATES_USD_S["L4"])
        self.assertAlmostEqual(job.usd_for_seconds(10.0, "T4"), 10.0 * job.GPU_RATES_USD_S["T4"])

    def test_unknown_gpu_and_negative_seconds_raise(self):
        with self.assertRaisesRegex(ValueError, "no Modal rate"):
            job.usd_for_seconds(1.0, "H100")
        with self.assertRaisesRegex(ValueError, "must not be negative"):
            job.usd_for_seconds(-1.0)

    def test_reference_video_scales_the_measured_render_to_60_seconds(self):
        self.assertAlmostEqual(
            job.usd_per_reference_video(30.0, 15.0),
            job.usd_for_seconds(120.0),
        )

    def test_reference_video_needs_positive_audio(self):
        with self.assertRaisesRegex(ValueError, "must be positive"):
            job.usd_per_reference_video(30.0, 0.0)

    def test_default_gpu_has_a_rate(self):
        self.assertIn(job.GPU, job.GPU_RATES_USD_S)


class ModalWiringTests(unittest.TestCase):
    def test_checkout_is_pinned_to_a_commit(self):
        self.assertRegex(_app_source(), r'MUSETALK_REPO_COMMIT = "[0-9a-f]{40}"')

    def test_render_runs_on_the_job_gpu(self):
        self.assertIn("gpu=GPU,", _app_source())

    def test_image_ships_the_job_module(self):
        self.assertIn('"/root/modal_musetalk_job.py"', _app_source())

    def test_upstream_relative_model_paths_resolve_to_the_weights_volume(self):
        self.assertIn('ln -s {WEIGHTS_DIR} {CHECKOUT_DIR}/models', _app_source())

    def test_a_missing_result_raises_instead_of_returning_nothing(self):
        self.assertIn('raise RuntimeError(\n                "MuseTalk produced no video', _app_source())


if __name__ == "__main__":
    unittest.main()
