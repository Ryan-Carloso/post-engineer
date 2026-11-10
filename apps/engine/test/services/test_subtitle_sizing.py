"""Subtitle font size: `font_size` is pixels at a 1080px short side."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from app.services import subtitle_sizing


def test_portrait_1080_is_unchanged():
    assert subtitle_sizing.scaled_font_size(50, 1080, 1920) == 50


def test_landscape_1080_is_unchanged():
    assert subtitle_sizing.scaled_font_size(50, 1920, 1080) == 50


def test_smaller_frames_scale_down_by_the_short_side():
    assert subtitle_sizing.scaled_font_size(60, 720, 1280) == 40


def test_larger_frames_scale_up():
    assert subtitle_sizing.scaled_font_size(50, 2160, 3840) == 100


def test_the_result_never_drops_below_the_schema_minimum():
    assert subtitle_sizing.scaled_font_size(8, 360, 640) == subtitle_sizing.MIN_FONT_SIZE


def test_the_minimum_matches_the_schema_lower_bound():
    from app.models.schema import VideoParams

    bound = VideoParams.model_fields["font_size"].metadata[0].ge
    assert subtitle_sizing.MIN_FONT_SIZE == bound
