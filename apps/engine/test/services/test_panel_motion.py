"""panel_motion: the slow zoom (Ken Burns) on full-frame photos in the images material."""

import pytest

from app.services import panel_motion
from app.services.segment_panels import Panel


def _panel(start, end, motion="in"):
    return Panel(index=0, path="/t/0.png", x=0, y=0, start=start, end=end, motion=motion)


def test_zoom_grows_three_percent_per_second_like_still_material():
    assert panel_motion.zoom_for(2.0) == pytest.approx(1.06)


def test_zoom_is_capped_so_a_long_segment_never_zooms_into_a_blurry_crop():
    assert panel_motion.zoom_for(30.0) == panel_motion.MAX_ZOOM


def test_negative_seconds_never_zoom_below_the_full_photo():
    assert panel_motion.zoom_for(-1.0) == 1.0


def test_frame_count_covers_the_whole_time_on_screen():
    assert panel_motion.frame_count(_panel(1.0, 2.5)) == 45
    assert panel_motion.frame_count(_panel(1.0, 1.01)) == 1
    assert panel_motion.frame_count(_panel(2.0, 2.0)) == 1


def test_zoom_in_filter_supersamples_zooms_from_one_and_starts_at_the_panel_start():
    chain = panel_motion.zoom_filter("1:v", _panel(2.0, 4.0, "in"), 1080, 1920, "m0")
    assert chain == (
        "[1:v]scale=2160:3840,"
        "zoompan=z='1+0.0600*on/60':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'"
        ":d=60:s=1080x1920:fps=30,"
        "setpts=PTS-STARTPTS+2.000/TB[m0]"
    )


def test_zoom_out_filter_starts_zoomed_and_returns_to_the_full_photo():
    chain = panel_motion.zoom_filter("2:v", _panel(0.0, 2.0, "out"), 1080, 1920, "m1")
    assert "zoompan=z='1.0600-0.0600*on/60'" in chain
    assert chain.startswith("[2:v]") and chain.endswith("[m1]")
