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


def test_thirty_two_words_need_four_photos_and_refuse_one():
    rule, fix = density_error(32, 1)
    assert rule == "segment has 32 words (~12s) and needs at least 4 images (one per ~3s); it has 1."
    assert fix == "Add 3 more images to this segment's media array."


def test_thirty_two_words_accept_four_photos_and_refuse_eleven():
    assert density_error(32, 4) is None
    assert density_error(32, 10) is None
    rule, fix = density_error(32, 11)
    assert rule == "segment has 32 words (~12s) and allows at most 10 images (each image needs ~1s); it has 11."
    assert fix == "Remove images until this segment has at most 10."


def test_a_short_segment_still_needs_one_photo_and_refuses_a_second_when_it_would_flicker():
    # 3 words is about 1s: one photo, and a second would flash.
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
        {"kind": "hook", "text": _words(24, "hook"), "media": _photos(3, "h")},
        {"kind": "body", "text": _words(32, "body"), "media": _photos(1, "b")},
        {"kind": "cta", "text": _words(8, "cta"), "media": _photos(1, "c")},
    ]
    with pytest.raises(SegmentValidationError) as exc_info:
        validate_segments(segments)
    assert exc_info.value.field == "segments.1.media"
    assert exc_info.value.rule == (
        "segment has 32 words (~12s) and needs at least 4 images (one per ~3s); it has 1."
    )
    assert exc_info.value.fix == "Add 3 more images to this segment's media array."
    segments[1]["media"] = _photos(4, "b")
    assert validate_segments(segments)["media_count"] == 8
    segments[1]["media"] = _photos(11, "b")
    with pytest.raises(SegmentValidationError) as exc_info:
        validate_segments(segments)
    assert "at most 10" in exc_info.value.rule and "it has 11" in exc_info.value.rule


def test_validate_segments_rejects_more_than_thirty_photos_and_seven_on_full_lipsync():
    segments = [
        {"kind": "hook", "text": _words(40, "hook"), "media": _photos(13, "h")},
        {"kind": "body", "text": _words(140, "body"), "media": _photos(18, "b")},
        {"kind": "cta", "text": _words(20, "cta"), "media": _photos(6, "c")},
    ]
    with pytest.raises(SegmentValidationError) as exc_info:
        validate_segments(segments)
    assert exc_info.value.field == "segments"
    assert "30" in exc_info.value.rule
    full_lipsync = [
        {"kind": "hook", "text": _words(24, "hook"), "media": _photos(7, "h")},
        {"kind": "body", "text": _words(32, "body")},
        {"kind": "cta", "text": _words(8, "cta")},
    ]
    with pytest.raises(SegmentValidationError) as exc_info:
        validate_segments(full_lipsync, full_lipsync=True)
    assert exc_info.value.rule == "At most 6 medias are allowed."


def test_an_item_without_a_reference_fails_on_that_item():
    segments = [
        {"kind": "hook", "text": _words(24, "hook"), "media": _photos(3, "h")},
        {"kind": "body", "text": _words(32, "body"), "media": [{}, *_photos(3, "b")]},
        {"kind": "cta", "text": _words(8, "cta"), "media": _photos(1, "c")},
    ]
    with pytest.raises(SegmentValidationError) as exc_info:
        validate_segments(segments)
    assert exc_info.value.field == "segments.1.media.0"


def test_constants_are_the_shared_rhythm():
    assert image_density.WORDS_PER_IMAGE == 8
    assert image_density.MIN_WORDS_PER_IMAGE == 3
    assert image_density.MAX_IMAGES_MODE_MEDIAS == 30
