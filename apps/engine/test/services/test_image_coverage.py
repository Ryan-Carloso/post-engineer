"""image_coverage: in the images material every sent photo must survive.

The render rule is all-must-survive: any photo skipped at render fails
the task with images_do_not_cover_audio naming the skip reasons, so the
agent fixes the photo instead of guessing. Surviving panels stretch
unconditionally over the coverage window (no thresholds, no warnings).
Full lip sync stays lenient: the face is on screen the whole time, so a
skipped photo is a warning there, never a failure.
"""

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
    covered = image_coverage.extend_over_gaps(panels, 0.0, 12.0)
    assert [(p.index, p.start, p.end) for p in covered] == [(0, 0.0, 4.1), (1, 4.1, 8.3), (2, 8.3, 12.0)]


def test_a_dropped_photo_is_covered_by_its_neighbour_without_a_warning():
    # Segment 1 (4.0-8.0) lost its photo: segment 0 runs on until segment 2 starts.
    panels = [_full(0, 0.0, 4.0), _full(2, 8.0, 12.0)]
    covered = image_coverage.extend_over_gaps(panels, 0.0, 12.0)
    assert [(p.index, p.start, p.end) for p in covered] == [(0, 0.0, 8.0), (2, 8.0, 12.0)]


def test_a_dropped_first_photo_is_covered_by_the_next_one_reaching_back_to_the_start():
    covered = image_coverage.extend_over_gaps([_full(1, 4.0, 12.0)], 0.0, 12.0)
    assert [(p.start, p.end) for p in covered] == [(0.0, 12.0)]


def test_a_dropped_last_photo_is_covered_by_the_previous_one_reaching_to_the_end():
    covered = image_coverage.extend_over_gaps([_full(0, 0.0, 6.0)], 0.0, 12.0)
    assert [(p.start, p.end) for p in covered] == [(0.0, 12.0)]


def test_photos_are_sorted_by_time_before_they_are_extended():
    covered = image_coverage.extend_over_gaps([_full(1, 5.0, 9.0), _full(0, 0.0, 5.0)], 0.0, 9.0)
    assert [(p.index, p.start, p.end) for p in covered] == [(0, 0.0, 5.0), (1, 5.0, 9.0)]


def test_full_frame_photos_alternate_zooming_in_and_out():
    panels = [_full(0, 0.0, 3.0), _full(1, 3.0, 6.0), _full(2, 6.0, 9.0)]
    covered = image_coverage.extend_over_gaps(panels, 0.0, 9.0)
    assert [p.motion for p in covered] == ["in", "out", "in"]


def test_framed_hook_panels_keep_their_times_and_never_move():
    hook = _framed(0, 0.5, 6.5)
    covered = image_coverage.extend_over_gaps([hook, _full(1, 8.0, 12.0)], 7.0, 12.0)
    assert covered[0] == hook, "a panel over the face keeps its seconds and gets no zoom"
    assert (covered[1].start, covered[1].end) == (7.0, 12.0), "coverage starts at the hand-over"


def test_a_photo_already_starting_before_the_window_keeps_its_earlier_start():
    covered = image_coverage.extend_over_gaps([_full(0, 1.0, 5.0)], 3.0, 5.0)
    assert covered[0].start == 1.0


def test_a_photo_spoken_past_the_next_start_keeps_its_own_end():
    covered = image_coverage.extend_over_gaps([_full(0, 0.0, 5.0), _full(1, 4.5, 9.0)], 0.0, 9.0)
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
    assert image_coverage.extend_over_gaps(panels, window_start, 12.0) == panels


def test_the_bare_code_is_unchanged_when_no_detail_is_given():
    assert str(ImagesDoNotCoverAudio()) == "images_do_not_cover_audio"


def test_all_surviving_photos_stretch_over_small_gaps():
    panels = [_full(0, 0.2, 3.9), _full(1, 4.1, 8.0)]
    covered = image_coverage.ensure_coverage(
        panels,
        face=segment_panels.FACE_NONE,
        hook_end=0.0,
        audio_duration=8.0,
        sent=2,
        skipped=[],
    )
    assert [(p.start, p.end) for p in covered] == [(0.0, 4.1), (4.1, 8.0)]


def test_one_skipped_photo_fails_naming_the_counts_and_the_photo():
    panels = [_full(0, 0.0, 4.0), _full(1, 4.0, 8.0)]
    with pytest.raises(ImagesDoNotCoverAudio) as exc_info:
        image_coverage.ensure_coverage(
            panels,
            face=segment_panels.FACE_NONE,
            hook_end=0.0,
            audio_duration=8.0,
            sent=3,
            skipped=["segment 0 image 1 media skipped: download blocked"],
        )
    message = str(exc_info.value)
    assert message.startswith("images_do_not_cover_audio: ")
    assert "3 sent, 2 survived, 1 skipped (download blocked x1)" in message
    assert "segment 0 image 1 media skipped: download blocked" in message


def test_a_skipped_panel_photo_fails_the_same_way():
    panels = [_full(0, 0.0, 4.0)]
    with pytest.raises(ImagesDoNotCoverAudio) as exc_info:
        image_coverage.ensure_coverage(
            panels,
            face=segment_panels.FACE_NONE,
            hook_end=0.0,
            audio_duration=8.0,
            sent=2,
            skipped=[
                "segment 0 image 1 media skipped: photo panel failed to render",
                "segment 1 image 0 media skipped: wrong aspect ratio (1920x1080 (16:9); expected 9:16 (1080x1920))",
            ],
        )
    message = str(exc_info.value)
    assert "2 sent, 1 survived, 2 skipped" in message
    assert "segment 0 image 1 media skipped: photo panel failed to render" in message
    assert "wrong aspect ratio" in message


def test_no_survivor_reports_the_counts_and_every_skip_reason():
    with pytest.raises(ImagesDoNotCoverAudio) as exc_info:
        image_coverage.ensure_coverage(
            [],
            face=segment_panels.FACE_NONE,
            hook_end=0.0,
            audio_duration=12.0,
            sent=4,
            skipped=[
                "segment 0 image 0 media skipped: download blocked",
                "segment 0 image 1 media skipped: media expired or missing",
                "segment 1 image 0 media skipped: download blocked",
                "segment 1 image 1 media skipped: too small",
            ],
        )
    message = str(exc_info.value)
    assert message.startswith("images_do_not_cover_audio: no full-frame image survived; ")
    assert "4 sent, 0 survived, 4 skipped (download blocked x2, media expired or missing x1, too small x1)" in message
    assert "segment 0 image 1 media skipped: media expired or missing" in message
    assert "segment 1 image 1 media skipped: too small" in message


def test_zero_sent_photos_report_no_skips():
    with pytest.raises(ImagesDoNotCoverAudio) as exc_info:
        image_coverage.ensure_coverage(
            [],
            face=segment_panels.FACE_NONE,
            hook_end=0.0,
            audio_duration=12.0,
            sent=0,
            skipped=[],
        )
    assert str(exc_info.value) == (
        "images_do_not_cover_audio: no full-frame image survived; "
        "0 sent, 0 survived, 0 skipped"
    )


def test_overlay_skips_are_not_lost_photos():
    panels = [_full(0, 0.0, 4.0)]
    covered = image_coverage.ensure_coverage(
        panels,
        face=segment_panels.FACE_NONE,
        hook_end=0.0,
        audio_duration=4.0,
        sent=1,
        skipped=["segment 0 image 0 media overlay skipped: overlay font unavailable"],
    )
    assert [(p.start, p.end) for p in covered] == [(0.0, 4.0)]


def test_framed_hook_panels_pass_through():
    hook = _framed(0, 0.5, 6.5)
    covered = image_coverage.ensure_coverage(
        [hook, _full(1, 8.0, 12.0)],
        face=segment_panels.FACE_HOOK,
        hook_end=7.0,
        audio_duration=12.0,
        sent=2,
        skipped=[],
    )
    assert covered[0] == hook, "a panel over the face counts for the hook segment"


def test_full_lipsync_never_fails_even_when_photos_are_skipped():
    covered = image_coverage.ensure_coverage(
        [],
        face=segment_panels.FACE_FULL,
        hook_end=0.0,
        audio_duration=12.0,
        sent=2,
        skipped=[
            "segment 0 image 0 media skipped: download blocked",
            "segment 1 image 0 media skipped: too small",
        ],
    )
    assert covered == []


def test_full_lipsync_returns_surviving_panels_untouched():
    hook = _framed(0, 0.5, 6.5)
    covered = image_coverage.ensure_coverage(
        [hook],
        face=segment_panels.FACE_FULL,
        hook_end=0.0,
        audio_duration=12.0,
        sent=1,
        skipped=[],
    )
    assert covered == [hook]
