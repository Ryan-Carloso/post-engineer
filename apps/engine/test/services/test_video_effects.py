import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from moviepy import ColorClip

from app.services.utils import video_effects


def _red_clip(duration=4.0):
    return ColorClip(size=(20, 10), color=(255, 0, 0)).with_duration(duration)


def _mean_red(clip, t):
    return float(clip.get_frame(t)[:, :, 0].mean())


def test_fadein_and_fadeout_wrap_the_clip():
    clip = _red_clip()
    faded_in = video_effects.fadein_transition(clip, 1.0)
    faded_out = video_effects.fadeout_transition(clip, 1.0)

    assert faded_in.duration == 4.0
    assert faded_in.size == (20, 10)
    assert faded_in.get_frame(0.5).shape == (10, 20, 3)
    assert faded_out.duration == 4.0
    assert faded_out.size == (20, 10)
    assert faded_out.get_frame(0.5).shape == (10, 20, 3)


def test_slidein_left_starts_offscreen_and_lands_fully_in():
    clip = _red_clip()
    moved = video_effects.slidein_transition(clip, 2.0, "left")

    assert moved.duration == 4.0
    assert _mean_red(moved, 0.0) < 5
    assert _mean_red(moved, 2.0) > 200


def test_slidein_right_top_bottom_start_offscreen_and_land():
    clip = _red_clip()
    for side in ("right", "top", "bottom"):
        moved = video_effects.slidein_transition(clip, 2.0, side)
        assert _mean_red(moved, 0.0) < 5
        assert _mean_red(moved, 2.0) > 200


def test_slidein_unknown_side_stays_centered():
    clip = _red_clip()
    moved = video_effects.slidein_transition(clip, 2.0, "nowhere")

    assert _mean_red(moved, 0.0) > 200


def test_slidein_zero_transition_time_does_not_divide_by_zero():
    clip = _red_clip()
    moved = video_effects.slidein_transition(clip, 0.0, "left")

    assert _mean_red(moved, 0.01) > 200


def test_slideout_left_rests_centered_then_leaves():
    clip = _red_clip()
    moved = video_effects.slideout_transition(clip, 2.0, "left")

    assert moved.duration == 4.0
    rest = _mean_red(moved, 1.0)
    assert rest > 200
    assert _mean_red(moved, 3.9) < rest / 10


def test_slideout_right_top_bottom_leave():
    clip = _red_clip()
    for side in ("right", "top", "bottom"):
        moved = video_effects.slideout_transition(clip, 2.0, side)
        rest = _mean_red(moved, 1.0)
        assert rest > 200
        assert _mean_red(moved, 3.9) < rest / 5


def test_slideout_unknown_side_stays_centered():
    clip = _red_clip()
    moved = video_effects.slideout_transition(clip, 2.0, "nowhere")

    assert _mean_red(moved, 3.9) > 200


def test_slideout_longer_than_clip_starts_leaving_immediately():
    clip = _red_clip()
    moved = video_effects.slideout_transition(clip, 10.0, "left")

    early = _mean_red(moved, 0.5)
    assert 0 < early < 255
    assert _mean_red(moved, 3.9) < early
