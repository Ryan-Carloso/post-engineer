"""image_coverage: in the images material every sent photo must survive.

The render rule is all-must-survive: any photo skipped at render fails
the task with images_do_not_cover_audio naming the skip reasons, so the
agent fixes the photo instead of guessing. Surviving full-frame photos
are laid out back to back from the coverage start, at most 2s each: a
photo may start early into the pause before its segment, but it never
runs past 2s. When the photos run out before the end of the audio the
task fails with images_do_not_cover_audio naming how many more 2s photos
the window needs, instead of stretching one photo over the gap. Full lip
sync stays lenient: the face is on screen the whole time, so a skipped
photo is a warning there, never a failure.
"""

import pytest

from app.services import image_coverage, segment_panels
from app.services.image_coverage import ImagesDoNotCoverAudio
from app.services.segment_panels import Panel


def _full(index, start, end, requested_duration=None):
    return Panel(
        index=index,
        path=f"/t/{index}.png",
        x=0,
        y=0,
        start=start,
        end=end,
        requested_duration=requested_duration,
    )


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


def test_photos_beyond_two_seconds_fail_naming_how_many_more_are_needed():
    panels = [_full(0, 0.2, 3.9), _full(1, 4.1, 8.0), _full(2, 8.3, 11.5)]
    with pytest.raises(ImagesDoNotCoverAudio) as exc_info:
        image_coverage.extend_over_gaps(panels, 0.0, 12.0)
    assert str(exc_info.value) == (
        "images_do_not_cover_audio: 3 photos cover 6.0s of 12.0s at 2s each; "
        "need 3 more photos"
    )


def test_a_dropped_photo_is_not_covered_by_its_neighbour():
    panels = [_full(0, 0.0, 4.0), _full(2, 8.0, 12.0)]
    with pytest.raises(ImagesDoNotCoverAudio) as exc_info:
        image_coverage.extend_over_gaps(panels, 0.0, 12.0)
    assert str(exc_info.value) == (
        "images_do_not_cover_audio: 2 photos cover 4.0s of 12.0s at 2s each; "
        "need 4 more photos"
    )


def test_a_dropped_first_photo_fails_instead_of_stretching_the_next_one():
    with pytest.raises(ImagesDoNotCoverAudio) as exc_info:
        image_coverage.extend_over_gaps([_full(1, 4.0, 12.0)], 0.0, 12.0)
    assert str(exc_info.value) == (
        "images_do_not_cover_audio: 1 photo covers 2.0s of 12.0s at 2s each; "
        "need 5 more photos"
    )


def test_a_dropped_last_photo_fails_instead_of_stretching_the_previous_one():
    with pytest.raises(ImagesDoNotCoverAudio) as exc_info:
        image_coverage.extend_over_gaps([_full(0, 0.0, 6.0)], 0.0, 12.0)
    assert str(exc_info.value) == (
        "images_do_not_cover_audio: 1 photo covers 2.0s of 12.0s at 2s each; "
        "need 5 more photos"
    )


def test_photos_are_sorted_by_time_before_they_are_laid_out():
    covered = image_coverage.extend_over_gaps([_full(1, 2.0, 4.0), _full(0, 0.0, 2.0)], 0.0, 4.0)
    assert [(p.index, p.start, p.end) for p in covered] == [(0, 0.0, 2.0), (1, 2.0, 4.0)]


def test_full_frame_photos_alternate_zooming_in_and_out():
    panels = [_full(0, 0.0, 2.0), _full(1, 2.0, 4.0), _full(2, 4.0, 6.0)]
    covered = image_coverage.extend_over_gaps(panels, 0.0, 6.0)
    assert [p.motion for p in covered] == ["in", "out", "in"]


def test_no_seed_keeps_the_alternation_from_in():
    panels = [_full(0, 0.0, 2.0), _full(1, 2.0, 4.0), _full(2, 4.0, 6.0)]
    covered = image_coverage.extend_over_gaps(panels, 0.0, 6.0, variation_seed=None)
    assert [p.motion for p in covered] == ["in", "out", "in"]


def test_the_same_seed_repeats_the_same_motion_pattern():
    panels = [_full(0, 0.0, 2.0), _full(1, 2.0, 4.0), _full(2, 4.0, 6.0), _full(3, 6.0, 8.0)]
    first = [p.motion for p in image_coverage.extend_over_gaps(panels, 0.0, 8.0, variation_seed=7)]
    second = [p.motion for p in image_coverage.extend_over_gaps(panels, 0.0, 8.0, variation_seed=7)]
    assert first == second
    assert set(first) <= {"in", "out"}


def test_seeds_vary_the_motion_pattern_across_videos():
    panels = [_full(0, 0.0, 2.0), _full(1, 2.0, 4.0), _full(2, 4.0, 6.0)]
    patterns = {
        tuple(p.motion for p in image_coverage.extend_over_gaps(panels, 0.0, 6.0, variation_seed=seed))
        for seed in range(20)
    }
    assert len(patterns) > 1


def test_framed_hook_panels_keep_their_times_and_never_move():
    hook = _framed(0, 0.5, 6.5)
    covered = image_coverage.extend_over_gaps([hook, _full(1, 8.0, 9.0)], 7.0, 9.0)
    assert covered[0] == hook, "a panel over the face keeps its seconds and gets no zoom"
    assert (covered[1].start, covered[1].end) == (7.0, 9.0), "coverage starts at the hand-over"


def test_a_photo_starting_before_the_window_starts_at_the_window():
    covered = image_coverage.extend_over_gaps([_full(0, 1.0, 5.0)], 3.0, 5.0)
    assert (covered[0].start, covered[0].end) == (3.0, 5.0)


def test_overlapping_long_panels_fail_when_they_cannot_cover_the_audio():
    with pytest.raises(ImagesDoNotCoverAudio) as exc_info:
        image_coverage.extend_over_gaps([_full(0, 0.0, 5.0), _full(1, 4.5, 9.0)], 0.0, 9.0)
    assert str(exc_info.value) == (
        "images_do_not_cover_audio: 2 photos cover 4.0s of 9.0s at 2s each; "
        "need 3 more photos"
    )


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


def test_photos_cover_small_pauses_without_exceeding_two_seconds():
    panels = [_full(0, 0.2, 1.9), _full(1, 2.1, 4.0)]
    covered = image_coverage.ensure_coverage(
        panels,
        face=segment_panels.FACE_NONE,
        hook_end=0.0,
        audio_duration=4.0,
        sent=2,
        skipped=[],
    )
    assert [(p.start, p.end) for p in covered] == [(0.0, 2.0), (2.0, 4.0)]


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
    panels = [_full(0, 0.0, 2.0)]
    covered = image_coverage.ensure_coverage(
        panels,
        face=segment_panels.FACE_NONE,
        hook_end=0.0,
        audio_duration=2.0,
        sent=1,
        skipped=["segment 0 image 0 media overlay skipped: overlay font unavailable"],
    )
    assert [(p.start, p.end) for p in covered] == [(0.0, 2.0)]


def test_framed_hook_panels_pass_through():
    hook = _framed(0, 0.5, 6.5)
    covered = image_coverage.ensure_coverage(
        [hook, _full(1, 8.0, 9.0)],
        face=segment_panels.FACE_HOOK,
        hook_end=7.0,
        audio_duration=9.0,
        sent=2,
        skipped=[],
    )
    assert covered[0] == hook, "a panel over the face counts for the hook segment"
    assert (covered[1].start, covered[1].end) == (7.0, 9.0)


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


def test_no_full_frame_photo_stays_on_screen_longer_than_two_seconds():
    panels = [_full(0, 0.0, 1.0), _full(1, 1.2, 2.0), _full(2, 2.1, 3.5), _full(3, 3.6, 4.0)]
    covered = image_coverage.extend_over_gaps(panels, 0.0, 4.0)
    assert [(p.start, p.end) for p in covered] == [(0.0, 1.2), (1.2, 2.1), (2.1, 3.6), (3.6, 4.0)]
    assert all(p.end - p.start <= 2.0 for p in covered)


def test_running_out_of_photos_fails_naming_the_missing_count():
    panels = [_full(0, 0.0, 3.0), _full(1, 3.0, 6.0)]
    with pytest.raises(ImagesDoNotCoverAudio) as exc_info:
        image_coverage.ensure_coverage(
            panels,
            face=segment_panels.FACE_NONE,
            hook_end=0.0,
            audio_duration=6.0,
            sent=2,
            skipped=[],
        )
    assert str(exc_info.value) == (
        "images_do_not_cover_audio: 2 photos cover 4.0s of 6.0s at 2s each; "
        "need 1 more photo"
    )


def test_the_reported_short_fails_with_twelve_photos_for_thirty_five_seconds():
    starts = [0, 3, 5, 7, 11, 13, 19, 21, 24, 27, 29, 32]
    ends = [3, 5, 7, 11, 13, 19, 21, 24, 27, 29, 32, 35]
    panels = [_full(index, start, end) for index, (start, end) in enumerate(zip(starts, ends))]
    with pytest.raises(ImagesDoNotCoverAudio) as exc_info:
        image_coverage.extend_over_gaps(panels, 0.0, 35.0)
    assert str(exc_info.value) == (
        "images_do_not_cover_audio: 12 photos cover 24.0s of 35.0s at 2s each; "
        "need 6 more photos"
    )



def _clip(index, start, end, seconds):
    return Panel(
        index=index, path=f"/t/{index}.mp4", x=0, y=0, start=start, end=end,
        clip_seconds=seconds, frame_width=1080, frame_height=1920,
    )


def test_a_clip_covers_its_take_past_the_two_second_photo_cap():
    covered = image_coverage.extend_over_gaps([_clip(0, 0.0, 6.0, 6.0)], 0.0, 6.0)
    assert [(p.start, p.end, p.motion) for p in covered] == [(0.0, 6.0, None)]


def test_a_long_clip_is_trimmed_to_its_take():
    covered = image_coverage.extend_over_gaps([_clip(0, 0.0, 4.0, 10.0)], 0.0, 4.0)
    assert [(p.start, p.end) for p in covered] == [(0.0, 4.0)]


def test_a_short_clip_loops_at_most_three_times_then_fails():
    with pytest.raises(ImagesDoNotCoverAudio) as exc_info:
        image_coverage.extend_over_gaps([_clip(0, 0.0, 9.0, 2.0)], 0.0, 9.0)
    assert str(exc_info.value) == (
        "images_do_not_cover_audio: 1 item covers 6.0s of 9.0s; "
        "need 2 more photos or video clips"
    )


def test_a_clip_and_photos_share_the_window_with_their_own_rules():
    panels = [_full(0, 0.0, 2.0), _clip(1, 2.0, 8.0, 6.0), _full(2, 8.0, 10.0)]
    covered = image_coverage.extend_over_gaps(panels, 0.0, 10.0)
    assert [(p.index, p.start, p.end, p.motion) for p in covered] == [
        (0, 0.0, 2.0, "in"), (1, 2.0, 8.0, None), (2, 8.0, 10.0, "out"),
    ]


def test_a_skipped_clip_fails_the_task_like_a_skipped_photo():
    panels = [_clip(0, 0.0, 6.0, 6.0)]
    with pytest.raises(ImagesDoNotCoverAudio) as exc_info:
        image_coverage.ensure_coverage(
            panels,
            face=segment_panels.FACE_NONE,
            hook_end=0.0,
            audio_duration=12.0,
            sent=2,
            skipped=["segment 1 image 0 media skipped: not a video clip"],
        )
    message = str(exc_info.value)
    assert "2 sent, 1 survived, 1 skipped (not a video clip x1)" in message
    assert "segment 1 image 0 media skipped: not a video clip" in message
def test_a_requested_long_photo_holds_the_turning_point():
    panels = [
        _full(0, 0.0, 2.0, requested_duration=3.0),
        _full(1, 2.0, 4.0),
        _full(2, 4.0, 6.0),
    ]
    covered = image_coverage.extend_over_gaps(panels, 0.0, 7.0)
    assert [(p.start, p.end) for p in covered] == [(0.0, 3.0), (3.0, 5.0), (5.0, 7.0)]


def test_a_requested_flash_photo_is_short():
    panels = [
        _full(0, 0.0, 0.5, requested_duration=0.5),
        _full(1, 0.5, 2.5),
        _full(2, 2.5, 4.5),
        _full(3, 4.5, 6.0),
    ]
    covered = image_coverage.extend_over_gaps(panels, 0.0, 6.0)
    assert [(p.start, p.end) for p in covered] == [
        (0.0, 0.5),
        (0.5, 2.5),
        (2.5, 4.5),
        (4.5, 6.0),
    ]


def test_a_requested_photo_runs_past_the_next_photo_original_start():
    panels = [
        _full(0, 0.0, 2.0, requested_duration=3.0),
        _full(1, 2.0, 4.0),
        _full(2, 4.0, 6.0),
    ]
    covered = image_coverage.extend_over_gaps(panels, 0.0, 6.0)
    assert [(p.start, p.end) for p in covered] == [(0.0, 3.0), (3.0, 5.0), (5.0, 6.0)]


def test_a_default_photo_after_a_long_request_never_runs_backwards():
    panels = [
        _full(0, 0.0, 2.0, requested_duration=4.0),
        _full(1, 2.0, 3.0),
        _full(2, 3.0, 5.0),
    ]
    covered = image_coverage.extend_over_gaps(panels, 0.0, 8.0)
    assert [(p.start, p.end) for p in covered] == [(0.0, 4.0), (4.0, 6.0), (6.0, 8.0)]
    assert all(p.end > p.start for p in covered)


def test_a_requested_photo_longer_than_the_remaining_audio_is_clipped():
    panels = [_full(0, 0.0, 2.0), _full(1, 2.0, 4.0, requested_duration=6.0)]
    covered = image_coverage.extend_over_gaps(panels, 0.0, 5.0)
    assert [(p.start, p.end) for p in covered] == [(0.0, 2.0), (2.0, 5.0)]


def test_short_requested_photos_fail_coverage_naming_the_missing_count():
    panels = [
        _full(0, 0.0, 0.5, requested_duration=0.5),
        _full(1, 0.5, 1.0, requested_duration=0.5),
        _full(2, 1.0, 3.0),
    ]
    with pytest.raises(ImagesDoNotCoverAudio) as exc_info:
        image_coverage.extend_over_gaps(panels, 0.0, 6.0)
    assert str(exc_info.value) == (
        "images_do_not_cover_audio: 3 photos cover 3.0s of 6.0s at requested durations; "
        "need 2 more photos"
    )


def test_requested_durations_do_not_change_the_message_without_requests():
    panels = [_full(0, 0.0, 3.0), _full(1, 3.0, 6.0)]
    with pytest.raises(ImagesDoNotCoverAudio) as exc_info:
        image_coverage.extend_over_gaps(panels, 0.0, 6.0)
    assert str(exc_info.value) == (
        "images_do_not_cover_audio: 2 photos cover 4.0s of 6.0s at 2s each; "
        "need 1 more photo"
    )


def test_a_request_that_squeezes_a_later_photo_out_fails_naming_it():
    panels = [
        _full(0, 0.0, 1.0, requested_duration=4.0),
        _full(1, 1.0, 2.0),
        _full(2, 2.0, 3.0),
    ]
    with pytest.raises(ImagesDoNotCoverAudio) as exc_info:
        image_coverage.extend_over_gaps(panels, 0.0, 6.0)
    assert str(exc_info.value) == (
        "images_do_not_cover_audio: requested durations leave no time "
        "for photo 3 of 3 (segment 2)"
    )
