"""Tests for verified stock material selection and R2 catalog SVG fallback.

The production scorer is pluggable via an option, not a test-only seam:
callers pass a scorer callable, and the default scorer is the lazy ONNX
scorer in material_verification. Tests inject a stub scorer that returns
fixed similarity scores per candidate URL, and a stub catalog search, so
no test calls a stock API, an SVG catalog, or a real model.

Similarity scores are relative, never probabilities: the threshold and
runner-up margin are pinned by tests, and a candidate is verified stock
only when it clears both. Fallback is always the R2 catalog, searched
with the segment phrase: no subject mapping, no keyword table, no
bundled artwork, and the same catalog asset is never used twice in one
video.
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
    _catalog_search,
    apply_verification,
    emit_material_fallback_summary,
    phrase_at,
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


def _svg(asset_id, path=None):
    return SvgAssetRef(
        asset_id=asset_id,
        relative_path=path or f"catalog/{asset_id}.svg",
    )


def _catalog(*assets):
    return lambda phrase: list(assets)


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


class TestPhraseAtTimestamp(unittest.TestCase):
    def test_frame_timestamp_maps_to_active_phrase(self):
        phrases = [
            ("Market in the morning", 0.0, 4.0),
            ("Dish on the table", 4.0, 8.0),
            ("Waterfront at sunset", 8.0, 12.0),
        ]
        self.assertEqual(phrase_at(1.0, phrases), "Market in the morning")
        self.assertEqual(phrase_at(5.0, phrases), "Dish on the table")
        self.assertEqual(phrase_at(9.0, phrases), "Waterfront at sunset")

    def test_timestamp_before_first_phrase_uses_first_phrase(self):
        phrases = [("Waterfront at sunset", 4.0, 8.0)]
        self.assertEqual(phrase_at(0.5, phrases), "Waterfront at sunset")

    def test_timestamp_in_gap_uses_most_recent_started_phrase(self):
        phrases = [
            ("Market in the morning", 0.0, 4.0),
            ("Dish on the table", 8.0, 12.0),
            ("Waterfront at sunset", 16.0, 20.0),
        ]
        self.assertEqual(
            phrase_at(6.0, phrases), "Market in the morning"
        )

    def test_timestamp_after_last_phrase_uses_last_phrase(self):
        phrases = [
            ("Market in the morning", 0.0, 4.0),
            ("Waterfront at sunset", 8.0, 12.0),
        ]
        self.assertEqual(phrase_at(25.0, phrases), "Waterfront at sunset")


class TestSelectForSegment(unittest.TestCase):
    def setUp(self):
        self.cfg = VerificationConfig(
            enabled=True, min_score=0.33, runner_up_margin=0.05
        )
        self.catalog = _catalog(_svg("catalog-1"), _svg("catalog-2"))

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
            catalog_search=self.catalog,
        )
        self.assertEqual(decision.tier, "stock_verified")
        self.assertEqual(
            decision.stock_url, "https://example.com/verified.mp4"
        )

    def test_failing_stock_falls_back_to_first_catalog_match(self):
        decision = select_for_segment(
            phrase="A dish on a table",
            candidates=[_candidate("https://example.com/low.mp4")],
            scorer=lambda url, phrase: 0.18,
            config=self.cfg,
            catalog_search=self.catalog,
        )
        self.assertEqual(decision.tier, "svg_catalog")
        self.assertEqual(decision.svg_asset_id, "catalog-1")
        self.assertEqual(decision.fallback_reason, "score_below_threshold")

    def test_used_catalog_asset_is_never_reused_in_one_video(self):
        decision = select_for_segment(
            phrase="A dish on a table",
            candidates=[_candidate("https://example.com/low.mp4")],
            scorer=lambda url, phrase: 0.18,
            config=self.cfg,
            catalog_search=self.catalog,
            used_asset_ids={"catalog-1"},
        )
        self.assertEqual(decision.tier, "svg_catalog_alt")
        self.assertEqual(decision.svg_asset_id, "catalog-2")

    def test_empty_catalog_falls_back_to_neutral(self):
        decision = select_for_segment(
            phrase="A dish on a table",
            candidates=[_candidate("https://example.com/low.mp4")],
            scorer=lambda url, phrase: 0.18,
            config=self.cfg,
            catalog_search=_catalog(),
        )
        self.assertEqual(decision.tier, "neutral")
        self.assertIsNone(decision.svg_asset_id)

    def test_ambiguous_candidate_triggers_catalog_fallback(self):
        decision = select_for_segment(
            phrase="Waterfront in the city",
            candidates=[
                _candidate("https://example.com/top.mp4"),
                _candidate("https://example.com/runner-up.mp4"),
            ],
            scorer=lambda url, phrase: 0.40 if "top" in url else 0.38,
            config=self.cfg,
            catalog_search=self.catalog,
        )
        self.assertEqual(decision.tier, "svg_catalog")
        self.assertEqual(decision.fallback_reason, "runner_up_margin_too_small")

    def test_missing_footage_triggers_catalog_fallback(self):
        decision = select_for_segment(
            phrase="Waterfront in the city",
            candidates=[],
            scorer=lambda url, phrase: 0.18,
            config=self.cfg,
            catalog_search=self.catalog,
        )
        self.assertEqual(decision.tier, "svg_catalog")
        self.assertEqual(decision.fallback_reason, "no_candidates")

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
            catalog_search=self.catalog,
        )
        self.assertNotIn("catalog/traveler.svg", seen)
        self.assertEqual(decision.tier, "svg_catalog")

    def test_unavailable_scorer_never_passes_stock_but_catalog_still_runs(self):
        def failing_scorer(url, phrase):
            raise VerificationUnavailable("onnxruntime is not installed")

        decision = select_for_segment(
            phrase="Waterfront in the city",
            candidates=[_candidate("https://example.com/verified.mp4")],
            scorer=failing_scorer,
            config=self.cfg,
            catalog_search=self.catalog,
        )
        self.assertNotEqual(decision.tier, "stock_verified")
        self.assertEqual(decision.fallback_reason, "scorer_unavailable")
        self.assertEqual(decision.tier, "svg_catalog")

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
            SegmentDecision(tier="svg_catalog", phrase="b"),
            SegmentDecision(tier="svg_catalog_alt", phrase="c"),
            SegmentDecision(tier="neutral", phrase="d"),
            SegmentDecision(tier="neutral", phrase="e"),
        ]
        summary = summarize_decisions(decisions)
        self.assertEqual(
            summary,
            {
                "stock_verified": 1,
                "svg_catalog": 1,
                "svg_catalog_alt": 1,
                "neutral": 2,
            },
        )

    def test_summary_event_carries_counts_and_task_id_only(self):
        decisions = [SegmentDecision(tier="svg_catalog", phrase="Waterfront")]
        with patch(
            "app.services.material_verification.track_event"
        ) as track_event:
            emit_material_fallback_summary("task-123", decisions)
        track_event.assert_called_once()
        args, _kwargs = track_event.call_args
        self.assertEqual(args[0], "material_fallback_summary")
        properties = args[1]
        self.assertEqual(properties["task_id"], "task-123")
        self.assertEqual(properties["svg_catalog"], 1)
        self.assertEqual(properties["stock_verified"], 0)
        # No free text, no phrases, no URLs, no paths in the event.
        for value in properties.values():
            self.assertNotIn("Waterfront", str(value))
            self.assertNotIn("http", str(value))
            self.assertNotIn("/", str(value) if isinstance(value, str) else "")

    def test_summary_event_carries_user_id_when_known(self):
        decisions = [SegmentDecision(tier="svg_catalog", phrase="Waterfront")]
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
        decisions = [SegmentDecision(tier="svg_catalog", phrase="Waterfront")]
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
        decisions = [SegmentDecision(tier="svg_catalog", phrase="Waterfront")]
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
        decisions = [SegmentDecision(tier="svg_catalog", phrase="Waterfront")]
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

    def test_apply_verification_preserves_verified_and_falls_back(self):
        groups = [
            (
                "Waterfront in the city",
                [
                    _candidate("https://example.com/verified.mp4"),
                    _candidate("https://example.com/other.mp4"),
                ],
            ),
            ("A dish on a table", [_candidate("https://example.com/low.mp4")]),
        ]
        items, decisions = apply_verification(
            groups,
            scorer=lambda url, phrase: (
                0.42 if "verified" in url else 0.18
            ),
            config=self.cfg,
            catalog_search=_catalog(_svg("catalog-1")),
        )
        self.assertEqual(len(decisions), 2)
        self.assertEqual(decisions[0].tier, "stock_verified")
        self.assertEqual(decisions[1].tier, "svg_catalog")
        self.assertEqual(items[0].provider, "pexels")
        self.assertEqual(items[1].provider, "svg")

    def test_apply_verification_disabled_returns_candidates_unchanged(self):
        groups = [("Waterfront", [_candidate("https://example.com/x.mp4")])]
        items, decisions = apply_verification(
            groups,
            scorer=lambda url, phrase: 0.18,
            config=VerificationConfig(enabled=False),
            catalog_search=_catalog(),
        )
        self.assertEqual(items[0].url, "https://example.com/x.mp4")
        self.assertEqual(decisions, [])

    def test_apply_verification_never_reuses_a_catalog_asset(self):
        groups = [
            ("A dish on a table", []),
            ("A dish on a table", []),
        ]
        items, decisions = apply_verification(
            groups,
            scorer=lambda url, phrase: 0.18,
            config=self.cfg,
            catalog_search=_catalog(_svg("catalog-1"), _svg("catalog-2")),
        )
        self.assertEqual(decisions[0].tier, "svg_catalog")
        self.assertEqual(decisions[0].svg_asset_id, "catalog-1")
        self.assertEqual(decisions[1].tier, "svg_catalog_alt")
        self.assertEqual(decisions[1].svg_asset_id, "catalog-2")
        self.assertEqual(items[1].provider, "svg")


class TestDownloadVideosVerificationHook(unittest.TestCase):
    def setUp(self):
        self.original_app = dict(config.app)
        self.original_proxy = dict(config.proxy)

    def tearDown(self):
        config.app.clear()
        config.app.update(self.original_app)
        config.proxy.clear()
        config.proxy.update(self.original_proxy)

    def _catalog_for_phrase(self, phrase):
        if "Dish" in phrase:
            return [_svg("catalog-1")]
        return []

    def test_download_videos_with_verification_replaces_failed_stock(self):
        config.app["material_verification_enabled"] = True
        config.app["material_verification_min_score"] = 0.33
        config.app["material_verification_runner_up_margin"] = 0.05
        config.proxy.clear()

        def fake_search(search_term, minimum_duration, video_aspect):
            if "Waterfront" in search_term:
                return [_candidate("https://example.com/verified.mp4")]
            if "Dish" in search_term:
                return [_candidate("https://example.com/low.mp4")]
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
            patch.object(
                material_verification,
                "_catalog_search",
                side_effect=self._catalog_for_phrase,
            ),
        ):
            paths = material.download_videos(
                "task-1",
                ["Waterfront in the city", "Dish on a table", "A quiet afternoon"],
                audio_duration=100,
                max_clip_duration=5,
                material_scorer=lambda url, phrase: (
                    0.42 if "verified" in url else 0.18
                ),
            )
        render_neutral.assert_called()
        # Verified stock downloads, failed stock becomes an SVG clip,
        # a phrase with no catalog match becomes a locally rendered
        # neutral clip.
        self.assertIn("/tmp/verified.mp4.mp4", paths)
        self.assertIn("/tmp/svg-clip.mp4", paths)
        self.assertIn("/tmp/neutral.mp4", paths)

    def test_download_videos_script_order_with_verification_keeps_each_phrase(
        self,
    ):
        config.app["material_verification_enabled"] = True
        config.app["material_verification_min_score"] = 0.33
        config.app["material_verification_runner_up_margin"] = 0.05
        config.proxy.clear()

        def fake_search(search_term, minimum_duration, video_aspect):
            if "Waterfront" in search_term:
                return [_candidate("https://example.com/verified.mp4")]
            if "Dish" in search_term:
                return [_candidate("https://example.com/low.mp4")]
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
            patch.object(
                material_verification,
                "_catalog_search",
                side_effect=self._catalog_for_phrase,
            ),
        ):
            paths = material.download_videos(
                "task-1",
                ["Waterfront in the city", "Dish on a table", "A quiet afternoon"],
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
                "/tmp/verified.mp4.mp4",
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
        config.proxy.clear()

        def fake_search(search_term, minimum_duration, video_aspect):
            if "Waterfront" in search_term:
                return [_candidate("https://example.com/verified.mp4")]
            return [_candidate("https://example.com/low.mp4")]

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
            patch.object(
                material_verification,
                "_catalog_search",
                side_effect=self._catalog_for_phrase,
            ),
        ):
            paths = material.download_videos(
                "task-1",
                ["Waterfront in the city", "Dish on a table"],
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

    def test_catalog_search_strips_articles_before_fts(self):
        """Catalog FTS ANDs every token and no title holds a bare article,
        so a sentence phrase must reach the catalog without 'a'/'an'/'the'
        or a real match (traveler eating local food) is lost."""
        from types import SimpleNamespace

        from app.services import svg_catalog

        seen = []

        def fake_search(term, limit=5):
            seen.append(term)
            return [
                SimpleNamespace(
                    asset_id="9:2687110",
                    relative_path="Traveler eating local food.svg",
                )
            ]

        with (
            patch.object(svg_catalog, "is_enabled", return_value=True),
            patch.object(svg_catalog, "search", side_effect=fake_search),
        ):
            assets = _catalog_search("a traveler eating local food")
        self.assertEqual(seen, ["traveler eating local food"])
        self.assertEqual(assets[0].asset_id, "9:2687110")

    def test_catalog_search_all_articles_returns_empty_without_query(self):
        from app.services import svg_catalog

        with (
            patch.object(svg_catalog, "is_enabled", return_value=True),
            patch.object(svg_catalog, "search") as fake_search,
        ):
            self.assertEqual(_catalog_search("a the an"), [])
        fake_search.assert_not_called()

    def test_download_videos_script_order_empty_term_gets_catalog_fallback(
        self,
    ):
        config.app["material_verification_enabled"] = True
        config.app["material_verification_min_score"] = 0.33
        config.app["material_verification_runner_up_margin"] = 0.05
        config.proxy.clear()

        def fake_search(search_term, minimum_duration, video_aspect):
            return []

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
            patch.object(
                material_verification,
                "_catalog_search",
                side_effect=lambda phrase: [_svg("catalog-1")],
            ),
        ):
            paths = material.download_videos(
                "task-1",
                ["A traveler eating local food", "A cat sleeping"],
                audio_duration=100,
                max_clip_duration=5,
                match_script_order=True,
            )
        # Both empty terms reach verification: the first takes the catalog
        # asset, the second (same asset already used) falls to neutral.
        # Before the empty-group fix, both terms were dropped and paths
        # came back empty.
        self.assertEqual(paths, ["/tmp/svg-clip.mp4", "/tmp/neutral.mp4"])


if __name__ == "__main__":
    unittest.main()
