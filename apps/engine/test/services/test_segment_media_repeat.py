"""Direct tests for segment_media_repeat.check_repeat.

check_repeat records each media item's first sighting and reports the
second sighting of the same reference: the clip rule for a repeated
video clip, the photo rule for a repeated photo.
"""

from app.services.segment_media_repeat import check_repeat

PHOTO_RULE = "the same photo must not repeat"
PHOTO_FIX = "Use a different photo for each media item."
CLIP_RULE = "the same video clip must not repeat"
CLIP_FIX = "Use a different video clip for each media item."


def test_first_photo_sighting_records_and_returns_none():
    seen: set[tuple[str, str]] = set()
    assert check_repeat({"mediaId": "abc123"}, seen) is None
    assert ("mediaId", "abc123") in seen


def test_repeated_photo_returns_the_photo_rule_and_fix():
    seen: set[tuple[str, str]] = set()
    check_repeat({"mediaId": "abc123"}, seen)
    assert check_repeat({"mediaId": "abc123"}, seen) == (PHOTO_RULE, PHOTO_FIX)


def test_repeated_url_photo_returns_the_photo_rule():
    seen: set[tuple[str, str]] = set()
    check_repeat({"url": "https://e.com/a.jpg"}, seen)
    assert check_repeat({"url": "https://e.com/a.jpg"}, seen) == (PHOTO_RULE, PHOTO_FIX)


def test_repeated_clip_returns_the_clip_rule_and_fix():
    seen: set[tuple[str, str]] = set()
    check_repeat({"mediaId": "abc123.mp4"}, seen)
    assert check_repeat({"mediaId": "abc123.mp4"}, seen) == (CLIP_RULE, CLIP_FIX)
    check_repeat({"url": "https://e.com/b.mp4"}, seen)
    assert check_repeat({"url": "https://e.com/b.mp4"}, seen) == (CLIP_RULE, CLIP_FIX)


def test_media_id_and_url_are_different_identities():
    seen: set[tuple[str, str]] = set()
    check_repeat({"mediaId": "same-value"}, seen)
    assert check_repeat({"url": "same-value"}, seen) is None


def test_values_are_trimmed_before_comparison():
    seen: set[tuple[str, str]] = set()
    check_repeat({"mediaId": "  abc123  "}, seen)
    assert check_repeat({"mediaId": "abc123"}, seen) == (PHOTO_RULE, PHOTO_FIX)


def test_non_dict_items_and_blank_values_are_ignored():
    seen: set[tuple[str, str]] = set()
    assert check_repeat("abc123", seen) is None
    assert check_repeat(None, seen) is None
    assert check_repeat({"mediaId": "   "}, seen) is None
    assert check_repeat({}, seen) is None
    assert seen == set()


def test_first_field_wins_when_both_are_present():
    seen: set[tuple[str, str]] = set()
    assert check_repeat({"mediaId": "abc123", "url": "https://e.com/a.jpg"}, seen) is None
    assert ("mediaId", "abc123") in seen
    assert ("url", "https://e.com/a.jpg") not in seen
