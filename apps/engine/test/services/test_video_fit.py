#---------------
# Fit the clip to the canvas — without cropping content:
#   1. exact ratio -> resize to the canvas (zero bars)
#   2. horizontal bars (top/bottom) <= MAX_LETTERBOX_BARS (35%)
#      -> letterbox with the clip maximized
#   3. side bars (pillarbox) -> None (clip always discarded)
#   4. horizontal bars > 35% -> None (clip discarded)
# Applies to all three formats: 9:16 (TikTok/Shorts), 16:9 (YouTube), 1:1.
#---------------

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

try:
    from moviepy import ColorClip

    MOVIEPY_AVAILABLE = True
except Exception:
    MOVIEPY_AVAILABLE = False

from app.services import video as vd  # noqa: E402


@unittest.skipUnless(MOVIEPY_AVAILABLE, "moviepy not available")
class TestFitClipToCanvas(unittest.TestCase):
    def test_exact_size_clip_passes_untouched(self):
        clip = ColorClip(size=(108, 192), color=(0, 0, 0)).with_duration(0.5)
        fitted = vd._fit_clip_to_canvas(clip, 108, 192)
        self.assertIs(fitted, clip)

    def test_matching_ratio_is_resized_exactly(self):
        clip = ColorClip(size=(96, 54), color=(0, 0, 255)).with_duration(0.5)
        fitted = vd._fit_clip_to_canvas(clip, 192, 108)
        self.assertEqual(tuple(fitted.size), (192, 108))

    def test_landscape_clip_out_of_band_returns_none_for_portrait_canvas(self):
        """16:9 no 9:16 = ~68% de barra — fora do teto, descarta."""
        clip = ColorClip(size=(192, 108), color=(255, 0, 0)).with_duration(0.5)
        self.assertIsNone(vd._fit_clip_to_canvas(clip, 108, 192))

    def test_square_clip_out_of_band_returns_none_for_portrait_canvas(self):
        """1:1 no 9:16 = ~44% de barra — fora do teto, descarta."""
        clip = ColorClip(size=(96, 96), color=(255, 255, 0)).with_duration(0.5)
        self.assertIsNone(vd._fit_clip_to_canvas(clip, 108, 192))

    def test_three_quarter_clip_in_band_is_letterboxed_maximized(self):
        """3:4 no 9:16 = ~25% de barra horizontal — letterbox com o clipe maximizado."""
        clip = ColorClip(size=(144, 192), color=(255, 0, 0)).with_duration(0.5)
        fitted = vd._fit_clip_to_canvas(clip, 108, 192)
        self.assertIsNotNone(fitted)
        # Canvas inteiro (fundo preto), clipe cabendo por inteiro dentro.
        self.assertEqual(tuple(fitted.size), (108, 192))

    def test_tall_clip_returns_none_for_portrait_canvas(self):
        """9:21 no 9:16 = barras laterais (pillarbox) — sempre rejeitado."""
        clip = ColorClip(size=(54, 126), color=(0, 255, 0)).with_duration(0.5)
        self.assertIsNone(vd._fit_clip_to_canvas(clip, 108, 192))

    def test_portrait_clip_out_of_band_returns_none_for_landscape_canvas(self):
        clip = ColorClip(size=(108, 192), color=(0, 255, 0)).with_duration(0.5)
        self.assertIsNone(vd._fit_clip_to_canvas(clip, 192, 108))


if __name__ == "__main__":
    unittest.main()
