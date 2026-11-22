"""image_density: photos per spoken second, and how a segment's time is split.

The images material shows the agent's own photos and nothing else. A
segment that talks for ~12s cannot keep one photo on screen the whole
time, and a photo that flashes for under a second is rejected too.
"""

import pytest

from app.services import image_density
from app.services.image_density import density_error, split_interval
from app.services.script_segments import SegmentValidationError, validate_segments


def _words(count: int, token: str) -> str:
    return " ".join([token] * count) + "."


def _photos(count: int, name: str) -> list[dict[str, str]]:
    return [{"url": f"https://example.com/{name}{i}.jpg"} for i in range(count)]


def test_thirty_two_words_need_six_photos_and_refuse_one():
    rule, fix = density_error(32, 1)
    assert rule == "segment has 32 words (~12s) and needs at least 6 images (one per 2s); it has 1."
    assert fix == "Add 5 more images to this segment's media array."


def test_thirty_two_words_accept_six_photos_and_refuse_eleven():
    assert density_error(32, 6) is None
    assert density_error(32, 10) is None
    rule, fix = density_error(32, 11)
    assert rule == "segment has 32 words (~12s) and allows at most 10 images (each image needs ~1s); it has 11."
    assert fix == "Remove images until this segment has at most 10."


def test_a_short_segment_still_needs_one_photo_and_refuses_a_second_when_it_would_flicker():
    assert density_error(3, 1) is None
    rule, _fix = density_error(3, 2)
    assert "at most 1 image" in rule


def test_split_interval_covers_the_segment_without_a_gap_or_an_overlap():
    slices = split_interval(0.0, 6.0, 2)
    assert slices == [(0.0, 3.0), (3.0, 6.0)]
    slices = split_interval(1.0, 4.0, 3)
    assert slices[0][0] == 1.0
    assert slices[-1][1] == 4.0
    assert slices[1][0] == slices[0][1]
    assert split_interval(1.0, 1.0, 2) == []
    assert split_interval(0.0, 5.0, 0) == []


def test_validate_segments_reports_the_same_density_counts():
    segments = [
        {"kind": "hook", "text": _words(25, "hook"), "media": _photos(4, "h")},
        {"kind": "content", "text": _words(32, "body"), "media": _photos(1, "b")},
        {"kind": "content", "text": _words(8, "cta"), "media": _photos(2, "c")},
    ]
    with pytest.raises(SegmentValidationError) as exc_info:
        validate_segments(segments)
    assert exc_info.value.field == "segments.1.media"
    assert exc_info.value.rule == (
        "segment has 32 words (~12s) and needs at least 6 images (one per 2s); it has 1."
    )
    assert exc_info.value.fix == "Add 5 more images to this segment's media array."
    segments[1]["media"] = _photos(6, "b")
    assert validate_segments(segments)["media_count"] == 12
    segments[1]["media"] = _photos(11, "b")
    with pytest.raises(SegmentValidationError) as exc_info:
        validate_segments(segments)
    assert "at most 10" in exc_info.value.rule and "it has 11" in exc_info.value.rule


def test_validate_segments_rejects_more_than_thirty_photos_and_seven_on_full_lipsync():
    segments = [
        {"kind": "hook", "text": _words(40, "hook"), "media": _photos(13, "h")},
        {"kind": "content", "text": _words(140, "body"), "media": _photos(27, "b")},
        {"kind": "content", "text": _words(20, "cta"), "media": _photos(6, "c")},
    ]
    with pytest.raises(SegmentValidationError) as exc_info:
        validate_segments(segments)
    assert exc_info.value.field == "segments"
    assert "30" in exc_info.value.rule
    full_lipsync = [
        {"kind": "hook", "text": _words(25, "hook"), "media": _photos(7, "h")},
        {"kind": "content", "text": _words(32, "body")},
        {"kind": "content", "text": _words(8, "cta")},
    ]
    with pytest.raises(SegmentValidationError) as exc_info:
        validate_segments(full_lipsync, video_type="full_lipsync")
    assert exc_info.value.rule == "At most 6 medias are allowed."


def test_an_item_without_a_reference_fails_on_that_item():
    segments = [
        {"kind": "hook", "text": _words(25, "hook"), "media": _photos(4, "h")},
        {"kind": "content", "text": _words(32, "body"), "media": [{}, *_photos(3, "b")]},
        {"kind": "content", "text": _words(8, "cta"), "media": _photos(1, "c")},
    ]
    with pytest.raises(SegmentValidationError) as exc_info:
        validate_segments(segments)
    assert exc_info.value.field == "segments.1.media.0"


def test_constants_are_the_shared_rhythm():
    assert image_density.WORDS_PER_IMAGE == 8
    assert image_density.MIN_WORDS_PER_IMAGE == 3
    assert image_density.MAX_IMAGES_MODE_MEDIAS == 30
    assert image_density.MAX_PHOTO_SECONDS == 2


def test_min_images_uses_the_render_pace_of_two_seconds_per_photo():
    assert image_density.min_images(32) == 6
    assert image_density.min_images(24) == 5
    assert image_density.min_images(8) == 2
    assert image_density.min_images(3) == 1


def test_density_error_ignores_the_minimum_for_photos_that_never_cover_audio():
    assert density_error(25, 1, covers_audio=False) is None
    rule, fix = density_error(25, 1)
    assert rule == "segment has 25 words (~9s) and needs at least 5 images (one per 2s); it has 1."
    assert fix == "Add 4 more images to this segment's media array."


def test_a_script_that_passes_the_word_count_but_cannot_cover_the_audio_fails_validation():
    segments = [
        {"kind": "hook", "text": _words(25, "hook"), "media": _photos(4, "h")},
        {"kind": "content", "text": _words(60, "body"), "media": _photos(8, "b")},
        {"kind": "content", "text": _words(49, "final"), "media": _photos(8, "f")},
    ]
    with pytest.raises(SegmentValidationError) as exc_info:
        validate_segments(segments)
    assert exc_info.value.field == "segments.1.media"
    assert exc_info.value.rule == (
        "segment has 60 words (~23s) and needs at least 12 images (one per 2s); it has 8."
    )
    assert exc_info.value.fix == "Add 4 more images to this segment's media array."


def test_hook_photos_do_not_count_toward_the_minimum_in_hook_only_videos():
    segments = [
        {"kind": "hook", "text": _words(25, "hook"), "media": _photos(1, "h")},
        {"kind": "content", "text": _words(32, "body"), "media": _photos(6, "b")},
        {"kind": "content", "text": _words(8, "cta"), "media": _photos(2, "c")},
    ]
    assert validate_segments(segments)["media_count"] == 9
    with pytest.raises(SegmentValidationError) as exc_info:
        validate_segments(segments, video_type="faceless")
    assert exc_info.value.field == "segments.0.media"
    assert exc_info.value.rule == (
        "segment has 25 words (~9s) and needs at least 5 images (one per 2s); it has 1."
    )
    assert exc_info.value.fix == "Add 4 more images to this segment's media array."


def test_min_images_counts_the_unrounded_spoken_seconds():
    assert image_density.min_images(6) == 2
    assert image_density.min_images(11) == 3
    assert image_density.min_images(38) == 8
    assert image_density.min_images(200) == 38


def test_covered_slots_counts_a_photo_by_its_requested_duration():
    assert image_density.covered_slots(_photos(6, "b")) == 6
    assert image_density.covered_slots(
        [{**photo, "duration": 1} for photo in _photos(6, "b")]
    ) == 3
    assert image_density.covered_slots(
        [{**photo, "duration": 6} for photo in _photos(3, "b")]
    ) == 9
    assert image_density.covered_slots([{"url": "https://example.com/a.mp4"}]) == 6
    assert image_density.covered_slots(
        [
            {"url": "https://example.com/a.mp4"},
            {"url": "https://example.com/b.jpg", "duration": 1},
        ]
    ) == 6.5


def test_density_error_reports_the_covered_seconds_when_the_count_suffices_but_the_durations_do_not():
    rule, fix = density_error(30, 6, min_count=3.0)
    assert rule == (
        "segment has 30 words (~11s) but its photos cover only ~6s at their "
        "requested durations; it needs ~11s of photos (one photo per 2s)."
    )
    assert fix == "Add 3 more images to this segment's media array."
    assert density_error(30, 6, min_count=6.0) is None
    rule, fix = density_error(30, 3, min_count=3.0)
    assert rule == "segment has 30 words (~11s) and needs at least 6 images (one per 2s); it has 3."
    assert fix == "Add 3 more images to this segment's media array."


def test_validate_segments_counts_a_photo_by_its_requested_duration():
    segments = [
        {"kind": "hook", "text": _words(25, "hook"), "media": _photos(5, "h")},
        {
            "kind": "content",
            "text": _words(38, "body"),
            "media": [{**photo, "duration": 1} for photo in _photos(6, "b")],
        },
        {"kind": "content", "text": _words(8, "cta"), "media": _photos(2, "c")},
    ]
    with pytest.raises(SegmentValidationError) as exc_info:
        validate_segments(segments, video_type="faceless")
    assert exc_info.value.field == "segments.1.media"
    assert exc_info.value.rule == (
        "segment has 38 words (~14s) and needs at least 8 images (one per 2s); it has 6."
    )
    assert exc_info.value.fix == "Add 5 more images to this segment's media array."
    segments[1]["media"] = [{**photo, "duration": 2} for photo in _photos(8, "b")]
    assert validate_segments(segments, video_type="faceless")["media_count"] == 15
    segments[1]["media"] = [{**photo, "duration": 6} for photo in _photos(3, "b")]
    assert validate_segments(segments, video_type="faceless")["media_count"] == 10


def test_a_clip_in_the_hook_of_a_hook_only_video_fails_validation():
    segments = [
        {"kind": "hook", "text": _words(25, "hook"), "media": [{"url": "https://example.com/h.mp4"}]},
        {"kind": "content", "text": _words(42, "body"), "media": _photos(8, "b")},
        {"kind": "content", "text": _words(9, "cta"), "media": _photos(2, "c")},
    ]
    with pytest.raises(SegmentValidationError) as exc_info:
        validate_segments(segments)
    assert exc_info.value.field == "segments.0.media"
    assert exc_info.value.rule == (
        "A clip cannot play over the speaker's face in the hook of a hook-only video."
    )
    assert exc_info.value.fix == (
        "Use photos in the hook segment, or move the clip to a content segment."
    )
    segments[0]["media"] = [{"url": "https://example.com/h.mp4"}, *_photos(3, "h")]
    with pytest.raises(SegmentValidationError) as exc_info:
        validate_segments(segments)
    assert exc_info.value.field == "segments.0.media"
    assert "clip cannot play" in exc_info.value.rule
    assert validate_segments(segments, video_type="faceless")["media_count"] == 14
    full_lipsync = [
        {"kind": "hook", "text": _words(25, "hook"), "media": [{"url": "https://example.com/h.mp4"}]},
        {"kind": "content", "text": _words(42, "body")},
        {"kind": "content", "text": _words(9, "cta")},
    ]
    assert validate_segments(full_lipsync, video_type="full_lipsync")["media_count"] == 1


def test_one_clip_in_a_long_take_still_fails_the_density_minimum_in_faceless_videos():
    segments = [
        {"kind": "hook", "text": _words(40, "hook"), "media": [{"url": "https://example.com/h.mp4"}]},
        {
            "kind": "content",
            "text": _words(42, "body"),
            "media": [{"url": "https://example.com/b1.mp4"}, {"url": "https://example.com/b2.mp4"}],
        },
        {"kind": "content", "text": _words(5, "cta"), "media": _photos(1, "c")},
    ]
    with pytest.raises(SegmentValidationError) as exc_info:
        validate_segments(segments, video_type="faceless")
    assert exc_info.value.field == "segments.0.media"
    assert exc_info.value.rule == (
        "segment has 40 words (~15s) and needs at least 8 images (one per 2s); it has 1."
    )
    assert exc_info.value.fix == "Add 2 more images to this segment's media array."


def test_density_error_names_the_flicker_cap_when_adding_photos_would_exceed_it():
    rule, fix = density_error(40, 8, min_count=2.0)
    assert rule == (
        "segment has 40 words (~15s); its photos cover only ~4s at their "
        "requested durations, and adding 6 more images would exceed the "
        "13-image flicker cap."
    )
    assert fix == "Increase the durations of the short photos, or replace them with longer ones."
    rule, fix = density_error(40, 8, min_count=6.0)
    assert rule == (
        "segment has 40 words (~15s) but its photos cover only ~12s at their "
        "requested durations; it needs ~15s of photos (one photo per 2s)."
    )
    assert fix == "Add 2 more images to this segment's media array."
