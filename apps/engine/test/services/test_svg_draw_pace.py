"""Pin the calm draw pace: svg drawings last 4-6 seconds, so the pencil
takes its time (1.25-3.5 s) and the finished artwork still holds.

Kept in its own small file so the grandfathered test_svg_sketch.py does
not grow: these absolute values fail on the old fast pace (2200 px/s,
0.75-2.0 s), which raced through the artwork.
"""

import unittest

from app.services import svg_sketch


class CalmDrawPaceTests(unittest.TestCase):
    def test_draw_is_half_the_old_fast_pace(self):
        self.assertEqual(svg_sketch.PENCIL_SPEED_PX_PER_SECOND, 1100.0)
        self.assertEqual(svg_sketch.DRAW_MIN_SECONDS, 1.25)
        self.assertEqual(svg_sketch.DRAW_MAX_SECONDS, 3.5)
        self.assertAlmostEqual(svg_sketch.draw_seconds(2750.0), 2.5)

    def test_longest_draw_still_holds_in_the_shortest_clip(self):
        frames = svg_sketch.draw_frame_count(1e9)
        self.assertEqual(frames, round(3.5 * svg_sketch.DRAW_FPS))
        fitted = svg_sketch.fit_frames_to_clip(list(range(frames)), 4 * svg_sketch.DRAW_FPS)
        hold = int(svg_sketch.FINAL_HOLD_SECONDS * svg_sketch.DRAW_FPS)
        self.assertEqual(fitted[-hold:], [frames - 1] * hold)


if __name__ == "__main__":
    unittest.main()
