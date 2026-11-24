"""image_coverage duplicate fix: a render-time duplicate skip names the fix.

The render-time error already counts the skips and names every skipped
photo, but it never says what to do about a duplicate. When any skip
reason is a duplicate photo, the detail ends with the fix hint — the
same fix the pre-charge repeat check gives — so the agent replaces the
repeated photo instead of resending it. Non-duplicate skips keep the
message byte-identical to today.
"""

import pytest

from app.services import image_coverage, segment_panels
from app.services.image_coverage import ImagesDoNotCoverAudio
from app.services.segment_panels import Panel

FIX_HINT = "fix: use a different photo for each media item"


def _full(index, start, end):
    return Panel(index=index, path=f"/t/{index}.png", x=0, y=0, start=start, end=end)


def test_duplicate_skips_end_with_the_fix_hint():
    detail = image_coverage.failure_detail(
        sent=3,
        survived=2,
        skipped=["segment 0 image 1 media skipped: duplicate photo"],
        no_full_frame=False,
    )
    assert detail == (
        "3 sent, 2 survived, 1 skipped (duplicate photo x1); "
        "segment 0 image 1 media skipped: duplicate photo; "
        f"{FIX_HINT}"
    )


def test_non_duplicate_skips_carry_no_fix_hint():
    detail = image_coverage.failure_detail(
        sent=3,
        survived=2,
        skipped=["segment 0 image 1 media skipped: download blocked"],
        no_full_frame=False,
    )
    assert detail == (
        "3 sent, 2 survived, 1 skipped (download blocked x1); "
        "segment 0 image 1 media skipped: download blocked"
    )


def test_mixed_skip_reasons_still_carry_the_fix_hint():
    detail = image_coverage.failure_detail(
        sent=4,
        survived=2,
        skipped=[
            "segment 0 image 1 media skipped: duplicate photo",
            "segment 1 image 0 media skipped: download blocked",
        ],
        no_full_frame=False,
    )
    assert detail == (
        "4 sent, 2 survived, 2 skipped (duplicate photo x1, download blocked x1); "
        "segment 0 image 1 media skipped: duplicate photo; "
        "segment 1 image 0 media skipped: download blocked; "
        f"{FIX_HINT}"
    )


def test_ensure_coverage_raise_with_duplicate_skips_names_the_fix():
    panels = [_full(0, 0.0, 4.0), _full(1, 4.0, 8.0)]
    with pytest.raises(ImagesDoNotCoverAudio) as exc_info:
        image_coverage.ensure_coverage(
            panels,
            face=segment_panels.FACE_NONE,
            hook_end=0.0,
            audio_duration=8.0,
            sent=3,
            skipped=["segment 0 image 1 media skipped: duplicate photo"],
        )
    assert str(exc_info.value) == (
        "images_do_not_cover_audio: 3 sent, 2 survived, 1 skipped (duplicate photo x1); "
        "segment 0 image 1 media skipped: duplicate photo; "
        f"{FIX_HINT}"
    )


def test_duplicate_skips_with_no_survivor_name_the_fix():
    with pytest.raises(ImagesDoNotCoverAudio) as exc_info:
        image_coverage.ensure_coverage(
            [],
            face=segment_panels.FACE_NONE,
            hook_end=0.0,
            audio_duration=12.0,
            sent=2,
            skipped=[
                "segment 0 image 0 media skipped: duplicate photo",
                "segment 0 image 1 media skipped: duplicate photo",
            ],
        )
    assert str(exc_info.value) == (
        "images_do_not_cover_audio: no full-frame image survived; "
        "2 sent, 0 survived, 2 skipped (duplicate photo x2); "
        "segment 0 image 0 media skipped: duplicate photo; "
        "segment 0 image 1 media skipped: duplicate photo; "
        f"{FIX_HINT}"
    )
