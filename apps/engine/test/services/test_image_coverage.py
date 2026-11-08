"""image_coverage: in the images material the agent's photos cover the whole audio."""

import pytest

from app.services import image_coverage, segment_panels
from app.services.image_coverage import ImagesDoNotCoverAudio
from app.services.segment_panels import Panel


def _full(index, start, end):
    return Panel(index=index, path=f"/t/{index}.png", x=0, y=0, start=start, end=end)


def _framed(index, start, end):
    return Panel(index=index, path=f"/t/{index}.png", x=10, y=900, start=start, end=end, caption_bottom=880)


def test_coverage_starts_at_zero_on_a_faceless_video():
    assert image_coverage.coverage_start(segment_panels.FACE_NONE, 7.5) == 0.0


def test_coverage_starts_where_the_hook_hands_over_on_a_hook_persona_video():
    assert image_coverage.coverage_start(segment_panels.FACE_HOOK, 7.5) == 7.5


def test_a_negative_hook_end_never_moves_coverage_before_zero():
    assert image_coverage.coverage_start(segment_panels.FACE_HOOK, -1.0) == 0.0


def test_full_lipsync_has_nothing_to_cover():
    assert image_coverage.coverage_start(segment_panels.FACE_FULL, 7.5) is None


def test_photos_stretch_over_the_pauses_from_zero_to_the_end_of_the_audio():
    panels = [_full(0, 0.2, 3.9), _full(1, 4.1, 8.0), _full(2, 8.3, 11.5)]
    covered, warnings = image_coverage.extend_over_gaps(panels, 0.0, 12.0)
    assert [(p.index, p.start, p.end) for p in covered] == [(0, 0.0, 4.1), (1, 4.1, 8.3), (2, 8.3, 12.0)]
    assert warnings == [], "a normal pause between segments is not worth a warning"


def test_a_dropped_photo_is_covered_by_its_neighbour_with_a_warning():
    # Segment 1 (4.0-8.0) lost its photo: segment 0 runs on until segment 2 starts.
    panels = [_full(0, 0.0, 4.0), _full(2, 8.0, 12.0)]
    covered, warnings = image_coverage.extend_over_gaps(panels, 0.0, 12.0)
    assert [(p.index, p.start, p.end) for p in covered] == [(0, 0.0, 8.0), (2, 8.0, 12.0)]
    assert warnings == ["segment 0 image extended: a neighbour image covers a missing image"]


def test_a_dropped_first_photo_is_covered_by_the_next_one_reaching_back_to_the_start():
    covered, warnings = image_coverage.extend_over_gaps([_full(1, 4.0, 12.0)], 0.0, 12.0)
    assert [(p.start, p.end) for p in covered] == [(0.0, 12.0)]
    assert warnings == ["segment 1 image extended: a neighbour image covers a missing image"]


def test_a_dropped_last_photo_is_covered_by_the_previous_one_reaching_to_the_end():
    covered, warnings = image_coverage.extend_over_gaps([_full(0, 0.0, 6.0)], 0.0, 12.0)
    assert [(p.start, p.end) for p in covered] == [(0.0, 12.0)]
    assert len(warnings) == 1


def test_the_gap_warning_fires_only_above_the_pause_threshold():
    just_under = image_coverage.GAP_WARNING_SECONDS - 0.01
    _covered, quiet = image_coverage.extend_over_gaps([_full(0, just_under, 5.0)], 0.0, 5.0)
    assert quiet == []
    just_over = image_coverage.GAP_WARNING_SECONDS + 0.01
    _covered, loud = image_coverage.extend_over_gaps([_full(0, just_over, 5.0)], 0.0, 5.0)
    assert loud == ["segment 0 image extended: a neighbour image covers a missing image"]


def test_photos_are_sorted_by_time_before_they_are_extended():
    covered, _warnings = image_coverage.extend_over_gaps([_full(1, 5.0, 9.0), _full(0, 0.0, 5.0)], 0.0, 9.0)
    assert [(p.index, p.start, p.end) for p in covered] == [(0, 0.0, 5.0), (1, 5.0, 9.0)]


def test_full_frame_photos_alternate_zooming_in_and_out():
    panels = [_full(0, 0.0, 3.0), _full(1, 3.0, 6.0), _full(2, 6.0, 9.0)]
    covered, _warnings = image_coverage.extend_over_gaps(panels, 0.0, 9.0)
    assert [p.motion for p in covered] == ["in", "out", "in"]


def test_framed_hook_panels_keep_their_times_and_never_move():
    hook = _framed(0, 0.5, 6.5)
    covered, _warnings = image_coverage.extend_over_gaps([hook, _full(1, 8.0, 12.0)], 7.0, 12.0)
    assert covered[0] == hook, "a panel over the face keeps its seconds and gets no zoom"
    assert (covered[1].start, covered[1].end) == (7.0, 12.0), "coverage starts at the hand-over"


def test_a_photo_already_starting_before_the_window_keeps_its_earlier_start():
    covered, _warnings = image_coverage.extend_over_gaps([_full(0, 1.0, 5.0)], 3.0, 5.0)
    assert covered[0].start == 1.0


def test_a_photo_spoken_past_the_next_start_keeps_its_own_end():
    covered, _warnings = image_coverage.extend_over_gaps([_full(0, 0.0, 5.0), _full(1, 4.5, 9.0)], 0.0, 9.0)
    assert covered[0].end == 5.0


def test_no_surviving_photo_fails_with_the_stable_code():
    with pytest.raises(ImagesDoNotCoverAudio) as exc_info:
        image_coverage.extend_over_gaps([], 0.0, 12.0)
    assert str(exc_info.value) == "images_do_not_cover_audio"


def test_only_framed_panels_left_is_still_no_coverage():
    with pytest.raises(ImagesDoNotCoverAudio):
        image_coverage.extend_over_gaps([_framed(0, 0.5, 6.5)], 7.0, 12.0)


@pytest.mark.parametrize("window_start", [None, 12.0, 13.0])
def test_nothing_to_cover_returns_the_panels_untouched(window_start):
    panels = [_framed(0, 0.5, 6.5)]
    assert image_coverage.extend_over_gaps(panels, window_start, 12.0) == (panels, [])
