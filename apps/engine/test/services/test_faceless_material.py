import unittest

import pydantic

from app.models.schema import VideoParams
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


if __name__ == "__main__":
    unittest.main()
