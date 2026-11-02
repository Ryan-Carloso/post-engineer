"""Direct unit tests for the full lip-sync module (mutmut attribution).

Covers window planning, cost arithmetic, the concat command, and the
render orchestration with fake LongCat/ffmpeg functions, so no GPU, audio
file, or network is ever needed here.
"""

import re
import unittest
from pathlib import Path
from unittest.mock import MagicMock

from app.models.schema import LipSyncQuality, PersonaParams, VideoParams
from app.services import full_lipsync
from app.services.full_lipsync import FullLipSyncError


def _params() -> VideoParams:
    return VideoParams(
        video_subject="Porto food",
        video_script="Hook. Body text here. Call to action.",
        persona=PersonaParams(
            name="Ana",
            photo_url="https://example.com/photo.png",
            voice_id="calm",
        ),
        video_quality=LipSyncQuality.ok,
        full_lipsync=True,
    )


class PlanWindowsTests(unittest.TestCase):
    def test_even_split_without_cues(self):
        windows = full_lipsync.plan_windows(30.0, ())
        self.assertEqual(windows, [(0.0, 12.0), (12.0, 12.0), (24.0, 6.0)])

    def test_cue_aligned_split(self):
        windows = full_lipsync.plan_windows(30.0, [5.0, 11.0, 20.0, 27.0])
        self.assertEqual(windows, [(0.0, 11.0), (11.0, 9.0), (20.0, 10.0)])

    def test_short_audio_is_one_window(self):
        self.assertEqual(full_lipsync.plan_windows(8.0, ()), [(0.0, 8.0)])

    def test_rejects_zero_and_negative_audio(self):
        for bad in (0.0, -5.0):
            with self.assertRaises(FullLipSyncError):
                full_lipsync.plan_windows(bad, ())

    def test_rejects_audio_over_the_ceiling(self):
        for over in (60.01, 61.0, 144.0):
            with self.assertRaises(FullLipSyncError):
                full_lipsync.plan_windows(over, ())

    def test_exactly_60s_is_five_windows(self):
        self.assertEqual(
            full_lipsync.plan_windows(60.0, ()),
            [(0.0, 12.0), (12.0, 12.0), (24.0, 12.0), (36.0, 12.0), (48.0, 12.0)],
        )
        self.assertEqual(full_lipsync.MAX_FULL_LIPSYNC_SECONDS, 60.0)
        self.assertEqual(full_lipsync.MAX_FULL_LIPSYNC_WINDOWS, 5)

    def test_short_tail_merges_backwards(self):
        # 25s with a cue at 24s would leave a 1s tail; it merges instead.
        windows = full_lipsync.plan_windows(25.0, [12.0, 24.0])
        self.assertAlmostEqual(windows[-1][1], 3.72)
        self.assertAlmostEqual(sum(duration for _start, duration in windows), 25.0)

    def test_window_cap_matches_task_ceiling(self):
        # task.py PERSONA_LIPSYNC_MAX_SECONDS is the observed-safe ceiling;
        # this module must not silently drift to the 16.52s theoretical one.
        task_source = (
            Path(__file__).resolve().parents[2] / "app" / "services" / "task.py"
        ).read_text()
        match = re.search(r"PERSONA_LIPSYNC_MAX_SECONDS\s*=\s*([0-9.]+)", task_source)
        self.assertIsNotNone(match)
        assert match is not None
        self.assertEqual(full_lipsync.FULL_LIPSYNC_MAX_WINDOW_SECONDS, float(match.group(1)))


class CueStartsTests(unittest.TestCase):
    def test_parses_srt_timings(self):
        subtitles = [
            (1, "00:00:00,000 --> 00:00:04,000", "Hello"),
            (2, "00:00:04,000 --> 00:00:09,500", "World"),
        ]
        self.assertEqual(full_lipsync.cue_starts_from_subtitles(subtitles), [4.0])


class CostTests(unittest.TestCase):
    def test_estimate_is_windows_times_per_window(self):
        self.assertAlmostEqual(full_lipsync.estimate_cost_usd(4, 0.65), 2.60)

    def test_estimate_is_none_without_per_window_cost(self):
        self.assertIsNone(full_lipsync.estimate_cost_usd(4, None))

    def test_total_is_none_when_any_window_hid_its_cost(self):
        self.assertIsNone(full_lipsync.total_cost_usd([0.6, None, 0.7]))
        self.assertAlmostEqual(full_lipsync.total_cost_usd([0.6, 0.7]), 1.30)

    def test_estimate_windows_counts_even_split(self):
        self.assertEqual(full_lipsync.estimate_windows(30.0), 3)
        self.assertEqual(full_lipsync.estimate_windows(56.0), 5)


class ConcatCommandTests(unittest.TestCase):
    def test_trims_each_clip_and_drops_audio(self):
        command = full_lipsync.build_concat_command(["a.mp4", "b.mp4"], [12.0, 6.0], "out.mp4")
        joined = " ".join(command)
        self.assertIn("trim=duration=12", joined)
        self.assertIn("trim=duration=6", joined)
        self.assertIn("concat=n=2", joined)
        self.assertIn("-an", command)

    def test_rejects_mismatched_clips_and_durations(self):
        with self.assertRaises(FullLipSyncError):
            full_lipsync.build_concat_command(["a.mp4"], [1.0, 2.0], "o.mp4")
        with self.assertRaises(FullLipSyncError):
            full_lipsync.build_concat_command([], [], "o.mp4")


class RenderTests(unittest.TestCase):
    def _fake_generate(self, calls):
        def fake(image_path, audio_path, quality, output_path, duration_seconds):
            calls.append(duration_seconds)
            Path(output_path).parent.mkdir(parents=True, exist_ok=True)
            Path(output_path).write_bytes(b"clip")
            return output_path, 0.65, f"job-{len(calls)}"

        return fake

    def test_renders_every_window_and_sums_cost(self):
        calls: list[float] = []
        ran: list[list[str]] = []

        def fake_ffmpeg(argv):
            ran.append(argv)
            return MagicMock(returncode=0, stderr="")

        output, cost, jobs = full_lipsync.render_full_lipsync(
            task_id="t1",
            params=_params(),
            image_path="/tmp/photo.png",
            audio_file="/tmp/audio.mp3",
            audio_seconds=30.0,
            subtitles=[],
            output_path="/tmp/full.mp4",
            generate_intro=self._fake_generate(calls),
            trim_audio=lambda *args, **kwargs: None,
            run_ffmpeg=fake_ffmpeg,
        )
        self.assertEqual(output, "/tmp/full.mp4")
        self.assertEqual(calls, [12.0, 12.0, 6.0])
        self.assertAlmostEqual(cost, 1.95)
        self.assertEqual(jobs, ["job-1", "job-2", "job-3"])
        self.assertEqual(len(ran), 1)

    def test_over_60s_render_fails_before_any_window(self):
        calls: list[float] = []
        with self.assertRaises(FullLipSyncError):
            full_lipsync.render_full_lipsync(
                task_id="t1",
                params=_params(),
                image_path="/tmp/photo.png",
                audio_file="/tmp/audio.mp3",
                audio_seconds=61.0,
                subtitles=[],
                output_path="/tmp/full.mp4",
                generate_intro=self._fake_generate(calls),
                trim_audio=lambda *args, **kwargs: None,
                run_ffmpeg=lambda argv: MagicMock(returncode=0, stderr=""),
            )
        self.assertEqual(calls, [])

    def test_window_failure_propagates_never_degrades(self):
        def failing(*args, **kwargs):
            raise RuntimeError("Modal down")

        with self.assertRaises(RuntimeError):
            full_lipsync.render_full_lipsync(
                task_id="t1",
                params=_params(),
                image_path="/tmp/photo.png",
                audio_file="/tmp/audio.mp3",
                audio_seconds=10.0,
                subtitles=[],
                output_path="/tmp/full.mp4",
                generate_intro=failing,
                trim_audio=lambda *args, **kwargs: None,
                run_ffmpeg=lambda argv: MagicMock(returncode=0, stderr=""),
            )

    def test_requires_persona(self):
        params = _params()
        params.persona = None
        with self.assertRaises(FullLipSyncError):
            full_lipsync.render_full_lipsync(
                task_id="t1",
                params=params,
                image_path="/tmp/photo.png",
                audio_file="/tmp/audio.mp3",
                audio_seconds=10.0,
                subtitles=[],
                output_path="/tmp/full.mp4",
                generate_intro=lambda *a, **k: ("o", 0.5, "j"),
                trim_audio=lambda *a, **k: None,
                run_ffmpeg=lambda argv: MagicMock(returncode=0, stderr=""),
            )


if __name__ == "__main__":
    unittest.main()
