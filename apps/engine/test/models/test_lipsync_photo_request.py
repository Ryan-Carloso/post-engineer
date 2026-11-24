"""The request contract for full lip-sync face photos.

full_lipsync requires 2-5 different photos (one per 12s window, up to the
5-window ceiling); every other mode rejects the field. The limits mirror
the shared TS contract the web and the MCP validate with.
"""

from pathlib import Path

import pytest
from pydantic import ValidationError

from app.models.schema import PersonaParams, TaskVideoRequest
from app.models.segments import MAX_LIPSYNC_PHOTOS, MIN_LIPSYNC_PHOTOS, LipsyncPhoto
from app.services import full_lipsync
from test.controllers.test_task_segments_request import valid_segments


def _request(video_type="full_lipsync", video_script="Hook. Body. Call to action.", **extra):
    return TaskVideoRequest(
        video_title="Porto",
        video_description="Test description.",
        video_type=video_type,
        video_script=video_script,
        persona=PersonaParams(name="Ana", photo_url="https://img.test/p.png", voice_id="calm"),
        **extra,
    )


def _photos(count):
    return [{"url": f"https://img.test/{i}.png"} for i in range(count)]


def test_full_lipsync_accepts_two_to_five_photos():
    for count in range(MIN_LIPSYNC_PHOTOS, MAX_LIPSYNC_PHOTOS + 1):
        assert len(_request(lipsync_photos=_photos(count)).lipsync_photos) == count


def test_full_lipsync_without_photos_is_rejected():
    with pytest.raises(ValidationError, match="full_lipsync requires lipsync_photos: 2-5"):
        _request()


@pytest.mark.parametrize("count", [1, MAX_LIPSYNC_PHOTOS + 1])
def test_a_count_outside_the_bounds_is_rejected(count):
    with pytest.raises(ValidationError):
        _request(lipsync_photos=_photos(count))


def test_a_repeated_ref_is_rejected():
    with pytest.raises(ValidationError, match="must all be different photos"):
        _request(lipsync_photos=[{"url": "https://img.test/a.png"}, {"url": "https://img.test/a.png"}])


@pytest.mark.parametrize("video_type", ["hook_lipsync", "voiceover"])
def test_other_modes_reject_the_field(video_type):
    extra = {"lipsync_photos": _photos(2)}
    if video_type == "hook_lipsync":
        extra["segments"] = valid_segments()
        extra["video_script"] = ""
    with pytest.raises(ValidationError, match="only accepted for full_lipsync"):
        _request(video_type=video_type, **extra)


def test_voiceover_without_the_field_passes():
    assert _request(video_type="voiceover").lipsync_photos is None


@pytest.mark.parametrize(
    "ref", [{}, {"mediaId": "a" * 32 + ".png", "url": "https://img.test/a.png"}, {"overlay": {}}]
)
def test_each_photo_carries_exactly_one_ref(ref):
    with pytest.raises(ValidationError):
        LipsyncPhoto.model_validate(ref)


def test_the_photo_cap_is_the_window_ceiling():
    assert MAX_LIPSYNC_PHOTOS == full_lipsync.MAX_FULL_LIPSYNC_WINDOWS


def test_the_limits_match_the_shared_contract():
    shared = next(
        parent / "shared" / "contracts" / "videos.ts"
        for parent in Path(__file__).resolve().parents
        if (parent / "shared" / "contracts" / "videos.ts").is_file()
    ).read_text(encoding="utf-8")
    assert f"export const MIN_LIPSYNC_PHOTOS = {MIN_LIPSYNC_PHOTOS};" in shared
    assert f"export const MAX_LIPSYNC_PHOTOS = {MAX_LIPSYNC_PHOTOS};" in shared
    window = full_lipsync.FULL_LIPSYNC_MAX_WINDOW_SECONDS
    assert f"export const LIPSYNC_WINDOW_SECONDS = {int(window)};" in shared
