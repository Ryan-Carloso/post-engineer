import unittest

from app.services import faceless_material as fm


class TestImagesMaterial(unittest.TestCase):
    def test_images_constant_is_the_schema_literal(self):
        self.assertEqual(fm.IMAGES, "images")

    def test_canvas_is_one_neutral_clip_sized_to_the_whole_audio(self):
        from unittest.mock import patch

        with patch(
            "app.services.neutral_background.render_neutral_clip", return_value="/t/neutral.mp4"
        ) as render:
            self.assertEqual(fm.images_canvas("/t", 31.2, "9:16"), ["/t/neutral.mp4"])
        render.assert_called_once_with("/t", 32, "9:16")

    def test_canvas_that_cannot_render_is_empty(self):
        from unittest.mock import patch

        with patch("app.services.neutral_background.render_neutral_clip", return_value=""):
            self.assertEqual(fm.images_canvas("/t", 10.0, "9:16"), [])
