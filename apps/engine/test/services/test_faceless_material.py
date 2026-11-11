import unittest

import pydantic

from app.models.schema import VideoParams
from app.services import faceless_material as fm


class TestFacelessMaterialSchema(unittest.TestCase):
    def test_default_is_images(self):
        self.assertEqual(VideoParams(video_subject="x").faceless_material, "images")

    def test_svg_is_rejected(self):
        with self.assertRaises(pydantic.ValidationError):
            VideoParams(video_subject="x", faceless_material="svg")

    def test_broll_is_rejected(self):
        with self.assertRaises(pydantic.ValidationError):
            VideoParams(video_subject="x", faceless_material="broll")

    def test_unknown_material_is_rejected(self):
        with self.assertRaises(pydantic.ValidationError):
            VideoParams(video_subject="x", faceless_material="stock")


if __name__ == "__main__":
    unittest.main()


class TestImagesMaterial(unittest.TestCase):
    def test_images_is_accepted(self):
        self.assertEqual(VideoParams(video_subject="x", faceless_material="images").faceless_material, "images")

    def test_images_constant_is_the_schema_literal(self):
        self.assertEqual(fm.IMAGES, "images")

    def test_canvas_is_one_neutral_clip_sized_to_the_whole_audio(self):
        from unittest.mock import patch

        with patch("app.services.neutral_background.render_neutral_clip", return_value="/t/neutral.mp4") as render:
            self.assertEqual(fm.images_canvas("/t", 31.2, "9:16"), ["/t/neutral.mp4"])
        render.assert_called_once_with("/t", 32, "9:16")

    def test_canvas_that_cannot_render_is_empty(self):
        from unittest.mock import patch

        with patch("app.services.neutral_background.render_neutral_clip", return_value=""):
            self.assertEqual(fm.images_canvas("/t", 10.0, "9:16"), [])
