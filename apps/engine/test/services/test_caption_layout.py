"""caption_layout: a caption spoken while a segment panel shows stays above it."""

from app.services import caption_layout, segment_panels


def _panel_bottom():
    """The ceiling a bottom-anchored panel imposes on a 1080x1920 frame."""
    _, y, _, _ = segment_panels.panel_rect(1080, 1920)
    return y - segment_panels.CAPTION_GAP


def test_a_cue_inside_a_panel_band_is_capped_at_the_panel_top():
    bands = [(1.0, 3.0, _panel_bottom())]
    assert caption_layout.cue_bottom(bands, 2.0) == _panel_bottom()
    assert caption_layout.cue_bottom(bands, 0.9) is None
    assert caption_layout.cue_bottom(bands, 3.1) is None


def test_the_caption_block_ends_above_the_panel_whatever_its_height():
    for clip_height in (120, 300, 480):
        y = caption_layout.caption_y("bottom", 0.0, 1920, clip_height, _panel_bottom())
        assert y + clip_height <= 1160, "the photo is never covered"
        assert y == _panel_bottom() - clip_height, "the block is bottom-anchored just above the panel"


def test_without_a_panel_the_user_placement_is_used():
    assert caption_layout.caption_y("bottom", 0.0, 1920, 200) == 1920 * 0.95 - 200
    assert caption_layout.caption_y("top", 0.0, 1920, 200) == 1920 * 0.05
    assert caption_layout.caption_y("center", 0.0, 1920, 200) == "center"
    assert caption_layout.caption_y(None, 0.0, 1920, 200) == "center"


def test_an_explicit_top_placement_is_already_above_the_panel():
    assert caption_layout.caption_y("top", 0.0, 1920, 200, _panel_bottom()) == 1920 * 0.05


def test_custom_position_keeps_the_subtitle_on_screen():
    assert caption_layout.caption_y("custom", 70.0, 1920, 200) == (1920 - 200) * 0.7
    assert caption_layout.caption_y("custom", 0.0, 1920, 200) == caption_layout.MIN_MARGIN
    assert caption_layout.caption_y("custom", 100.0, 1920, 200) == 1920 - 200 - caption_layout.MIN_MARGIN


def test_a_caption_taller_than_the_band_stops_at_the_top_margin():
    y = caption_layout.caption_y("bottom", 0.0, 1920, 5000, _panel_bottom())
    assert y == caption_layout.MIN_MARGIN
