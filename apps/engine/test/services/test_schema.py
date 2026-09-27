import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from pydantic import ValidationError

from app.config import config
from app.models.schema import (
    AudioRequest,
    SubtitleRequest,
    VideoAspect,
    VideoParams,
    VideoTermsParams,
)


class TestVideoAspect(unittest.TestCase):
    def test_to_resolution_known_aspects(self):
        self.assertEqual(VideoAspect.landscape.to_resolution(), (1920, 1080))
        self.assertEqual(VideoAspect.portrait.to_resolution(), (1080, 1920))
        self.assertEqual(VideoAspect.square.to_resolution(), (1080, 1080))

    def test_to_resolution_rejects_unsupported_value(self):
        with self.assertRaises(ValueError):
            VideoAspect.to_resolution("4:5")


class TestVideoParamsLipsyncEnabled(unittest.TestCase):
    def test_default_is_true(self):
        self.assertTrue(VideoParams(video_subject="test").lipsync_enabled)

    def test_accepts_false(self):
        params = VideoParams(video_subject="test", lipsync_enabled=False)
        self.assertFalse(params.lipsync_enabled)

    def test_accepts_true(self):
        params = VideoParams(video_subject="test", lipsync_enabled=True)
        self.assertTrue(params.lipsync_enabled)


class TestSchemaBounds(unittest.TestCase):
    """Numeric and length bounds guard the public API against absurd inputs
    (e.g. amount=10**9 fanning out into a billion material searches)."""

    def _params(self, **kwargs):
        kwargs.setdefault("video_subject", "test")
        return VideoParams(**kwargs)

    # VideoTermsParams.amount: 1..50

    def test_terms_amount_rejects_huge_value(self):
        with self.assertRaises(ValidationError):
            VideoTermsParams(amount=10**9)

    def test_terms_amount_rejects_zero(self):
        with self.assertRaises(ValidationError):
            VideoTermsParams(amount=0)

    def test_terms_amount_rejects_above_max(self):
        with self.assertRaises(ValidationError):
            VideoTermsParams(amount=51)

    def test_terms_amount_accepts_edges_and_default(self):
        self.assertEqual(VideoTermsParams(amount=1).amount, 1)
        self.assertEqual(VideoTermsParams(amount=50).amount, 50)
        self.assertEqual(VideoTermsParams().amount, 5)

    # VideoParams.video_subject: max 500 chars

    def test_video_subject_rejects_501_chars(self):
        with self.assertRaises(ValidationError):
            self._params(video_subject="x" * 501)

    def test_video_subject_accepts_500_chars(self):
        self.assertEqual(len(self._params(video_subject="x" * 500).video_subject), 500)

    # VideoParams.video_script: max 20000 chars

    def test_video_script_rejects_20001_chars(self):
        with self.assertRaises(ValidationError):
            self._params(video_script="x" * 20001)

    def test_video_script_accepts_20000_chars(self):
        self.assertEqual(len(self._params(video_script="x" * 20000).video_script), 20000)

    # Numeric fields: sane ranges, defaults stay valid

    def test_video_clip_duration_bounds(self):
        for bad in (0, -1, 61, 3600):
            with self.assertRaises(ValidationError, msg=f"clip_duration={bad}"):
                self._params(video_clip_duration=bad)
        self.assertEqual(self._params(video_clip_duration=1).video_clip_duration, 1)
        self.assertEqual(self._params(video_clip_duration=60).video_clip_duration, 60)
        self.assertEqual(self._params().video_clip_duration, 2)

    def test_font_size_bounds(self):
        for bad in (0, 7, 301, 10000):
            with self.assertRaises(ValidationError, msg=f"font_size={bad}"):
                self._params(font_size=bad)
        self.assertEqual(self._params(font_size=8).font_size, 8)
        self.assertEqual(self._params(font_size=300).font_size, 300)
        # Default comes from config [ui] (production default), not the fallback.
        self.assertEqual(self._params().font_size, config.ui.get("font_size", 60))

    def test_stroke_width_bounds(self):
        for bad in (-0.1, -5, 20.1, 100):
            with self.assertRaises(ValidationError, msg=f"stroke_width={bad}"):
                self._params(stroke_width=bad)
        self.assertEqual(self._params(stroke_width=0).stroke_width, 0)
        self.assertEqual(self._params(stroke_width=20).stroke_width, 20)
        # Default comes from config [ui] (production default), not the fallback.
        self.assertEqual(
            self._params().stroke_width, config.ui.get("stroke_width", 1.5)
        )

    def test_n_threads_bounds(self):
        for bad in (0, -4, 65, 1024):
            with self.assertRaises(ValidationError, msg=f"n_threads={bad}"):
                self._params(n_threads=bad)
        self.assertEqual(self._params(n_threads=1).n_threads, 1)
        self.assertEqual(self._params(n_threads=64).n_threads, 64)
        self.assertEqual(self._params().n_threads, 2)

    def test_voice_rate_bounds(self):
        for bad in (0, 0.05, 5.1, 100):
            with self.assertRaises(ValidationError, msg=f"voice_rate={bad}"):
                self._params(voice_rate=bad)
        self.assertEqual(self._params(voice_rate=0.1).voice_rate, 0.1)
        self.assertEqual(self._params(voice_rate=5.0).voice_rate, 5.0)
        self.assertEqual(self._params().voice_rate, 1.0)

    def test_voice_volume_bounds(self):
        for bad in (-0.1, -2, 5.1, 100):
            with self.assertRaises(ValidationError, msg=f"voice_volume={bad}"):
                self._params(voice_volume=bad)
        self.assertEqual(self._params(voice_volume=0).voice_volume, 0)
        self.assertEqual(self._params(voice_volume=5.0).voice_volume, 5.0)
        self.assertEqual(self._params().voice_volume, 1.0)


class TestRequestModelBounds(unittest.TestCase):
    """SubtitleRequest/AudioRequest mirror VideoParams fields, so they mirror
    its bounds: standalone /subtitle and /audio endpoints must not accept
    values the main pipeline rejects."""

    def test_subtitle_request_video_script_max_length(self):
        with self.assertRaises(ValidationError):
            SubtitleRequest(video_script="x" * 20001)
        self.assertEqual(
            len(SubtitleRequest(video_script="x" * 20000).video_script), 20000
        )

    def test_audio_request_video_script_max_length(self):
        with self.assertRaises(ValidationError):
            AudioRequest(video_script="x" * 20001)
        self.assertEqual(
            len(AudioRequest(video_script="x" * 20000).video_script), 20000
        )

    def test_subtitle_request_voice_bounds(self):
        for bad in (-0.1, 5.1):
            with self.assertRaises(ValidationError, msg=f"voice_volume={bad}"):
                SubtitleRequest(video_script="x", voice_volume=bad)
        for bad in (0, 0.05, 5.1):
            with self.assertRaises(ValidationError, msg=f"voice_rate={bad}"):
                SubtitleRequest(video_script="x", voice_rate=bad)
        self.assertEqual(
            SubtitleRequest(video_script="x", voice_volume=5.0).voice_volume, 5.0
        )
        self.assertEqual(
            SubtitleRequest(video_script="x", voice_rate=0.1).voice_rate, 0.1
        )

    def test_audio_request_voice_bounds(self):
        for bad in (-0.1, 5.1):
            with self.assertRaises(ValidationError, msg=f"voice_volume={bad}"):
                AudioRequest(video_script="x", voice_volume=bad)
        for bad in (0, 0.05, 5.1):
            with self.assertRaises(ValidationError, msg=f"voice_rate={bad}"):
                AudioRequest(video_script="x", voice_rate=bad)

    def test_subtitle_request_font_bounds(self):
        for bad in (7, 301):
            with self.assertRaises(ValidationError, msg=f"font_size={bad}"):
                SubtitleRequest(video_script="x", font_size=bad)
        for bad in (-0.1, 20.1):
            with self.assertRaises(ValidationError, msg=f"stroke_width={bad}"):
                SubtitleRequest(video_script="x", stroke_width=bad)
        self.assertEqual(
            SubtitleRequest(video_script="x", font_size=8).font_size, 8
        )
        self.assertEqual(
            SubtitleRequest(video_script="x", stroke_width=20).stroke_width, 20
        )


if __name__ == "__main__":
    unittest.main()
