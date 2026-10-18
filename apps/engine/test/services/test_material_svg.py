"""Tests for the SVG branch of the material pipeline."""
import hashlib
import os
import subprocess
import tempfile
import unittest
from unittest.mock import Mock, patch

from app.models.schema import MaterialInfo, VideoAspect
from app.services import material, svg_material


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
                    "absolute_path": "/tmp/a.svg",
                    "title": "Hen",
                    "asset_id": "4:1",
                },
            )()
        ]
        items = svg_material.search_videos_svg("money", 4)
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0].provider, "svg")
        self.assertEqual(items[0].url, "/tmp/a.svg")
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
    def test_renders_svg_into_an_mp4(self):
        item = MaterialInfo(provider="svg", url="/cat/a.svg", duration=3)
        with patch.object(svg_material, "rasterize_svg_to_png", return_value=True), patch(
            "app.services.image_material.render_image_file_to_mp4", return_value="/out/a.mp4"
        ) as mock_render:
            result = svg_material._persist_svg_item(item, "/save", 3)
        self.assertEqual(result, "/out/a.mp4")
        mock_render.assert_called_once()
        self.assertEqual(mock_render.call_args.kwargs["clip_duration"], 3)

    def test_cache_name_is_derived_from_asset_path_and_aspect(self):
        item = MaterialInfo(provider="svg", url="/cat/a.svg", duration=3)
        with patch.object(svg_material, "rasterize_svg_to_png", return_value=True) as mock_ras, patch(
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
            with patch.object(svg_material, "rasterize_svg_to_png", return_value=True) as mock_ras, patch(
                "app.services.image_material.render_image_file_to_mp4", return_value="/out/a.mp4"
            ):
                svg_material._persist_svg_item(item, "/save", 3, aspect)
            names.append(os.path.basename(mock_ras.call_args[0][1]))
        self.assertNotEqual(names[0], names[1])

    def test_rasterize_failure_returns_empty(self):
        item = MaterialInfo(provider="svg", url="/cat/a.svg", duration=3)
        with patch.object(svg_material, "rasterize_svg_to_png", return_value=False):
            self.assertEqual(svg_material._persist_svg_item(item, "/save", 3), "")

    def test_render_failure_returns_empty(self):
        item = MaterialInfo(provider="svg", url="/cat/a.svg", duration=3)
        with patch.object(svg_material, "rasterize_svg_to_png", return_value=True), patch(
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
            material, "save_video"
        ) as mock_dl, patch("app.services.face_detect.video_contains_face") as mock_face:
            result = svg_material.resolve_material_path(item, "/save", 3, None)
        self.assertEqual(result, "/out/a.mp4")
        mock_dl.assert_not_called()
        # An illustration has no real face; screening it would drop the catalog.
        mock_face.assert_not_called()
        mock_p.assert_called_once()

    def test_download_branch_runs_face_detection(self):
        item = MaterialInfo(provider="pexels", url="https://x/v.mp4", duration=3)
        with patch.object(material, "save_video", return_value="/save/v.mp4"), patch("app.services.face_detect.video_contains_face", return_value=False
        ) as mock_face:
            result = svg_material.resolve_material_path(item, "/save", 3, None)
        self.assertEqual(result, "/save/v.mp4")
        mock_face.assert_called_once_with("/save/v.mp4", force_exclude=None)

    def test_download_branch_drops_face_detected_video(self):
        item = MaterialInfo(provider="pexels", url="https://x/v.mp4", duration=3)
        with patch.object(material, "save_video", return_value="/save/v.mp4"), patch("app.services.face_detect.video_contains_face", return_value=True
        ):
            self.assertEqual(svg_material.resolve_material_path(item, "/save", 3, None), "")

    def test_download_failure_returns_empty(self):
        item = MaterialInfo(provider="pexels", url="https://x/v.mp4", duration=3)
        with patch.object(material, "save_video", return_value=""):
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


if __name__ == "__main__":
    unittest.main()