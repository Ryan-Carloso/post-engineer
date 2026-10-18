"""Tests for the SVG path geometry in app/services/svg_draw.py."""
import math
import unittest

from app.services import svg_draw


class FlattenMovetoTests(unittest.TestCase):
    def test_multi_pair_moveto_closes_to_first_point(self):
        # Per the SVG spec, coordinate pairs after the first in M/m are
        # implicit linetos; a following Z must close to the initial moveto
        # point, not to the last implicit lineto.
        points = svg_draw._flatten("M 10 20 30 40 Z")
        self.assertEqual(points[0], (10.0, 20.0))
        self.assertEqual(points[1], (30.0, 40.0))
        self.assertEqual(points[-1], (10.0, 20.0))

    def test_second_subpath_gets_its_own_start(self):
        points = svg_draw._flatten("M 0 0 L 5 5 M 10 20 30 40 Z")
        self.assertEqual(points[-1], (10.0, 20.0))

    def test_path_length_counts_the_closing_segment(self):
        # Two legs of the triangle: (10,20)->(30,40)->(10,20).
        length = svg_draw.path_length("M 10 20 30 40 Z")
        self.assertAlmostEqual(length, 2 * math.hypot(20, 20), places=6)


if __name__ == "__main__":
    unittest.main()
