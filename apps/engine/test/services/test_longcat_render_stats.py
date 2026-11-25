"""Tests for the render telemetry forwarded with each LongCat ai_request."""

import unittest

from app.services.longcat_render_stats import render_stats_props

DONE_STATUS: dict[str, object] = {
    "status": "done",
    "resolution": "480p",
    "num_segments": 4,
    "gpu": "H100",
    "accel": "bf16+merge_lora",
    "cost_usd": 0.6,
    "timings": {
        "inference_s": 500.0,
        "normalize_s": 12.5,
        "audio_embed_s": 2.0,
        "encode_s": 4.0,
        "peak_vram_gb": 61.2,
        "segment_s": [140.0, 120.0, 118.0, 116.0],
        "container_uptime_s": 900.0,
    },
}


class RenderStatsPropsTests(unittest.TestCase):
    def test_full_done_status_maps_every_field(self):
        self.assertEqual(
            render_stats_props(DONE_STATUS),
            {
                "resolution": "480p",
                "gpu": "H100",
                "accel": "bf16+merge_lora",
                "num_segments": 4,
                "inference_s": 500.0,
                "normalize_s": 12.5,
                "audio_embed_s": 2.0,
                "encode_s": 4.0,
                "peak_vram_gb": 61.2,
                "segment_s_avg": 123.5,
                "segment_s_max": 140.0,
                "continuation_segment_s_avg": 118.0,
                "cost_per_segment_usd": 0.15,
            },
        )

    def test_older_deployment_without_stats_yields_nothing(self):
        self.assertEqual(render_stats_props({"status": "done", "cost_usd": 0.5}), {})

    def test_single_segment_has_no_continuation_average(self):
        status = {"num_segments": 1, "timings": {"segment_s": [90.0]}}
        props = render_stats_props(status)
        self.assertEqual(props["segment_s_avg"], 90.0)
        self.assertNotIn("continuation_segment_s_avg", props)

    def test_bad_numbers_are_dropped_not_zeroed(self):
        status = {
            "timings": {
                "inference_s": True,
                "normalize_s": float("nan"),
                "encode_s": -1.0,
                "audio_embed_s": "2",
                "peak_vram_gb": float("inf"),
            }
        }
        self.assertEqual(render_stats_props(status), {})

    def test_segment_list_with_one_bad_entry_is_dropped_whole(self):
        status = {"timings": {"segment_s": [10.0, "x", 12.0]}}
        self.assertEqual(render_stats_props(status), {})

    def test_empty_or_non_list_segments_are_dropped(self):
        for value in ([], "10,12", None, {"0": 1.0}):
            with self.subTest(value=value):
                self.assertEqual(render_stats_props({"timings": {"segment_s": value}}), {})

    def test_labels_that_are_not_short_plain_tokens_are_dropped(self):
        status = {
            "resolution": "480p; rm -rf /",
            "gpu": "x" * 65,
            "accel": 7,
        }
        self.assertEqual(render_stats_props(status), {})

    def test_invalid_segment_counts_are_dropped_and_skip_the_per_segment_cost(self):
        for value in (0, -2, True, 2.0, "4"):
            with self.subTest(value=value):
                props = render_stats_props({"num_segments": value, "cost_usd": 0.4})
                self.assertEqual(props, {})

    def test_cost_per_segment_needs_a_valid_cost(self):
        props = render_stats_props({"num_segments": 2, "cost_usd": float("nan")})
        self.assertEqual(props, {"num_segments": 2})

    def test_timings_that_are_not_a_dict_are_ignored(self):
        self.assertEqual(render_stats_props({"timings": [1, 2]}), {})


if __name__ == "__main__":
    unittest.main()
