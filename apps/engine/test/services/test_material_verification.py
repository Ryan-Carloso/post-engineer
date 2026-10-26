"""Tests for verified stock material selection and thematic SVG fallback.

The production scorer is pluggable via an option, not a test-only seam:
callers pass a scorer callable, and the default scorer is the lazy ONNX
scorer in material_verification. Tests inject a stub scorer that returns
fixed similarity scores per candidate URL, so no test calls a stock API,
an SVG catalog, or a real model.

Similarity scores are relative, never probabilities: the calibrated
threshold and runner-up margin are pinned by tests, and a candidate is
verified stock only when it clears both.
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
    SvgAssetRef,
    VerificationConfig,
    VerificationUnavailable,
    apply_verification,
    emit_material_fallback_summary,
    identify_subject,
    phrase_at,
    render_neutral_clip,
    render_neutral_png,
    select_for_segment,
    subject_to_asset_from_config,
    summarize_decisions,
    verification_config,
)


def _candidate(url, provider="pexels", duration=8):
    item = MaterialInfo()
    item.provider = provider
    item.url = url
    item.duration = duration
    return item


def _svg(asset_id, subject, broader, path=None):
    return SvgAssetRef(
        asset_id=asset_id,
        subject=subject,
        broader_category=broader,
        relative_path=path or f"catalog/{asset_id}.svg",
    )


# Reference scores for the four calibration cases. These are the ordering
# the calibrated threshold must respect: verified Porto above the threshold,
# every known mismatch below it.
REFERENCE_SCORES = {
    "https://example.com/porto-ribeira-verified.mp4": 0.42,
    "https://example.com/dumplings.mp4": 0.18,
    "https://example.com/porto-alegre-shop.mp4": 0.21,
    "https://example.com/ribeira-waterfront.mp4": 0.24,
}


def _reference_scorer(url, phrase):
    return REFERENCE_SCORES.get(url)


class TestVerificationConfig(unittest.TestCase):
    def setUp(self):
        self.original = dict(config.app)

    def tearDown(self):
        config.app.clear()
        config.app.update(self.original)

    def test_defaults_are_calibrated_between_mismatch_and_verified(self):
        """The default threshold sits strictly between the known cases."""
        cfg = verification_config()
        max_mismatch = max(
            REFERENCE_SCORES["https://example.com/dumplings.mp4"],
            REFERENCE_SCORES["https://example.com/porto-alegre-shop.mp4"],
            REFERENCE_SCORES["https://example.com/ribeira-waterfront.mp4"],
        )
        verified = REFERENCE_SCORES["https://example.com/porto-ribeira-verified.mp4"]
        self.assertGreater(cfg.min_score, max_mismatch)
        self.assertLess(cfg.min_score, verified)
        self.assertEqual(cfg.min_score, 0.33)
        self.assertEqual(cfg.runner_up_margin, 0.05)

    def test_config_values_override_defaults(self):
        config.app["material_verification_min_score"] = 0.40
        config.app["material_verification_runner_up_margin"] = 0.10
        cfg = verification_config()
        self.assertEqual(cfg.min_score, 0.40)
        self.assertEqual(cfg.runner_up_margin, 0.10)

    def test_invalid_config_values_fall_back_to_defaults(self):
        config.app["material_verification_min_score"] = "not-a-number"
        cfg = verification_config()
        self.assertEqual(cfg.min_score, 0.33)


class TestPhraseAtTimestamp(unittest.TestCase):
    def test_frame_timestamp_maps_to_active_phrase(self):
        phrases = [
            ("Bolhao market in the morning", 0.0, 4.0),
            ("Tripas dish on the table", 4.0, 8.0),
            ("Ribeira at sunset", 8.0, 12.0),
        ]
        self.assertEqual(phrase_at(1.0, phrases), "Bolhao market in the morning")
        self.assertEqual(phrase_at(5.0, phrases), "Tripas dish on the table")
        self.assertEqual(phrase_at(9.0, phrases), "Ribeira at sunset")

    def test_timestamp_before_first_phrase_uses_first_phrase(self):
        phrases = [("Ribeira at sunset", 4.0, 8.0)]
        self.assertEqual(phrase_at(0.5, phrases), "Ribeira at sunset")

    def test_timestamp_in_gap_uses_most_recent_started_phrase(self):
        phrases = [
            ("Bolhao market in the morning", 0.0, 4.0),
            ("Tripas dish on the table", 8.0, 12.0),
            ("Ribeira at sunset", 16.0, 20.0),
        ]
        self.assertEqual(
            phrase_at(6.0, phrases), "Bolhao market in the morning"
        )

    def test_timestamp_after_last_phrase_uses_last_phrase(self):
        phrases = [
            ("Bolhao market in the morning", 0.0, 4.0),
            ("Ribeira at sunset", 8.0, 12.0),
        ]
        self.assertEqual(phrase_at(25.0, phrases), "Ribeira at sunset")


class TestIdentifySubject(unittest.TestCase):
    def test_subject_is_deterministic_and_porto_alegre_is_not_porto(self):
        self.assertEqual(identify_subject("Tripas a moda do Porto"), "tripas_dish")
        self.assertEqual(identify_subject("Behind Bolhao market"), "bolhao_market")
        self.assertEqual(identify_subject("Walking the Ribeira"), "ribeira")
        self.assertEqual(identify_subject("A shop in Porto Alegre"), "porto_alegre")
        self.assertNotEqual(identify_subject("A shop in Porto Alegre"), "ribeira")

    def test_unknown_phrase_has_no_subject(self):
        self.assertIsNone(identify_subject("A quiet afternoon somewhere"))


class TestSelectForSegment(unittest.TestCase):
    def setUp(self):
        self.cfg = VerificationConfig(
            enabled=True, min_score=0.33, runner_up_margin=0.05
        )
        self.thematic = _svg("ribeira-1", "ribeira", "porto_places")
        self.broader = _svg("porto-food-1", "porto_food_generic", "porto_food")
        self.mapping = {
            "ribeira": self.thematic,
            "porto_food": self.broader,
        }

    def test_verified_porto_passes(self):
        decision = select_for_segment(
            phrase="Ribeira in Porto",
            candidates=[
                _candidate("https://example.com/porto-ribeira-verified.mp4"),
                _candidate("https://example.com/other.mp4"),
            ],
            scorer=lambda url, phrase: (
                0.42 if "verified" in url else 0.20
            ),
            config=self.cfg,
            subject_to_asset=self.mapping,
        )
        self.assertEqual(decision.tier, "stock_verified")
        self.assertEqual(
            decision.stock_url, "https://example.com/porto-ribeira-verified.mp4"
        )

    def test_bacalhau_vs_dumplings_fails_and_falls_back_to_thematic(self):
        decision = select_for_segment(
            phrase="Bacalhau dish",
            candidates=[_candidate("https://example.com/dumplings.mp4")],
            scorer=_reference_scorer,
            config=self.cfg,
            subject_to_asset={"bacalhau_dish": _svg("bacalhau-1", "bacalhau_dish", "porto_food")},
        )
        self.assertEqual(decision.tier, "svg_thematic")
        self.assertEqual(decision.fallback_reason, "score_below_threshold")

    def test_porto_alegre_footage_fails(self):
        decision = select_for_segment(
            phrase="Porto streets",
            candidates=[_candidate("https://example.com/porto-alegre-shop.mp4")],
            scorer=_reference_scorer,
            config=self.cfg,
            subject_to_asset=self.mapping,
        )
        self.assertNotEqual(decision.tier, "stock_verified")

    def test_ribeira_waterfront_for_interior_streets_fails(self):
        decision = select_for_segment(
            phrase="Narrow interior streets",
            candidates=[_candidate("https://example.com/ribeira-waterfront.mp4")],
            scorer=_reference_scorer,
            config=self.cfg,
            subject_to_asset=self.mapping,
        )
        self.assertNotEqual(decision.tier, "stock_verified")

    def test_ambiguous_candidate_triggers_svg_fallback(self):
        decision = select_for_segment(
            phrase="Ribeira in Porto",
            candidates=[
                _candidate("https://example.com/top.mp4"),
                _candidate("https://example.com/runner-up.mp4"),
            ],
            scorer=lambda url, phrase: 0.40 if "top" in url else 0.38,
            config=self.cfg,
            subject_to_asset=self.mapping,
        )
        self.assertEqual(decision.tier, "svg_thematic")
        self.assertEqual(decision.fallback_reason, "runner_up_margin_too_small")

    def test_missing_footage_triggers_svg_fallback(self):
        decision = select_for_segment(
            phrase="Ribeira in Porto",
            candidates=[],
            scorer=_reference_scorer,
            config=self.cfg,
            subject_to_asset=self.mapping,
        )
        self.assertEqual(decision.tier, "svg_thematic")
        self.assertEqual(decision.fallback_reason, "no_candidates")

    def test_broader_category_tier_when_no_thematic_asset(self):
        decision = select_for_segment(
            phrase="Tripas dish",
            candidates=[_candidate("https://example.com/dumplings.mp4")],
            scorer=_reference_scorer,
            config=self.cfg,
            subject_to_asset={"porto_food": self.broader},
        )
        self.assertEqual(decision.tier, "svg_broader")
        self.assertEqual(decision.svg_asset_id, "porto-food-1")

    def test_reused_tier_when_broader_missing_and_previous_is_compatible(self):
        previous = _svg("ribeira-1", "ribeira", "porto_places")
        decision = select_for_segment(
            phrase="Ribeira in Porto",
            candidates=[_candidate("https://example.com/dumplings.mp4")],
            scorer=_reference_scorer,
            config=self.cfg,
            subject_to_asset={},
            previous_asset=previous,
            used_asset_ids=set(),
        )
        self.assertEqual(decision.tier, "svg_reused")
        self.assertEqual(decision.svg_asset_id, "ribeira-1")

    def test_reuse_blocked_when_asset_already_used_in_current_video(self):
        previous = _svg("ribeira-1", "ribeira", "porto_places")
        decision = select_for_segment(
            phrase="Ribeira in Porto",
            candidates=[_candidate("https://example.com/dumplings.mp4")],
            scorer=_reference_scorer,
            config=self.cfg,
            subject_to_asset={},
            previous_asset=previous,
            used_asset_ids={"ribeira-1"},
        )
        self.assertEqual(decision.tier, "neutral")
        self.assertIsNone(decision.subject)

    def test_neutral_tier_implies_no_specific_subject(self):
        decision = select_for_segment(
            phrase="A quiet afternoon somewhere",
            candidates=[],
            scorer=_reference_scorer,
            config=self.cfg,
            subject_to_asset={},
        )
        self.assertEqual(decision.tier, "neutral")
        self.assertIsNone(decision.subject)
        self.assertIsNone(decision.svg_asset_id)
        self.assertIsNone(decision.stock_url)

    def test_fallback_does_not_use_catalog_text_search(self):
        """Fallback uses the explicit subject mapping, never FTS search."""
        with patch(
            "app.services.svg_catalog.search",
            side_effect=AssertionError("text search must not run"),
        ):
            decision = select_for_segment(
                phrase="Ribeira in Porto",
                candidates=[],
                scorer=_reference_scorer,
                config=self.cfg,
                subject_to_asset=self.mapping,
            )
        self.assertEqual(decision.tier, "svg_thematic")

    def test_unavailable_scorer_never_passes_stock(self):
        def failing_scorer(url, phrase):
            raise VerificationUnavailable("onnxruntime is not installed")

        decision = select_for_segment(
            phrase="Ribeira in Porto",
            candidates=[_candidate("https://example.com/porto-ribeira-verified.mp4")],
            scorer=failing_scorer,
            config=self.cfg,
            subject_to_asset=self.mapping,
        )
        self.assertNotEqual(decision.tier, "stock_verified")
        self.assertEqual(decision.fallback_reason, "scorer_unavailable")

    def test_default_onnx_scorer_raises_without_dependency(self):
        scorer = OnnxClipScorer()
        with self.assertRaises(VerificationUnavailable):
            scorer.score("https://example.com/video.mp4", "Ribeira")


class TestNeutralPng(unittest.TestCase):
    def test_neutral_png_is_an_image_with_no_text_or_subject(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            path = render_neutral_png(tmp)
            self.assertTrue(os.path.isfile(path))
            with open(path, "rb") as handle:
                header = handle.read(8)
            self.assertEqual(header, b"\x89PNG\r\n\x1a\n")

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
            self.assertTrue(path.endswith("neutral-background.png"))
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
            SegmentDecision(tier="svg_thematic", phrase="b"),
            SegmentDecision(tier="svg_broader", phrase="c"),
            SegmentDecision(tier="svg_reused", phrase="d"),
            SegmentDecision(tier="neutral", phrase="e"),
            SegmentDecision(tier="neutral", phrase="f"),
        ]
        summary = summarize_decisions(decisions)
        self.assertEqual(
            summary,
            {
                "stock_verified": 1,
                "svg_thematic": 1,
                "svg_broader": 1,
                "svg_reused": 1,
                "neutral": 2,
            },
        )

    def test_summary_event_carries_counts_and_task_id_only(self):
        decisions = [SegmentDecision(tier="svg_thematic", phrase="Ribeira")]
        with patch(
            "app.services.material_verification.track_event"
        ) as track_event:
            emit_material_fallback_summary("task-123", decisions)
        track_event.assert_called_once()
        args, _kwargs = track_event.call_args
        self.assertEqual(args[0], "material_fallback_summary")
        properties = args[1]
        self.assertEqual(properties["task_id"], "task-123")
        self.assertEqual(properties["svg_thematic"], 1)
        self.assertEqual(properties["stock_verified"], 0)
        # No free text, no phrases, no URLs, no paths in the event.
        for value in properties.values():
            self.assertNotIn("Ribeira", str(value))
            self.assertNotIn("http", str(value))
            self.assertNotIn("/", str(value) if isinstance(value, str) else "")


class TestApplyVerification(unittest.TestCase):
    def setUp(self):
        self.cfg = VerificationConfig(
            enabled=True, min_score=0.33, runner_up_margin=0.05
        )

    def test_apply_verification_preserves_verified_and_falls_back(self):
        groups = [
            (
                "Ribeira in Porto",
                [
                    _candidate("https://example.com/porto-ribeira-verified.mp4"),
                    _candidate("https://example.com/other.mp4"),
                ],
            ),
            ("Bacalhau dish", [_candidate("https://example.com/dumplings.mp4")]),
        ]
        items, decisions = apply_verification(
            groups,
            scorer=lambda url, phrase: (
                0.42 if "verified" in url else 0.18
            ),
            config=self.cfg,
            subject_to_asset={
                "bacalhau_dish": _svg("bacalhau-1", "bacalhau_dish", "porto_food")
            },
        )
        self.assertEqual(len(decisions), 2)
        self.assertEqual(decisions[0].tier, "stock_verified")
        self.assertEqual(decisions[1].tier, "svg_thematic")
        self.assertEqual(items[0].provider, "pexels")
        self.assertEqual(items[1].provider, "svg")

    def test_apply_verification_disabled_returns_candidates_unchanged(self):
        groups = [("Ribeira", [_candidate("https://example.com/x.mp4")])]
        items, decisions = apply_verification(
            groups,
            scorer=_reference_scorer,
            config=VerificationConfig(enabled=False),
            subject_to_asset={},
        )
        self.assertEqual(items[0].url, "https://example.com/x.mp4")
        self.assertEqual(decisions, [])

    def test_apply_verification_second_fallback_reuses_previous_svg(self):
        """Reuse is reachable through apply_verification, not only a
        hand-built empty used set. Second phrase has no thematic or
        broader mapping of its own; previous is compatible via broader."""
        groups = [
            ("Bacalhau dish", []),
            ("Tripas dish", []),
        ]
        items, decisions = apply_verification(
            groups,
            scorer=_reference_scorer,
            config=self.cfg,
            subject_to_asset={
                "bacalhau_dish": _svg("bacalhau-1", "bacalhau_dish", "porto_food")
            },
        )
        self.assertEqual(decisions[0].tier, "svg_thematic")
        self.assertEqual(decisions[1].tier, "svg_reused")
        self.assertEqual(decisions[1].svg_asset_id, "bacalhau-1")
        self.assertEqual(items[1].provider, "svg")

    def test_category_key_mapping_gets_itself_as_broader(self):
        original = dict(config.app)
        try:
            config.app["material_subject_to_asset"] = {
                "porto_food": "catalog/porto-food-1.svg"
            }
            mapping = subject_to_asset_from_config()
        finally:
            config.app.clear()
            config.app.update(original)
        self.assertEqual(mapping["porto_food"].broader_category, "porto_food")


class TestDownloadVideosVerificationHook(unittest.TestCase):
    def setUp(self):
        self.original_app = dict(config.app)
        self.original_proxy = dict(config.proxy)

    def tearDown(self):
        config.app.clear()
        config.app.update(self.original_app)
        config.proxy.clear()
        config.proxy.update(self.original_proxy)

    def test_download_videos_with_verification_replaces_failed_stock(self):
        config.app["material_verification_enabled"] = True
        config.app["material_verification_min_score"] = 0.33
        config.app["material_verification_runner_up_margin"] = 0.05
        config.app["material_subject_to_asset"] = {
            "bacalhau_dish": "catalog/bacalhau-1.svg"
        }
        config.proxy.clear()

        def fake_search(search_term, minimum_duration, video_aspect):
            if "Ribeira" in search_term:
                return [_candidate("https://example.com/porto-ribeira-verified.mp4")]
            if "Bacalhau" in search_term:
                return [_candidate("https://example.com/dumplings.mp4")]
            return [_candidate("https://example.com/unknown.mp4")]

        original_resolve = material.svg_material.resolve_material_path

        def fake_resolve(item, *args, **kwargs):
            if item.provider == "neutral":
                return original_resolve(item, *args, **kwargs)
            if item.provider == "svg":
                return "/tmp/svg-clip.mp4"
            return f"/tmp/{item.url.split('/')[-1]}.mp4"

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
                return_value="/tmp/neutral.mp4",
            ) as render_neutral,
        ):
            paths = material.download_videos(
                "task-1",
                ["Ribeira in Porto", "Bacalhau dish", "A quiet afternoon"],
                audio_duration=100,
                max_clip_duration=5,
                material_scorer=lambda url, phrase: (
                    0.42 if "verified" in url else 0.18
                ),
            )
        render_neutral.assert_called()
        # Verified stock downloads, failed stock becomes an SVG clip,
        # unidentified phrase becomes a locally rendered neutral clip.
        self.assertIn("/tmp/porto-ribeira-verified.mp4.mp4", paths)
        self.assertIn("/tmp/svg-clip.mp4", paths)
        self.assertIn("/tmp/neutral.mp4", paths)

    def test_download_videos_script_order_with_verification_keeps_each_phrase(
        self,
    ):
        config.app["material_verification_enabled"] = True
        config.app["material_verification_min_score"] = 0.33
        config.app["material_verification_runner_up_margin"] = 0.05
        config.app["material_subject_to_asset"] = {
            "bacalhau_dish": "catalog/bacalhau-1.svg"
        }
        config.proxy.clear()

        def fake_search(search_term, minimum_duration, video_aspect):
            if "Ribeira" in search_term:
                return [_candidate("https://example.com/porto-ribeira-verified.mp4")]
            if "Bacalhau" in search_term:
                return [_candidate("https://example.com/dumplings.mp4")]
            return [_candidate("https://example.com/unknown.mp4")]

        original_resolve = material.svg_material.resolve_material_path

        def fake_resolve(item, *args, **kwargs):
            if item.provider == "neutral":
                return original_resolve(item, *args, **kwargs)
            if item.provider == "svg":
                return "/tmp/svg-clip.mp4"
            return f"/tmp/{item.url.split('/')[-1]}.mp4"

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
                return_value="/tmp/neutral.mp4",
            ),
        ):
            paths = material.download_videos(
                "task-1",
                ["Ribeira in Porto", "Bacalhau dish", "A quiet afternoon"],
                audio_duration=100,
                max_clip_duration=5,
                match_script_order=True,
                material_scorer=lambda url, phrase: (
                    0.42 if "verified" in url else 0.18
                ),
            )
        # One clip per phrase, in script order: verified stock, then the
        # SVG fallback, then neutral. No phrase is dropped by the zip
        # between decisions and selected items.
        self.assertEqual(
            paths,
            [
                "/tmp/porto-ribeira-verified.mp4.mp4",
                "/tmp/svg-clip.mp4",
                "/tmp/neutral.mp4",
            ],
        )

    def test_download_videos_script_order_failed_stock_falls_back_to_neutral(
        self,
    ):
        config.app["material_verification_enabled"] = True
        config.app["material_verification_min_score"] = 0.33
        config.app["material_verification_runner_up_margin"] = 0.05
        config.app["material_subject_to_asset"] = {
            "bacalhau_dish": "catalog/bacalhau-1.svg"
        }
        config.proxy.clear()

        def fake_search(search_term, minimum_duration, video_aspect):
            if "Ribeira" in search_term:
                return [_candidate("https://example.com/porto-ribeira-verified.mp4")]
            return [_candidate("https://example.com/dumplings.mp4")]

        original_resolve = material.svg_material.resolve_material_path

        def fake_resolve(item, *args, **kwargs):
            if item.provider == "neutral":
                return original_resolve(item, *args, **kwargs)
            if item.provider == "svg":
                return "/tmp/svg-clip.mp4"
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
            patch.object(
                material_verification,
                "render_neutral_clip",
                return_value="/tmp/neutral.mp4",
            ),
        ):
            paths = material.download_videos(
                "task-1",
                ["Ribeira in Porto", "Bacalhau dish"],
                audio_duration=100,
                max_clip_duration=5,
                match_script_order=True,
                material_scorer=lambda url, phrase: (
                    0.42 if "verified" in url else 0.18
                ),
            )
        # A failed verified-stock download must not lose the segment:
        # it degrades to a neutral clip instead of contributing nothing.
        self.assertEqual(paths, ["/tmp/neutral.mp4", "/tmp/svg-clip.mp4"])


if __name__ == "__main__":
    unittest.main()
