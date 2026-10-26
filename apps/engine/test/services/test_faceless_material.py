import os
import unittest
from unittest.mock import patch

import pydantic
from PIL import Image

from app.models.schema import VideoAspect, VideoParams
from app.services import faceless_material as fm


class TestFacelessMaterialSources(unittest.TestCase):
    def test_svg_source_order_is_catalog_only(self):
        order = fm.svg_source_order()
        self.assertEqual(order, ["svg"])
        self.assertNotIn("pexels", order)
        self.assertNotIn("pixabay", order)
        self.assertNotIn("coverr", order)

    def test_svg_source_order_returns_a_copy(self):
        order = fm.svg_source_order()
        order.append("pexels")
        self.assertEqual(fm.svg_source_order(), ["svg"])


class TestFacelessMaterialSchema(unittest.TestCase):
    def test_default_is_broll(self):
        self.assertEqual(VideoParams(video_subject="x").faceless_material, "broll")

    def test_svg_is_accepted(self):
        params = VideoParams(video_subject="x", faceless_material="svg")
        self.assertEqual(params.faceless_material, "svg")

    def test_unknown_material_is_rejected(self):
        with self.assertRaises(pydantic.ValidationError):
            VideoParams(video_subject="x", faceless_material="stock")


class TestNeutralClip(unittest.TestCase):
    def test_neutral_clip_renders_gradient_still_and_returns_clip(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            with (
                patch.object(fm.utils, "task_dir", return_value=tmp),
                patch(
                    "app.services.image_material.render_image_file_to_mp4",
                    return_value=os.path.join(tmp, "neutral.mp4"),
                ) as render,
            ):
                result = fm.neutral_clip_path("t1", 10.0, VideoAspect.portrait)
            self.assertEqual(result, os.path.join(tmp, "neutral.mp4"))
            png_path = os.path.join(tmp, "neutral.png")
            self.assertTrue(os.path.isfile(png_path))
            with Image.open(png_path) as image:
                self.assertEqual(image.size, (1080, 1920))
                top = image.getpixel((540, 0))
                bottom = image.getpixel((540, 1919))
            self.assertTrue(sum(top) > sum(bottom))
            render.assert_called_once()

    def test_neutral_clip_failure_returns_empty(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            with (
                patch.object(fm.utils, "task_dir", return_value=tmp),
                patch(
                    "app.services.image_material.render_image_file_to_mp4",
                    return_value="",
                ),
            ):
                self.assertEqual(
                    fm.neutral_clip_path("t1", 10.0, VideoAspect.portrait), ""
                )


if __name__ == "__main__":
    unittest.main()
