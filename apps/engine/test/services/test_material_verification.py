"""Tests for verified stock material selection in broll mode.

The production scorer is pluggable via an option, not a test-only seam:
callers pass a scorer callable, and the default scorer is the lazy ONNX
scorer in material_verification. Tests inject a stub scorer that returns
fixed similarity scores per candidate URL, so no test calls a stock API,
an SVG catalog, or a real model.

Similarity scores are relative, never probabilities: the threshold and
runner-up margin are pinned by tests, and a candidate is verified stock
only when it clears both. A segment without verified stock is dropped:
broll mode is stock only, so nothing (no catalog SVG, no neutral clip,
no rejected clip) takes its place.
"""

import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from app.config import config
from app.models.schema import MaterialInfo, VideoAspect
from app.services import material, material_verification
from app.services.material_verification import (
    OnnxClipScorer,
    SegmentDecision,
    VerificationConfig,
    VerificationUnavailable,
    apply_verification,
    emit_material_fallback_summary,
    render_neutral_clip,
    render_neutral_png,
    select_for_segment,
    summarize_decisions,
    verification_config,
)


def _candidate(url, provider="pexels", duration=8):
    item = MaterialInfo()
    item.provider = provider
    item.url = url
    item.duration = duration
    return item


class TestVerificationConfig(unittest.TestCase):
    def setUp(self):
        self.original = dict(config.app)

    def tearDown(self):
        config.app.clear()
        config.app.update(self.original)

    def test_defaults_are_pinned(self):
        cfg = verification_config()
        self.assertEqual(cfg.min_score, 0.01)
        self.assertEqual(cfg.runner_up_margin, 0.005)

    def test_config_values_override_defaults(self):
        config.app["material_verification_min_score"] = 0.40
        config.app["material_verification_runner_up_margin"] = 0.10
        cfg = verification_config()
        self.assertEqual(cfg.min_score, 0.40)
        self.assertEqual(cfg.runner_up_margin, 0.10)

    def test_invalid_config_values_fall_back_to_defaults(self):
        config.app["material_verification_min_score"] = "not-a-number"
        cfg = verification_config()
        self.assertEqual(cfg.min_score, 0.01)


class TestSelectForSegment(unittest.TestCase):
    def setUp(self):
        self.cfg = VerificationConfig(
            enabled=True, min_score=0.33, runner_up_margin=0.05
        )

    def test_verified_stock_passes(self):
        decision = select_for_segment(
            phrase="Waterfront in the city",
            candidates=[
                _candidate("https://example.com/verified.mp4"),
                _candidate("https://example.com/other.mp4"),
            ],
            scorer=lambda url, phrase: (
                0.42 if "verified" in url else 0.20
            ),
            config=self.cfg,
        )
        self.assertEqual(decision.tier, "stock_verified")
        self.assertEqual(
            decision.stock_url, "https://example.com/verified.mp4"
        )
        self.assertIsNone(decision.drop_reason)

    def test_failing_stock_drops_the_segment(self):
        decision = select_for_segment(
            phrase="A dish on a table",
            candidates=[_candidate("https://example.com/low.mp4")],
            scorer=lambda url, phrase: 0.18,
            config=self.cfg,
        )
        self.assertEqual(decision.tier, "dropped")
        self.assertIsNone(decision.stock_url)
        self.assertEqual(decision.drop_reason, "score_below_threshold")

    def test_ambiguous_candidate_drops_the_segment(self):
        decision = select_for_segment(
            phrase="Waterfront in the city",
            candidates=[
                _candidate("https://example.com/top.mp4"),
                _candidate("https://example.com/runner-up.mp4"),
            ],
            scorer=lambda url, phrase: 0.40 if "top" in url else 0.38,
            config=self.cfg,
        )
        self.assertEqual(decision.tier, "dropped")
        self.assertEqual(decision.drop_reason, "runner_up_margin_too_small")

    def test_missing_footage_drops_the_segment(self):
        decision = select_for_segment(
            phrase="Waterfront in the city",
            candidates=[],
            scorer=lambda url, phrase: 0.42,
            config=self.cfg,
        )
        self.assertEqual(decision.tier, "dropped")
        self.assertEqual(decision.drop_reason, "no_candidates")

    def test_svg_candidates_are_not_scored_as_stock(self):
        seen = []

        def recording_scorer(url, phrase):
            seen.append(url)
            return 0.18

        decision = select_for_segment(
            phrase="A dish on a table",
            candidates=[
                _candidate("catalog/traveler.svg", provider="svg"),
                _candidate("https://example.com/low.mp4"),
            ],
            scorer=recording_scorer,
            config=self.cfg,
        )
        self.assertEqual(seen, ["https://example.com/low.mp4"])
        self.assertEqual(decision.tier, "dropped")

    def test_unavailable_scorer_never_passes_stock(self):
        def failing_scorer(url, phrase):
            raise VerificationUnavailable("onnxruntime is not installed")

        decision = select_for_segment(
            phrase="Waterfront in the city",
            candidates=[_candidate("https://example.com/verified.mp4")],
            scorer=failing_scorer,
            config=self.cfg,
        )
        self.assertEqual(decision.tier, "dropped")
        self.assertEqual(decision.drop_reason, "scorer_unavailable")

    def test_default_onnx_scorer_raises_without_dependency(self):
        scorer = OnnxClipScorer()
        with self.assertRaises(VerificationUnavailable):
            scorer.score("https://example.com/video.mp4", "Waterfront")


class TestNeutralPng(unittest.TestCase):
    def test_neutral_png_is_an_image_with_no_text_or_subject(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            path = render_neutral_png(tmp)
            self.assertTrue(os.path.isfile(path))
            with open(path, "rb") as handle:
                header = handle.read(8)
            self.assertEqual(header, b"\x89PNG\r\n\x1a\n")

    def test_neutral_png_filename_carries_aspect(self):
        import tempfile

        from PIL import Image

        with tempfile.TemporaryDirectory() as tmp:
            portrait_path = render_neutral_png(tmp, VideoAspect.portrait)
            landscape_path = render_neutral_png(tmp, VideoAspect.landscape)
            self.assertNotEqual(portrait_path, landscape_path)
            self.assertTrue(
                portrait_path.endswith("neutral-background-1080x1920.png")
            )
            self.assertTrue(
                landscape_path.endswith("neutral-background-1920x1080.png")
            )
            with Image.open(portrait_path) as image:
                self.assertEqual(image.size, VideoAspect.portrait.to_resolution())
            with Image.open(landscape_path) as image:
                self.assertEqual(image.size, VideoAspect.landscape.to_resolution())

    def test_neutral_png_accepts_string_aspect(self):
        import tempfile

        from PIL import Image

        with tempfile.TemporaryDirectory() as tmp:
            # VideoParams defaults video_aspect to the unvalidated string
            # "9:16" (pydantic does not validate defaults); the renderer
            # must coerce it instead of crashing on .to_resolution().
            path = render_neutral_png(tmp, "9:16")
            self.assertTrue(os.path.isfile(path))
            with Image.open(path) as image:
                self.assertEqual(image.size, VideoAspect.portrait.to_resolution())

    def test_neutral_png_save_dir_never_contains_colon(self):
        import tempfile

        from app.services.neutral_background import _colon_free_dir

        self.assertEqual(_colon_free_dir("16:9"), "1920x1080")
        self.assertEqual(_colon_free_dir("1:1"), "1080x1080")
        self.assertEqual(_colon_free_dir("9:16"), "1080x1920")
        with tempfile.TemporaryDirectory() as tmp:
            dirty = os.path.join(tmp, "16:9")
            path = render_neutral_png(dirty, VideoAspect.landscape)
            self.assertNotIn(":", path)
            self.assertTrue(path.endswith("neutral-background-1920x1080.png"))
            self.assertTrue(os.path.isfile(path))
            self.assertEqual(
                os.path.dirname(path), os.path.join(tmp, "16x9")
            )

    def test_neutral_png_matches_video_aspect_resolution(self):
        import tempfile

        from PIL import Image

        for aspect in (VideoAspect.landscape, VideoAspect.square):
            with tempfile.TemporaryDirectory() as tmp:
                path = render_neutral_png(tmp, aspect)
                with Image.open(path) as image:
                    self.assertEqual(image.size, aspect.to_resolution())

    def test_neutral_clip_png_matches_landscape_and_square(self):
        import tempfile

        from PIL import Image

        captured = {}

        def fake_render(png_path, clip_duration):
            captured["size"] = Image.open(png_path).size
            captured["duration"] = clip_duration
            return png_path.replace(".png", ".mp4")

        for aspect in (VideoAspect.landscape, VideoAspect.square):
            captured.clear()
            with tempfile.TemporaryDirectory() as tmp:
                with patch(
                    "app.services.image_material.render_image_file_to_mp4",
                    side_effect=fake_render,
                ):
                    clip = render_neutral_clip(tmp, 4, aspect)
            self.assertTrue(clip.endswith(".mp4"))
            self.assertEqual(captured["size"], aspect.to_resolution())



class TestFallbackSummary(unittest.TestCase):
    def test_summary_counts_per_tier(self):
        decisions = [
            SegmentDecision(tier="stock_verified", phrase="a"),
            SegmentDecision(tier="dropped", phrase="b"),
            SegmentDecision(tier="dropped", phrase="c"),
        ]
        summary = summarize_decisions(decisions)
        self.assertEqual(
            summary, {"stock_verified": 1, "stock_unverified": 0, "dropped": 2}
        )

    def test_summary_event_carries_counts_and_task_id_only(self):
        decisions = [SegmentDecision(tier="dropped", phrase="Waterfront")]
        with patch(
            "app.services.material_verification.track_event"
        ) as track_event:
            emit_material_fallback_summary("task-123", decisions)
        track_event.assert_called_once()
        args, _kwargs = track_event.call_args
        self.assertEqual(args[0], "material_fallback_summary")
        properties = args[1]
        self.assertEqual(properties["task_id"], "task-123")
        self.assertEqual(properties["dropped"], 1)
        self.assertEqual(properties["stock_verified"], 0)
        # No free text, no phrases, no URLs, no paths in the event.
        for value in properties.values():
            self.assertNotIn("Waterfront", str(value))
            self.assertNotIn("http", str(value))
            self.assertNotIn("/", str(value) if isinstance(value, str) else "")

    def test_summary_event_carries_user_id_when_known(self):
        decisions = [SegmentDecision(tier="dropped", phrase="Waterfront")]
        with (
            patch(
                "app.services.material_verification.sm.state.get_task",
                return_value={"user_id": "user-123"},
            ),
            patch(
                "app.services.material_verification.track_event"
            ) as track_event,
        ):
            emit_material_fallback_summary("task-123", decisions)
        properties = track_event.call_args[0][1]
        self.assertEqual(properties["user_id"], "user-123")

    def test_summary_event_omits_user_id_by_default(self):
        decisions = [SegmentDecision(tier="dropped", phrase="Waterfront")]
        with (
            patch(
                "app.services.material_verification.sm.state.get_task",
                return_value={},
            ),
            patch(
                "app.services.material_verification.track_event"
            ) as track_event,
        ):
            emit_material_fallback_summary("task-123", decisions)
        self.assertNotIn("user_id", track_event.call_args[0][1])

    def test_summary_event_omits_unknown_or_non_string_user_id(self):
        decisions = [SegmentDecision(tier="dropped", phrase="Waterfront")]
        for row in ({"user_id": "unknown"}, {"user_id": 123}, {"user_id": None}):
            with (
                patch(
                    "app.services.material_verification.sm.state.get_task",
                    return_value=row,
                ),
                patch(
                    "app.services.material_verification.track_event"
                ) as track_event,
            ):
                emit_material_fallback_summary("task-123", decisions)
            self.assertNotIn("user_id", track_event.call_args[0][1])

    def test_summary_event_degrades_when_state_unreadable(self):
        decisions = [SegmentDecision(tier="dropped", phrase="Waterfront")]
        with (
            patch(
                "app.services.material_verification.sm.state.get_task",
                side_effect=RuntimeError("state down"),
            ),
            patch(
                "app.services.material_verification.track_event"
            ) as track_event,
        ):
            emit_material_fallback_summary("task-123", decisions)
        self.assertNotIn("user_id", track_event.call_args[0][1])


class TestApplyVerification(unittest.TestCase):
    def setUp(self):
        self.cfg = VerificationConfig(
            enabled=True, min_score=0.33, runner_up_margin=0.05
        )

    def test_apply_verification_keeps_verified_and_drops_the_rest(self):
        groups = [
            (
                "Waterfront in the city",
                [
                    _candidate("https://example.com/verified.mp4"),
                    _candidate("https://example.com/other.mp4"),
                ],
            ),
            ("A dish on a table", [_candidate("https://example.com/low.mp4")]),
            ("A quiet afternoon", []),
        ]
        items, decisions = apply_verification(
            groups,
            scorer=lambda url, phrase: (
                0.42 if "verified" in url else 0.18
            ),
            config=self.cfg,
        )
        self.assertEqual(
            [d.tier for d in decisions], ["stock_verified", "dropped", "dropped"]
        )
        self.assertEqual(
            [(i.provider, i.url) for i in items],
            [("pexels", "https://example.com/verified.mp4")],
        )

    def test_apply_verification_disabled_returns_candidates_unchanged(self):
        groups = [("Waterfront", [_candidate("https://example.com/x.mp4")])]
        items, decisions = apply_verification(
            groups,
            scorer=lambda url, phrase: 0.18,
            config=VerificationConfig(enabled=False),
        )
        self.assertEqual(items[0].url, "https://example.com/x.mp4")
        self.assertEqual(decisions, [])

    def test_verified_url_missing_from_candidates_is_dropped(self):
        with patch.object(
            material_verification,
            "select_for_segment",
            return_value=SegmentDecision(
                tier="stock_verified", phrase="x", stock_url="https://gone.example/a.mp4"
            ),
        ):
            items, decisions = apply_verification(
                [("x", [_candidate("https://example.com/x.mp4")])],
                scorer=lambda url, phrase: 0.9,
                config=self.cfg,
            )
        self.assertEqual(items, [])
        self.assertEqual(decisions[0].tier, "dropped")
        self.assertEqual(decisions[0].drop_reason, "verified_url_missing")


class TestDownloadVideosVerificationHook(unittest.TestCase):
    def setUp(self):
        self.original_app = dict(config.app)
        self.original_proxy = dict(config.proxy)
        config.app["material_verification_enabled"] = True
        config.app["material_verification_min_score"] = 0.33
        config.app["material_verification_runner_up_margin"] = 0.05
        config.proxy.clear()

    def tearDown(self):
        config.app.clear()
        config.app.update(self.original_app)
        config.proxy.clear()
        config.proxy.update(self.original_proxy)

    def _download(self, match_script_order):
        def fake_search(search_term, minimum_duration, video_aspect):
            if "Waterfront" in search_term:
                return [_candidate("https://example.com/verified.mp4")]
            if "Dish" in search_term:
                return [_candidate("https://example.com/low.mp4")]
            return []

        resolved = []

        def fake_resolve(item, *args, **kwargs):
            resolved.append(item.provider)
            return f"/tmp/{item.url.split('/')[-1]}"

        with (
            patch.object(
                material, "_build_search_videos", return_value=fake_search
            ),
            patch.object(
                material.svg_material,
                "resolve_material_path",
                side_effect=fake_resolve,
            ),
            patch.object(
                material_verification,
                "render_neutral_clip",
                side_effect=AssertionError("broll mode never renders neutral"),
            ),
            patch.object(material_verification, "track_event"),
        ):
            paths = material.download_videos(
                "task-1",
                ["Waterfront in the city", "Dish on a table", "A quiet afternoon"],
                audio_duration=100,
                max_clip_duration=5,
                match_script_order=match_script_order,
                material_scorer=lambda url, phrase: (
                    0.42 if "verified" in url else 0.18
                ),
            )
        return paths, resolved

    def test_flat_download_keeps_only_verified_stock(self):
        paths, resolved = self._download(match_script_order=False)
        self.assertEqual(paths, ["/tmp/verified.mp4"])
        self.assertEqual(resolved, ["pexels"])

    def test_script_order_download_keeps_only_verified_stock(self):
        paths, resolved = self._download(match_script_order=True)
        self.assertEqual(paths, ["/tmp/verified.mp4"])
        self.assertEqual(resolved, ["pexels"])

    def test_failed_verified_download_is_not_replaced(self):
        def fake_search(search_term, minimum_duration, video_aspect):
            return [_candidate("https://example.com/verified.mp4")]

        resolved = []

        def fake_resolve(item, *args, **kwargs):
            resolved.append(item.provider)
            return ""

        with (
            patch.object(
                material, "_build_search_videos", return_value=fake_search
            ),
            patch.object(
                material.svg_material,
                "resolve_material_path",
                side_effect=fake_resolve,
            ),
            patch.object(material_verification, "track_event"),
        ):
            paths = material.download_videos(
                "task-1",
                ["Waterfront in the city"],
                audio_duration=100,
                max_clip_duration=5,
                match_script_order=True,
                material_scorer=lambda url, phrase: 0.42,
            )
        self.assertEqual(paths, [])
        self.assertEqual(resolved, ["pexels"])


if __name__ == "__main__":
    unittest.main()
