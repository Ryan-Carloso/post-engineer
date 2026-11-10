"""neutral_background: the plain canvas under the agent's segment photos.

The neutral PNG/clip renderer is shared with the images mode
(faceless_material.images_canvas) (issue #542).
"""

import os
import unittest
from unittest.mock import patch

from app.models.schema import VideoAspect
from app.services.neutral_background import render_neutral_clip, render_neutral_png


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
