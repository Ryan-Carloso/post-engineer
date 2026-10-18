"""Tests for the hand-drawn line-art icons in app/services/line_art.py."""
import unittest
import xml.etree.ElementTree as ET

from app.services import line_art


class IconSvgTests(unittest.TestCase):
    def test_renders_a_standalone_svg_document(self):
        doc = line_art.icon_svg("clock")
        self.assertTrue(doc.startswith("<svg"))
        self.assertIn("</svg>", doc)
        self.assertIn('xmlns="http://www.w3.org/2000/svg"', doc)

    def test_default_size_is_900(self):
        doc = line_art.icon_svg("clock")
        self.assertIn('width="900"', doc)
        self.assertIn('height="900"', doc)

    def test_custom_size(self):
        doc = line_art.icon_svg("clock", size=700)
        self.assertIn('width="700"', doc)
        self.assertIn('height="700"', doc)

    def test_unknown_icon_raises_key_error(self):
        with self.assertRaises(KeyError):
            line_art.icon_svg("nope")

    def test_every_catalog_icon_renders_valid_svg(self):
        for name in line_art.ICONS:
            doc = line_art.icon_svg(name)
            root = ET.fromstring(doc)
            self.assertTrue(len(root) > 0, f"{name} has no shapes")

    def test_icons_use_stroke_only(self):
        # The draw-on animation traces strokes; a filled icon would not draw.
        for name, icon in line_art.ICONS.items():
            self.assertIn('fill="none"', icon["body"], name)


if __name__ == "__main__":
    unittest.main()
