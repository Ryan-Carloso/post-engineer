"""Tests for the SVG branch of the material pipeline."""
import hashlib
import os
import subprocess
import tempfile
import unittest
import xml.etree.ElementTree as ET
from unittest.mock import Mock, patch

import numpy as np

from app.models.schema import MaterialInfo, VideoAspect
from app.services import material, svg_catalog, svg_draw, svg_material, svg_pencil, svg_sketch, video_download


def _patch_asset_resolution(test_case):
    """Resolve catalog paths to themselves, so no test reaches R2."""
    patcher = patch.object(
        svg_catalog, "resolve_asset_path", side_effect=lambda path: path
    )
    test_case.resolve_asset_path = patcher.start()
    test_case.addCleanup(patcher.stop)


class SearchVideosSvgTests(unittest.TestCase):
    @patch("app.services.svg_material.svg_catalog")
    def test_disabled_catalog_returns_nothing(self, mock_catalog):
        mock_catalog.is_enabled.return_value = False
        self.assertEqual(svg_material.search_videos_svg("money", 3), [])

    @patch("app.services.svg_material.svg_catalog")
    def test_maps_catalog_assets_to_material_info(self, mock_catalog):
        mock_catalog.is_enabled.return_value = True
        mock_catalog.search.return_value = [
            type(
                "A",
                (),
                {
                    "relative_path": "Animals/a.svg",
                    "title": "Hen",
                    "asset_id": "4:1",
                },
            )()
        ]
        items = svg_material.search_videos_svg("money", 4)
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0].provider, "svg")
        # The catalog-relative path: the artwork is fetched only when rendered.
        self.assertEqual(items[0].url, "Animals/a.svg")
        self.assertEqual(items[0].duration, 4)

    @patch("app.services.svg_material.svg_catalog")
    def test_passes_search_term_and_limit(self, mock_catalog):
        mock_catalog.is_enabled.return_value = True
        mock_catalog.search.return_value = []
        svg_material.search_videos_svg("money", 4)
        mock_catalog.search.assert_called_once_with("money")


class RasterizeSvgTests(unittest.TestCase):
    @patch("app.services.svg_material.subprocess.run")
    def test_calls_rsvg_convert_with_fixed_output_flags(self, mock_run):
        mock_run.return_value = subprocess.CompletedProcess([], 0)
        with patch("os.path.isfile", return_value=True), patch(
            "os.path.getsize", return_value=2048
        ):
            self.assertTrue(svg_material.rasterize_svg_to_png("/in/a.svg", "/out/a.png"))
        argv = mock_run.call_args[0][0]
        # A repeated output flag makes the LAST one win and silently discards
        # the earlier value, so the argv shape itself is the contract.
        self.assertEqual(argv.count("-o"), 1)
        self.assertEqual(argv.count("-w"), 1)
        self.assertEqual(argv[-2], "/out/a.png")
        self.assertEqual(argv[-1], "/in/a.svg")

    @patch("app.services.svg_material.subprocess.run")
    def test_returns_false_on_failure(self, mock_run):
        mock_run.side_effect = subprocess.CalledProcessError(1, "rsvg-convert")
        self.assertFalse(svg_material.rasterize_svg_to_png("/in/a.svg", "/out/a.png"))

    @patch("app.services.svg_material.subprocess.run")
    def test_returns_false_when_binary_missing(self, mock_run):
        mock_run.side_effect = FileNotFoundError()
        self.assertFalse(svg_material.rasterize_svg_to_png("/in/a.svg", "/out/a.png"))

    @patch("app.services.svg_material.subprocess.run")
    def test_returns_false_on_empty_output(self, mock_run):
        mock_run.return_value = subprocess.CompletedProcess([], 0)
        with patch("os.path.isfile", return_value=True), patch(
            "os.path.getsize", return_value=0
        ):
            self.assertFalse(svg_material.rasterize_svg_to_png("/in/a.svg", "/out/a.png"))


class PersistSvgMaterialTests(unittest.TestCase):

    def setUp(self):
        _patch_asset_resolution(self)
    def test_renders_svg_into_an_mp4(self):
        item = MaterialInfo(provider="svg", url="/cat/a.svg", duration=3)
        with patch.object(svg_material, "_render_drawn_clip", return_value=""), patch.object(
            svg_material, "rasterize_svg_to_png", return_value=True
        ), patch(
            "app.services.image_material.render_image_file_to_mp4", return_value="/out/a.mp4"
        ) as mock_render:
            result = svg_material._persist_svg_item(item, "/save", 3)
        self.assertEqual(result, "/out/a.mp4")
        mock_render.assert_called_once()
        self.assertEqual(mock_render.call_args.kwargs["clip_duration"], 3)

    def test_cache_name_is_derived_from_asset_path_and_aspect(self):
        item = MaterialInfo(provider="svg", url="/cat/a.svg", duration=3)
        with patch.object(svg_material, "_render_drawn_clip", return_value=""), patch.object(
            svg_material, "rasterize_svg_to_png", return_value=True
        ) as mock_ras, patch(
            "app.services.image_material.render_image_file_to_mp4", return_value="/out/a.mp4"
        ):
            svg_material._persist_svg_item(item, "/save", 3, VideoAspect.portrait)
        png_arg = mock_ras.call_args[0][1]
        expected = hashlib.sha256(b"/cat/a.svg|1080x1920").hexdigest()[:16]
        self.assertEqual(os.path.basename(png_arg), f"svg-{expected}.png")
        # The still is fitted to the target canvas before rendering.
        self.assertEqual(mock_ras.call_args[0][2:], (1080, 1920))

    def test_same_asset_in_two_aspects_is_two_cache_entries(self):
        item = MaterialInfo(provider="svg", url="/cat/a.svg", duration=3)
        names = []
        for aspect in (VideoAspect.portrait, VideoAspect.square):
            with patch.object(svg_material, "_render_drawn_clip", return_value=""), patch.object(
                svg_material, "rasterize_svg_to_png", return_value=True
            ) as mock_ras, patch(
                "app.services.image_material.render_image_file_to_mp4", return_value="/out/a.mp4"
            ):
                svg_material._persist_svg_item(item, "/save", 3, aspect)
            names.append(os.path.basename(mock_ras.call_args[0][1]))
        self.assertNotEqual(names[0], names[1])

    def test_rasterize_failure_returns_empty(self):
        item = MaterialInfo(provider="svg", url="/cat/a.svg", duration=3)
        with patch.object(svg_material, "_render_drawn_clip", return_value=""), patch.object(
            svg_material, "rasterize_svg_to_png", return_value=False
        ):
            self.assertEqual(svg_material._persist_svg_item(item, "/save", 3), "")

    def test_render_failure_returns_empty(self):
        item = MaterialInfo(provider="svg", url="/cat/a.svg", duration=3)
        with patch.object(svg_material, "_render_drawn_clip", return_value=""), patch.object(
            svg_material, "rasterize_svg_to_png", return_value=True
        ), patch(
            "app.services.image_material.render_image_file_to_mp4", return_value=""
        ):
            self.assertEqual(svg_material._persist_svg_item(item, "/save", 3), "")


class SvgCanvasBackgroundTests(unittest.TestCase):
    def _background(self, value):
        with patch.object(svg_material.config, "app", {"svg_canvas_background": value}):
            return svg_material._svg_canvas_background()

    def test_parses_six_digit_hex(self):
        self.assertEqual(self._background("#112233"), (17, 34, 51, 255))

    def test_parses_three_digit_hex(self):
        self.assertEqual(self._background("#abc"), (170, 187, 204, 255))

    def test_non_hex_value_falls_back_to_white(self):
        # A 6-char non-hex value used to raise ValueError out of material
        # resolution instead of degrading to white.
        self.assertEqual(self._background("purple"), (255, 255, 255, 255))

    def test_bad_length_falls_back_to_white(self):
        self.assertEqual(self._background("#12345"), (255, 255, 255, 255))


class SvgRasterizeAspectTests(unittest.TestCase):
    """The still must match the target aspect or combine_videos rejects it.

    A 1080x1100 illustration against a 1080x1920 frame is 55% horizontal
    letterbox, over MAX_LETTERBOX_BARS (35%), so it is dropped silently.
    """

    def _make_svg(self, path, width=600, height=600):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as handle:
            handle.write(
                f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" '
                f'height="{height}" viewBox="0 0 {width} {height}">'
                f'<rect width="{width}" height="{height}" fill="#3355ff"/></svg>'
            )

    def test_rasterizes_to_exact_target_canvas(self):
        import tempfile

        from PIL import Image

        tmp = tempfile.mkdtemp()
        svg = os.path.join(tmp, "square.svg")
        png = os.path.join(tmp, "out.png")
        self._make_svg(svg, 600, 600)
        self.assertTrue(
            svg_material.rasterize_svg_to_png(svg, png, target_width=1080, target_height=1920)
        )
        with Image.open(png) as image:
            self.assertEqual(image.size, (1080, 1920))

    def test_square_aspect_keeps_square_canvas(self):
        import tempfile

        from PIL import Image

        tmp = tempfile.mkdtemp()
        svg = os.path.join(tmp, "a.svg")
        png = os.path.join(tmp, "out.png")
        self._make_svg(svg, 600, 600)
        svg_material.rasterize_svg_to_png(svg, png, target_width=1080, target_height=1080)
        with Image.open(png) as image:
            self.assertEqual(image.size, (1080, 1080))

    def test_wide_artwork_is_fitted_not_cropped(self):
        """A very wide illustration keeps its aspect on the portrait canvas.

        The canvas is always exactly target_width x target_height, so the
        bar arithmetic against the canvas size can never fail. What matters
        is the artwork region: it must be fitted (aspect preserved, fully
        visible), not cropped or stretched.
        """
        import tempfile

        import numpy as np
        from PIL import Image

        tmp = tempfile.mkdtemp()
        svg = os.path.join(tmp, "wide.svg")
        png = os.path.join(tmp, "out.png")
        self._make_svg(svg, 1600, 400)  # very wide: worst case for portrait
        self.assertTrue(
            svg_material.rasterize_svg_to_png(svg, png, target_width=1080, target_height=1920)
        )
        arr = np.asarray(Image.open(png).convert("RGB"))
        # Non-white pixels are the fitted artwork (blue rect on white canvas).
        non_white = (np.abs(arr.astype(int) - 255).sum(axis=2) > 24)
        self.assertTrue(non_white.any(), "artwork must be visible on the canvas")
        ys, xs = np.where(non_white)
        art_w, art_h = int(xs.max() - xs.min() + 1), int(ys.max() - ys.min() + 1)
        # Aspect preserved (1600:400 = 4:1) and fitted to the canvas width.
        self.assertAlmostEqual(art_w / art_h, 4.0, delta=0.05)
        self.assertEqual(art_w, 1080)

    def test_no_target_keeps_the_long_edge_default(self):
        import tempfile

        from PIL import Image

        tmp = tempfile.mkdtemp()
        svg = os.path.join(tmp, "a.svg")
        png = os.path.join(tmp, "out.png")
        self._make_svg(svg, 600, 600)
        svg_material.rasterize_svg_to_png(svg, png)
        with Image.open(png) as image:
            self.assertEqual(max(image.size), svg_material._SVG_RASTER_LONG_EDGE)


class ResolveMaterialPathTests(unittest.TestCase):
    """The dispatcher: SVG renders locally, downloads still get screened."""

    def test_svg_branch_never_calls_the_downloader(self):
        item = MaterialInfo(provider="svg", url="/cat/a.svg", duration=3)
        with patch.object(svg_material, "_persist_svg_item", return_value="/out/a.mp4") as mock_p, patch.object(
            video_download, "save_video"
        ) as mock_dl, patch("app.services.face_detect.video_contains_face") as mock_face:
            result = svg_material.resolve_material_path(item, "/save", 3, None)
        self.assertEqual(result, "/out/a.mp4")
        mock_dl.assert_not_called()
        # An illustration has no real face; screening it would drop the catalog.
        mock_face.assert_not_called()
        mock_p.assert_called_once()

    def test_download_branch_runs_face_detection(self):
        item = MaterialInfo(provider="pexels", url="https://x/v.mp4", duration=3)
        with patch.object(video_download, "save_video", return_value="/save/v.mp4"), patch("app.services.face_detect.video_contains_face", return_value=False
        ) as mock_face:
            result = svg_material.resolve_material_path(item, "/save", 3, None)
        self.assertEqual(result, "/save/v.mp4")
        mock_face.assert_called_once_with("/save/v.mp4", force_exclude=None)

    def test_download_branch_drops_face_detected_video(self):
        item = MaterialInfo(provider="pexels", url="https://x/v.mp4", duration=3)
        with patch.object(video_download, "save_video", return_value="/save/v.mp4"), patch("app.services.face_detect.video_contains_face", return_value=True
        ):
            self.assertEqual(svg_material.resolve_material_path(item, "/save", 3, None), "")

    def test_download_failure_returns_empty(self):
        item = MaterialInfo(provider="pexels", url="https://x/v.mp4", duration=3)
        with patch.object(video_download, "save_video", return_value=""):
            self.assertEqual(svg_material.resolve_material_path(item, "/save", 3, None), "")


class BuildSearchVideosSvgRoutingTests(unittest.TestCase):
    def test_svg_is_a_registered_provider(self):
        resolved = material._build_search_videos("svg", None)
        self.assertIs(resolved, svg_material.search_videos_svg)

    def test_source_mix_can_chain_svg(self):
        def fake_svg(*args, **kwargs):
            return []

        def fake_pexels(*args, **kwargs):
            return []

        with patch.object(svg_material, "search_videos_svg", fake_svg), patch.object(
            material, "search_videos_pexels", fake_pexels
        ):
            resolved = material._build_search_videos("pexels", None, ["svg", "pexels"])
            self.assertEqual(resolved("money", 3), [])


class SvgCatalogCascadeTests(unittest.TestCase):
    """get_video_materials always passes a stock source_mix; an enabled
    catalog must still be searched, first."""

    def _search(self, catalog_enabled):
        calls = []

        def fake(name, items):
            def search(*args, **kwargs):
                calls.append(name)
                return items

            return search

        hit = [MaterialInfo(provider="svg", url="a.svg", duration=3)]
        with patch.object(
            svg_catalog.config,
            "app",
            {"svg_catalog_enabled": catalog_enabled, "svg_r2_prefix": "p"},
        ), patch.object(svg_material, "search_videos_svg", fake("svg", hit)), patch.object(
            material, "search_videos_pexels", fake("pexels", [])
        ), patch.object(
            material, "search_videos_pixabay", fake("pixabay", [])
        ):
            resolved = material._build_search_videos(
                "pexels", VideoAspect.portrait, ["pixabay", "pexels"]
            )
            items = resolved("money", 3)
        return calls, items

    def test_enabled_catalog_is_searched_before_stock(self):
        calls, items = self._search(True)
        self.assertEqual(calls, ["svg"])
        self.assertEqual(items[0].provider, "svg")

    def test_disabled_catalog_is_never_searched(self):
        calls, _ = self._search(False)
        self.assertEqual(calls, ["pixabay", "pexels"])


class RenderImageFileToMp4ErrorTests(unittest.TestCase):
    """The still-to-clip error paths return "" instead of raising.

    These pin the cleanup contract: the finally block must tolerate a clip
    that was never constructed (the original UnboundLocalError), so an
    unreadable image can never crash the material phase.
    """

    @patch("app.services.video._open_image_clip_with_fallback")
    def test_unreadable_image_returns_empty(self, mock_open):
        from app.services import image_material

        mock_open.side_effect = OSError("no such file")
        self.assertEqual(image_material.render_image_file_to_mp4("/nope.png"), "")


class PersistSvgItemTests(unittest.TestCase):
    """The SVG still/clip cache never lands in the process CWD.

    With the default config ``material_directory`` is "", and save_video
    handles that by falling back to utils.storage_dir("cache_videos"); the
    SVG branch must do the same instead of writing CWD-relative paths.
    """

    def setUp(self):
        _patch_asset_resolution(self)

    def _item(self):
        return MaterialInfo(provider="svg", url="/cache/hen.svg", duration=4)

    def _render(self, item, save_dir, storage_root):
        captured = {}
        storage_cache = os.path.join(storage_root, "cache_videos")

        def fake_rasterize(svg_path, png_path, *args, **kwargs):
            captured["png_path"] = png_path
            with open(png_path, "wb") as handle:
                handle.write(b"png")
            return True

        def fake_render(png_path, clip_duration=4):
            captured["render_input"] = png_path
            return png_path + ".mp4"

        with patch.object(
            svg_material.utils, "storage_dir", return_value=storage_cache
        ), patch.object(
            svg_material, "rasterize_svg_to_png", side_effect=fake_rasterize
        ), patch.object(
            svg_material.image_material,
            "render_image_file_to_mp4",
            side_effect=fake_render,
        ):
            result = svg_material._persist_svg_item(
                item, save_dir, 4, VideoAspect.portrait
            )
        return result, captured, storage_cache

    def test_empty_save_dir_uses_storage_cache(self):
        with tempfile.TemporaryDirectory() as storage_root:
            result, captured, storage_cache = self._render(
                self._item(), "", storage_root
            )
        self.assertTrue(os.path.isabs(captured["png_path"]), captured["png_path"])
        self.assertEqual(
            os.path.dirname(captured["png_path"]), storage_cache
        )
        self.assertTrue(os.path.isabs(result), result)
        self.assertEqual(captured["render_input"], captured["png_path"])

    def test_empty_save_dir_creates_the_cache_directory(self):
        with tempfile.TemporaryDirectory() as storage_root:
            missing = os.path.join(storage_root, "does-not-exist")
            with patch.object(
                svg_material.utils, "storage_dir", return_value=missing
            ), patch.object(
                svg_material, "rasterize_svg_to_png", return_value=True
            ), patch.object(
                svg_material.image_material,
                "render_image_file_to_mp4",
                return_value="/x.mp4",
            ):
                svg_material._persist_svg_item(
                    self._item(), "", 4, VideoAspect.portrait
                )
            self.assertTrue(os.path.isdir(missing))

    def test_explicit_save_dir_is_used_as_is(self):
        with tempfile.TemporaryDirectory() as save_dir:
            result, captured, _ = self._render(self._item(), save_dir, save_dir)
        self.assertEqual(os.path.dirname(captured["png_path"]), save_dir)
        self.assertTrue(os.path.isabs(result))

    @patch("app.services.video._open_image_clip_with_fallback")
    @patch("app.services.video.close_clip")
    def test_tiny_image_returns_empty(self, mock_close, mock_open):
        from app.services import image_material

        probe = Mock()
        probe.size = (100, 100)
        mock_open.return_value = (probe,)
        self.assertEqual(image_material.render_image_file_to_mp4("/tiny.png"), "")
        mock_close.assert_called_with(probe)

    @patch("app.services.image_material.ImageClip")
    @patch("app.services.video._open_image_clip_with_fallback")
    @patch("app.services.video.close_clip")
    def test_clip_construction_failure_returns_empty(
        self, mock_close, mock_open, mock_clip_class
    ):
        from app.services import image_material

        probe = Mock()
        probe.size = (800, 600)
        mock_open.return_value = (probe,)
        # ImageClip raises before assignment: the finally block must not
        # raise UnboundLocalError for the unbound `clip`/`final_clip` names.
        mock_clip_class.side_effect = RuntimeError("broken image")
        self.assertEqual(image_material.render_image_file_to_mp4("/bad.png"), "")
        # The probe handle is still released.
        mock_close.assert_any_call(probe)


class LineArtTravelTests(unittest.TestCase):
    """SVG-unit stroke lengths become on-screen pencil travel in canvas px."""

    def _root(self, attrs: str, inner: str):
        return ET.fromstring(
            f'<svg xmlns="http://www.w3.org/2000/svg" {attrs}>{inner}</svg>'
        )

    def test_travel_scales_units_through_render_and_fit(self):
        root = self._root(
            'viewBox="0 0 200 200"',
            '<path d="M0 0 L100 0" stroke="#111"/>',
        )
        # 100 units x (700/200 render) x min(1080*.85/700, 1920*.7/700 fit)
        expected = 100 * 3.5 * min(1080 * 0.85 / 700, 1920 * 0.7 / 700)
        self.assertAlmostEqual(
            svg_material._line_art_travel_px(root, 1080, 1920), expected
        )

    def test_dimensions_fall_back_to_width_height_attributes(self):
        root = self._root(
            'width="400" height="400"',
            '<path d="M0 0 L100 0" stroke="#111"/>',
        )
        expected = 100 * (700 / 400) * min(1080 * 0.85 / 700, 1920 * 0.7 / 700)
        self.assertAlmostEqual(
            svg_material._line_art_travel_px(root, 1080, 1920), expected
        )

    def test_unmeasurable_dimensions_give_zero(self):
        root = self._root("", '<path d="M0 0 L100 0" stroke="#111"/>')
        self.assertEqual(svg_material._line_art_travel_px(root, 1080, 1920), 0.0)

    def test_complex_art_draws_longer_than_simple_art(self):
        simple = self._root(
            'viewBox="0 0 200 200"',
            '<path d="M20 100 L180 100" stroke="#111"/>',
        )
        complex_ = self._root(
            'viewBox="0 0 200 200"',
            '<circle cx="100" cy="100" r="80" stroke="#111"/>'
            '<path d="M20 180 L100 20 L180 180 Z" stroke="#111"/>'
            '<rect x="40" y="40" width="120" height="120" stroke="#111"/>',
        )
        self.assertGreater(
            svg_sketch.draw_frame_count(
                svg_material._line_art_travel_px(complex_, 1080, 1920)
            ),
            svg_sketch.draw_frame_count(
                svg_material._line_art_travel_px(simple, 1080, 1920)
            ),
        )


class AnimatedSvgMaterialTests(unittest.TestCase):
    """The pencil-drawn clip is preferred; the static still is the fallback."""

    def setUp(self):
        _patch_asset_resolution(self)

    def _item(self):
        return MaterialInfo(provider="svg", url="/cat/a.svg", duration=3)

    def _frames(self, count):
        return [np.zeros((8, 8, 3), np.uint8) for _ in range(count)]

    def test_prefers_drawn_clip_over_static_still(self):
        with patch.object(
            svg_material, "_render_drawn_clip", return_value="/out/drawn.mp4"
        ) as mock_drawn, patch.object(
            svg_material, "rasterize_svg_to_png"
        ) as mock_rasterize:
            result = svg_material._persist_svg_item(self._item(), "/save", 3)
        self.assertEqual(result, "/out/drawn.mp4")
        mock_drawn.assert_called_once()
        mock_rasterize.assert_not_called()

    def test_falls_back_to_static_when_drawn_clip_fails(self):
        with patch.object(svg_material, "_render_drawn_clip", return_value=""), patch.object(
            svg_material, "rasterize_svg_to_png", return_value=True
        ), patch(
            "app.services.image_material.render_image_file_to_mp4",
            return_value="/out/static.mp4",
        ):
            result = svg_material._persist_svg_item(self._item(), "/save", 3)
        self.assertEqual(result, "/out/static.mp4")

    def test_drawn_cache_key_differs_from_static_still(self):
        # The animated clip must never reuse a Ken Burns still cache entry.
        item = self._item()
        with patch.object(
            svg_material, "_render_drawn_clip", return_value="/out/drawn.mp4"
        ) as mock_drawn:
            svg_material._persist_svg_item(item, "/save", 3, VideoAspect.portrait)
        mp4_arg = mock_drawn.call_args[0][1]
        static_digest = hashlib.sha256(b"/cat/a.svg|1080x1920").hexdigest()[:16]
        self.assertNotIn(static_digest, os.path.basename(mp4_arg))
        self.assertTrue(os.path.basename(mp4_arg).startswith("svg-drawn-"))

    def test_render_drawn_clip_uses_sketch_path_for_embedded_raster(self):
        frames = self._frames(4)
        with patch.object(
            svg_pencil, "load_sprite", return_value=("sprite", (1.0, 2.0))
        ), patch.object(
            svg_sketch, "render_sketch_clip", return_value=frames
        ) as mock_sketch, patch.object(
            svg_sketch, "write_clip", return_value="/out/x.mp4"
        ) as mock_write:
            result = svg_material._render_drawn_clip(
                "/cat/a.svg", "/out/x.mp4", 1080, 1920, 3, (255, 255, 255)
            )
        self.assertEqual(result, "/out/x.mp4")
        mock_sketch.assert_called_once()
        # A short performance is held on its last frame up to the clip length.
        written = mock_write.call_args[0][0]
        self.assertEqual(len(written), 3 * svg_sketch.DRAW_FPS)

    def test_render_drawn_clip_uses_line_art_path_without_embedded_raster(self):
        frames = self._frames(4)
        with patch.object(
            svg_pencil, "load_sprite", return_value=("sprite", (1.0, 2.0))
        ), patch.object(
            svg_sketch, "render_sketch_clip", return_value=None
        ), patch.object(
            svg_draw, "is_drawable", return_value=True
        ), patch.object(
            svg_material, "_drawn_line_art_frames", return_value=frames
        ) as mock_frames, patch.object(
            svg_sketch, "write_clip", return_value="/out/x.mp4"
        ):
            result = svg_material._render_drawn_clip(
                "/cat/a.svg", "/out/x.mp4", 1080, 1920, 3, (255, 255, 255)
            )
        self.assertEqual(result, "/out/x.mp4")
        mock_frames.assert_called_once()

    def test_render_drawn_clip_returns_empty_when_not_animatable(self):
        with patch.object(
            svg_pencil, "load_sprite", return_value=("sprite", (1.0, 2.0))
        ), patch.object(svg_sketch, "render_sketch_clip", return_value=None), patch.object(
            svg_draw, "is_drawable", return_value=False
        ):
            self.assertEqual(
                svg_material._render_drawn_clip(
                    "/cat/a.svg", "/out/x.mp4", 1080, 1920, 3, (255, 255, 255)
                ),
                "",
            )

    def test_render_drawn_clip_returns_empty_when_sprite_fails(self):
        with patch.object(svg_pencil, "load_sprite", return_value=None), patch.object(
            svg_sketch, "render_sketch_clip"
        ) as mock_sketch:
            self.assertEqual(
                svg_material._render_drawn_clip(
                    "/cat/a.svg", "/out/x.mp4", 1080, 1920, 3, (255, 255, 255)
                ),
                "",
            )
        mock_sketch.assert_not_called()

    def test_render_drawn_clip_returns_empty_when_write_fails(self):
        with patch.object(
            svg_pencil, "load_sprite", return_value=("sprite", (1.0, 2.0))
        ), patch.object(
            svg_sketch, "render_sketch_clip", return_value=self._frames(2)
        ), patch.object(
            svg_sketch, "write_clip", side_effect=OSError("disk full")
        ), patch("loguru.logger.warning"):
            self.assertEqual(
                svg_material._render_drawn_clip(
                    "/cat/a.svg", "/out/x.mp4", 1080, 1920, 3, (255, 255, 255)
                ),
                "",
            )

    def test_render_drawn_clip_returns_empty_when_ffmpeg_fails(self):
        # write_clip runs ffmpeg with check=True: a non-zero exit is a
        # CalledProcessError, which must fall back like any write failure.
        with patch.object(
            svg_pencil, "load_sprite", return_value=("sprite", (1.0, 2.0))
        ), patch.object(
            svg_sketch, "render_sketch_clip", return_value=self._frames(2)
        ), patch.object(
            svg_sketch,
            "write_clip",
            side_effect=subprocess.CalledProcessError(1, ["ffmpeg"]),
        ), patch("loguru.logger.warning") as mock_warning:
            self.assertEqual(
                svg_material._render_drawn_clip(
                    "/cat/a.svg", "/out/x.mp4", 1080, 1920, 3, (255, 255, 255)
                ),
                "",
            )
        mock_warning.assert_called_once()

    def test_ffmpeg_failure_falls_back_to_the_static_still(self):
        with patch.object(
            svg_pencil, "load_sprite", return_value=("sprite", (1.0, 2.0))
        ), patch.object(
            svg_sketch, "render_sketch_clip", return_value=self._frames(2)
        ), patch.object(
            svg_sketch,
            "write_clip",
            side_effect=subprocess.CalledProcessError(1, ["ffmpeg"]),
        ), patch.object(
            svg_material, "rasterize_svg_to_png", return_value=True
        ), patch(
            "app.services.image_material.render_image_file_to_mp4",
            return_value="/out/static.mp4",
        ), patch("loguru.logger.warning"):
            result = svg_material._persist_svg_item(self._item(), "/save", 3)
        self.assertEqual(result, "/out/static.mp4")

    def test_render_drawn_clip_speeds_up_a_draw_longer_than_the_clip(self):
        # A 4s draw in a 2s clip must not exceed the clip: combine_videos
        # would cut it into segments and scramble or truncate the drawing.
        frames = [np.full((8, 8, 3), i % 256, np.uint8) for i in range(120)]
        with patch.object(
            svg_pencil, "load_sprite", return_value=("sprite", (1.0, 2.0))
        ), patch.object(
            svg_sketch, "render_sketch_clip", return_value=frames
        ), patch.object(
            svg_sketch, "write_clip", return_value="/out/x.mp4"
        ) as mock_write:
            svg_material._render_drawn_clip(
                "/cat/a.svg", "/out/x.mp4", 1080, 1920, 2, (255, 255, 255)
            )
        written = mock_write.call_args[0][0]
        self.assertEqual(len(written), 2 * svg_sketch.DRAW_FPS)
        self.assertIs(written[-1], frames[-1])

    def test_render_drawn_clip_passes_the_canvas_colour_to_the_sketch(self):
        with patch.object(
            svg_pencil, "load_sprite", return_value=("sprite", (1.0, 2.0))
        ), patch.object(
            svg_sketch, "render_sketch_clip", return_value=self._frames(2)
        ) as mock_sketch, patch.object(
            svg_sketch, "write_clip", return_value="/out/x.mp4"
        ):
            svg_material._render_drawn_clip(
                "/cat/a.svg", "/out/x.mp4", 1080, 1920, 3, (10, 20, 30)
            )
        self.assertEqual(mock_sketch.call_args.kwargs["background"], (10, 20, 30))

    def test_drawn_cache_key_includes_the_clip_length(self):
        # The clip length is baked into the frames: a 2s clip must never be
        # reused for a task that asked for 8s clips.
        names = []
        for duration in (2, 8):
            with patch.object(
                svg_material, "_render_drawn_clip", return_value="/out/drawn.mp4"
            ) as mock_drawn:
                svg_material._persist_svg_item(self._item(), "/save", duration)
            names.append(os.path.basename(mock_drawn.call_args[0][1]))
        self.assertNotEqual(names[0], names[1])

    def test_drawn_cache_key_includes_the_canvas_colour(self):
        names = []
        for colour in ("#FFFFFF", "#000000"):
            with patch.object(
                svg_material.config, "app", {"svg_canvas_background": colour}
            ), patch.object(
                svg_material, "_render_drawn_clip", return_value="/out/drawn.mp4"
            ) as mock_drawn:
                svg_material._persist_svg_item(self._item(), "/save", 3)
            names.append(os.path.basename(mock_drawn.call_args[0][1]))
        self.assertNotEqual(names[0], names[1])

    def test_drawn_cache_hit_does_not_fetch_the_artwork(self):
        with tempfile.TemporaryDirectory() as save_dir:
            with patch.object(
                svg_material, "_render_drawn_clip", return_value=""
            ) as mock_drawn, patch.object(
                svg_material, "rasterize_svg_to_png", return_value=False
            ):
                svg_material._persist_svg_item(self._item(), save_dir, 3)
            cached = mock_drawn.call_args[0][1]
            with open(cached, "wb") as handle:
                handle.write(b"mp4")
            self.resolve_asset_path.reset_mock()
            result = svg_material._persist_svg_item(self._item(), save_dir, 3)
        self.assertEqual(result, cached)
        self.resolve_asset_path.assert_not_called()

    def test_render_resolves_the_catalog_path_before_drawing(self):
        self.resolve_asset_path.side_effect = lambda path: "/cache/" + path
        item = MaterialInfo(provider="svg", url="Animals/a.svg", duration=3)
        with patch.object(
            svg_material, "_render_drawn_clip", return_value="/out/drawn.mp4"
        ) as mock_drawn:
            svg_material._persist_svg_item(item, "/save", 3)
        self.resolve_asset_path.assert_called_once_with("Animals/a.svg")
        self.assertEqual(mock_drawn.call_args[0][0], "/cache/Animals/a.svg")

    def test_missing_asset_raises_for_the_caller_to_skip(self):
        self.resolve_asset_path.side_effect = FileNotFoundError("gone")
        with self.assertRaises(FileNotFoundError):
            svg_material._persist_svg_item(self._item(), "/save", 3)

    def test_drawn_line_art_canvas_uses_the_given_colour(self):
        rendered = np.zeros((10, 10, 4), np.uint8)
        canvas, _ = svg_material._frame_to_canvas(rendered, 40, 80, (10, 20, 30))
        self.assertEqual(tuple(canvas[0, 0]), (10, 20, 30))

    def test_canvas_colour_is_converted_to_bgr(self):
        with patch.object(
            svg_material.config, "app", {"svg_canvas_background": "#102030"}
        ):
            self.assertEqual(
                svg_material._svg_canvas_background_bgr(), (0x30, 0x20, 0x10)
            )

    def test_line_art_renders_at_most_max_frames(self):
        def fake_run(argv, **kwargs):
            import cv2

            cv2.imwrite(argv[argv.index("-o") + 1], np.zeros((10, 10, 3), np.uint8))
            return Mock(returncode=0)

        with tempfile.TemporaryDirectory() as tmp:
            svg_path = os.path.join(tmp, "one.svg")
            with open(svg_path, "w", encoding="utf-8") as handle:
                handle.write(
                    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">'
                    '<path d="M2 2 L18 2" fill="none" stroke="#111" stroke-width="2"/>'
                    "</svg>"
                )
            with patch("subprocess.run", side_effect=fake_run) as mock_run:
                frames = svg_material._drawn_line_art_frames(
                    svg_path,
                    np.zeros((8, 8, 4), np.uint8),
                    (1.0, 2.0),
                    width=1080,
                    height=1920,
                    background=(252, 252, 252),
                    max_frames=5,
                )
        self.assertEqual(len(frames), 5)
        self.assertEqual(mock_run.call_count, 5)

    def test_drawn_line_art_frames_renders_staggered_progress(self):
        # A tiny two-stroke SVG: the mock rasterizer snapshots each frame's
        # SVG so the test can assert the dashoffset actually walks.
        seen = []

        def fake_run(argv, **kwargs):
            src = argv[-1]
            with open(src, "rb") as handle:
                seen.append(handle.read())
            import cv2

            cv2.imwrite(argv[argv.index("-o") + 1], np.zeros((10, 10, 3), np.uint8))
            return Mock(returncode=0)

        with tempfile.TemporaryDirectory() as tmp:
            svg_path = os.path.join(tmp, "two.svg")
            with open(svg_path, "w", encoding="utf-8") as handle:
                handle.write(
                    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20">'
                    '<path d="M2 2 L18 2" fill="none" stroke="#111" stroke-width="2"/>'
                    '<path d="M2 18 L18 18" fill="none" stroke="#111" stroke-width="2"/>'
                    "</svg>"
                )
            sprite = np.zeros((8, 8, 4), np.uint8)
            root = ET.parse(svg_path).getroot()
            expected = svg_sketch.draw_frame_count(
                svg_material._line_art_travel_px(root, 1080, 1920)
            )
            with patch("subprocess.run", side_effect=fake_run):
                frames = svg_material._drawn_line_art_frames(
                    svg_path,
                    sprite,
                    (1.0, 2.0),
                    width=1080,
                    height=1920,
                    background=(252, 252, 252),
                    max_frames=1000,
                )
        # The frame count is derived from the measured stroke length.
        self.assertEqual(len(frames), expected)
        # First frame draws nothing, last frame draws everything.
        self.assertNotEqual(seen[0], seen[-1])
        for frame in frames:
            self.assertEqual(frame.shape, (1920, 1080, 3))

    def test_drawn_line_art_final_frame_has_no_pencil(self):
        """The completed tracing is shown clean, like the sketch path.

        Uses the real rasterizer and the real pencil sprite: the hold in a
        drawn clip repeats the final frame, so it must not carry the pencil.
        Yellow detection (BGR order) works because the fixture art is black
        on white — yellow can only be the pencil body.
        """
        import cv2

        from app.services import svg_pencil

        with tempfile.TemporaryDirectory() as tmp:
            pencil_svg = os.path.join(tmp, "pencil.svg")
            pencil_path = os.path.join(tmp, "pencil.png")
            svg_pencil.build_pencil_svg(output_path=pencil_svg)
            subprocess.run(
                ["rsvg-convert", "-w", "460", "-o", pencil_path, pencil_svg],
                check=True,
                capture_output=True,
            )
            pencil_png = cv2.imread(pencil_path, cv2.IMREAD_UNCHANGED)
            svg_path = os.path.join(tmp, "two.svg")
            with open(svg_path, "w", encoding="utf-8") as handle:
                handle.write(
                    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">'
                    '<path d="M10 60 L190 60" fill="none" stroke="#111" stroke-width="6"/>'
                    '<path d="M10 140 L190 140" fill="none" stroke="#111" stroke-width="6"/>'
                    "</svg>"
                )
            frames = svg_material._drawn_line_art_frames(
                svg_path,
                pencil_png,
                svg_pencil.pencil_tip_in_sprite(460),
                width=540,
                height=960,
                background=(255, 255, 255),
                max_frames=1000,
            )
            root = ET.parse(svg_path).getroot()
            expected = svg_sketch.draw_frame_count(
                svg_material._line_art_travel_px(root, 540, 960)
            )

        def pencil_yellow(frame):
            b, g, r = (frame[..., i].astype(np.int16) for i in range(3))
            return int(((r > 150) & (g > 100) & (b < 130) & (r > b + 60)).sum())

        self.assertEqual(len(frames), expected)
        self.assertGreater(pencil_yellow(frames[-2]), 0, "pencil missing mid-draw")
        self.assertEqual(pencil_yellow(frames[-1]), 0, "pencil left on the finished drawing")


if __name__ == "__main__":
    unittest.main()