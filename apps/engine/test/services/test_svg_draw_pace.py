"""Pin the fast draw pace: the draw finishes in roughly the first half
of a typical 4-second segment, then the finished artwork holds.

Kept in its own small file so the grandfathered test_svg_sketch.py does
not grow: these absolute values fail on the old pace (2750 px took
2.5 s at 1100 px/s, and the old ceiling was 4.0 s).
"""

import unittest

from app.services import svg_sketch


class FastDrawPaceTests(unittest.TestCase):
    def test_draw_is_twice_as_fast_as_the_original_pace(self):
        self.assertEqual(svg_sketch.PENCIL_SPEED_PX_PER_SECOND, 2200.0)
        self.assertEqual(svg_sketch.DRAW_MIN_SECONDS, 0.75)
        self.assertEqual(svg_sketch.DRAW_MAX_SECONDS, 2.0)
        self.assertAlmostEqual(svg_sketch.draw_seconds(2750.0), 1.25)

    def test_longest_draw_fits_in_half_of_a_four_second_clip(self):
        frames = svg_sketch.draw_frame_count(1e9)
        self.assertEqual(frames, 2 * svg_sketch.DRAW_FPS)
        self.assertEqual(frames, (4 * svg_sketch.DRAW_FPS) // 2)


if __name__ == "__main__":
    unittest.main()
