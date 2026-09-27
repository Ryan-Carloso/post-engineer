import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from scripts.infinitetalk_bench import (  # noqa: E402
    default_experiment_cases,
    experiment_output_dir,
    experiment_description,
    frames_for_duration,
    format_elapsed,
    progress_bar,
    status_progress,
)


class TestInfiniteTalkBenchmark(unittest.TestCase):
    def test_progress_helpers_render_readable_elapsed_and_bar(self):
        self.assertEqual(format_elapsed(3661.5), "01:01:01")
        self.assertEqual(progress_bar(50), "[##########----------] 50%")

    def test_status_progress_marks_failed_jobs_as_complete(self):
        self.assertEqual(status_progress({"status": "queued"}), 0)
        self.assertEqual(status_progress({"status": "failed"}), 100)

    def test_experiment_description_uses_requested_frame_count(self):
        description = experiment_description(8, 0.4, 89)

        self.assertIn("89 frames", description["comparison"])
        self.assertIn("3.56s", description["comparison"])

    def test_frames_are_calculated_from_audio_duration_with_safety_margin(self):
        self.assertEqual(frames_for_duration(3.72), 89)
        self.assertEqual(frames_for_duration(10.0), 245)

    def test_default_suite_contains_named_480p_and_720p_cases(self):
        cases = default_experiment_cases()

        self.assertEqual(
            [
                (case.name, case.sample_steps, case.teacache_thresh, case.size)
                for case in cases
            ],
            [
                ("480p_fast_steps8_tc04", 8, 0.4, "infinitetalk-480"),
                ("480p_balanced_steps10_tc04", 10, 0.4, "infinitetalk-480"),
                ("720p_baseline_steps12_tc03", 12, 0.3, "infinitetalk-720"),
                ("720p_fast_steps8_tc04", 8, 0.4, "infinitetalk-720"),
                ("720p_balanced_steps10_tc04", 10, 0.4, "infinitetalk-720"),
            ],
        )

    def test_each_case_has_an_isolated_named_output_directory(self):
        root = Path("bench/infinitetalk/experiments")
        cases = default_experiment_cases()

        self.assertEqual(
            [experiment_output_dir(root, case) for case in cases],
            [
                root / "480p_fast_steps8_tc04",
                root / "480p_balanced_steps10_tc04",
                root / "720p_baseline_steps12_tc03",
                root / "720p_fast_steps8_tc04",
                root / "720p_balanced_steps10_tc04",
            ],
        )


if __name__ == "__main__":
    unittest.main()
