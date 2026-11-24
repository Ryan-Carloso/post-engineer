"""caption_layout: a caption spoken while a segment panel shows stays above it."""

from app.services import caption_layout, segment_panels


def _panel_bottom():
    """The ceiling a bottom-anchored panel imposes on a 1080x1920 frame."""
    _, y, _, _ = segment_panels.panel_rect(1080, 1920)
    return y - segment_panels.CAPTION_GAP


def test_a_cue_inside_a_panel_band_is_capped_at_the_panel_top():
    bands = [(1.0, 3.0, _panel_bottom())]
    assert caption_layout.cue_bottom(bands, (2.0, 2.4)) == _panel_bottom()
    assert caption_layout.cue_bottom(bands, (0.6, 0.9)) is None
    assert caption_layout.cue_bottom(bands, (3.1, 3.4)) is None


def test_a_cue_straddling_the_panel_start_is_lifted_so_it_never_covers_the_photo():
    bands = [(1.0, 3.0, _panel_bottom())]
    assert caption_layout.cue_bottom(bands, (0.6, 1.4)) == _panel_bottom()
    assert caption_layout.cue_bottom(bands, (2.9, 3.4)) == _panel_bottom()
    assert caption_layout.cue_bottom(bands, (0.6, 1.0)) is None, "no overlap, no lift"


def test_when_two_bands_overlap_the_tightest_wins():
    bands = [(1.0, 3.0, 900), (2.4, 4.0, 1100)]
    assert caption_layout.cue_bottom(bands, (2.5, 3.5)) == 900


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


# --- the hook title floor ---------------------------------------------------

import pytest  # noqa: E402

FLOOR = 425
TITLE = caption_layout.TitleFloor(0.0, 3.0, FLOOR)
PANEL = (1.0, 5.0, 1136)
HEIGHT = 1920
CLIP = 200
BOTTOM_Y = HEIGHT * 0.95 - CLIP
UNDER_PANEL_Y = 1136 - CLIP


@pytest.mark.parametrize("position", ["top", "center", "custom", "bottom", None])
def test_a_cue_inside_the_title_window_goes_to_the_bottom_whatever_the_position(position):
    y = caption_layout.cue_y(position, 70.0, HEIGHT, CLIP, [TITLE], (0.5, 1.5))
    assert y == BOTTOM_Y


@pytest.mark.parametrize("position", ["top", "center", "custom", "bottom"])
def test_a_cue_inside_the_window_and_a_panel_sits_above_the_panel_and_below_the_title(position):
    y = caption_layout.cue_y(position, 70.0, HEIGHT, CLIP, [PANEL, TITLE], (1.5, 2.5))
    assert y == UNDER_PANEL_Y
    assert y >= FLOOR


def test_a_cue_straddling_the_end_of_the_window_is_still_held_below_the_title():
    assert caption_layout.cue_y("top", 0.0, HEIGHT, CLIP, [TITLE], (2.5, 3.5)) == BOTTOM_Y


def test_a_cue_after_the_window_uses_the_users_position_again():
    assert caption_layout.cue_y("top", 0.0, HEIGHT, CLIP, [TITLE], (3.0, 4.0)) == HEIGHT * 0.05
    assert caption_layout.cue_y("center", 0.0, HEIGHT, CLIP, [TITLE], (3.5, 4.0)) == "center"
    assert caption_layout.cue_y("bottom", 0.0, HEIGHT, CLIP, [PANEL, TITLE], (3.5, 4.0)) == UNDER_PANEL_Y


def test_a_cue_before_the_window_starts_is_not_held():
    late = caption_layout.TitleFloor(2.0, 3.0, FLOOR)
    assert caption_layout.cue_y("top", 0.0, HEIGHT, CLIP, [late], (0.0, 2.0)) == HEIGHT * 0.05


def test_without_a_title_floor_nothing_changes():
    assert caption_layout.cue_y("top", 0.0, HEIGHT, CLIP, [PANEL], (3.5, 4.0)) == HEIGHT * 0.05
    assert caption_layout.cue_y("top", 0.0, HEIGHT, CLIP, [], (0.5, 1.5)) == HEIGHT * 0.05
    assert caption_layout.cue_floor([PANEL], (0.5, 1.5)) is None


def test_a_panel_band_never_counts_as_a_floor_and_a_floor_never_as_a_ceiling():
    assert caption_layout.cue_floor([PANEL], (2.0, 3.0)) is None
    assert caption_layout.cue_bottom([TITLE], (0.5, 1.5)) is None


def test_when_the_panel_ceiling_and_the_title_floor_conflict_the_floor_wins():
    tall = 900
    y = caption_layout.cue_y("bottom", 0.0, HEIGHT, tall, [PANEL, TITLE], (1.5, 2.5))
    assert y == FLOOR, "the ceiling would put the block at 236, on the title"
    assert y > 1136 - tall


def test_the_highest_floor_wins_when_two_titles_overlap_the_cue():
    other = caption_layout.TitleFloor(0.0, 3.0, 500)
    assert caption_layout.cue_floor([TITLE, other], (1.0, 2.0)) == 500


def test_a_floor_is_applied_to_the_final_y_only_when_set():
    assert caption_layout.caption_y("top", 0.0, HEIGHT, CLIP, None, FLOOR) == BOTTOM_Y
    assert caption_layout.caption_y("top", 0.0, HEIGHT, CLIP, None, None) == HEIGHT * 0.05
