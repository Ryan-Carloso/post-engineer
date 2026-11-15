"""user_media first photo: the hook opens with the first photo of the video.

first_segment_media selects the first usable media item across segments,
in order — usable means it carries a mediaId or a url, mirroring the web
selector in apps/web/lib/hook-photo.ts and the segment-media path, which
both skip ref-less items; resolve_first_segment_photo downloads it to
the task dir. The segment-media path itself never checks faces (see
test_segment_photos_no_longer_pass_through_face_detection): the face
gate lives on the lip-sync image resolution that consumes this photo.
"""

import io
from unittest.mock import patch

from PIL import Image

from app.models.schema import ScriptSegment
from app.services import image_fetch, user_media


def _jpeg(width=1080, height=1920, color=(200, 80, 40)):
    buffer = io.BytesIO()
    Image.new("RGB", (width, height), color).save(buffer, "JPEG")
    return buffer.getvalue()


# ---- selection: the first media item across segments, in order


def test_selects_the_hook_segments_first_photo():
    segments = [
        {"kind": "hook", "text": "Hi.", "media": [{"url": "https://e.com/a.jpg"}, {"url": "https://e.com/b.jpg"}]},
        {"kind": "content", "text": "More.", "media": [{"url": "https://e.com/c.jpg"}]},
    ]
    assert user_media.first_segment_media(segments) == (0, 0, {"url": "https://e.com/a.jpg"})


def test_selects_the_first_photo_of_a_later_segment_when_the_hook_has_none():
    segments = [
        {"kind": "hook", "text": "Hi."},
        {"kind": "content", "text": "More.", "media": [{"mediaId": "aabbccddeeff00112233445566778899.jpg"}]},
    ]
    found = user_media.first_segment_media(segments)
    assert found is not None
    assert found[0] == 1 and found[1] == 0
    assert found[2] == {"mediaId": "aabbccddeeff00112233445566778899.jpg"}


def test_returns_none_when_no_segment_carries_media():
    segments = [
        {"kind": "hook", "text": "Hi."},
        {"kind": "content", "text": "More.", "media": []},
    ]
    assert user_media.first_segment_media(segments) is None
    assert user_media.first_segment_media([]) is None


def test_skips_non_dict_media_entries():
    segments = [{"kind": "hook", "text": "Hi.", "media": ["not-a-dict", {"url": "https://e.com/a.jpg"}]}]
    assert user_media.first_segment_media(segments) == (0, 1, {"url": "https://e.com/a.jpg"})


def test_skips_media_items_without_a_usable_ref():
    # Mirrors the web selector (apps/web/lib/hook-photo.ts): an item with
    # neither a mediaId nor a url is not a photo — the next usable one is
    # the first photo, so the pre-charge face check and the engine agree.
    segments = [
        {
            "kind": "hook",
            "text": "Hi.",
            "media": [{}, {"mediaId": ""}, {"url": ""}, {"url": "https://e.com/a.jpg"}],
        }
    ]
    assert user_media.first_segment_media(segments) == (
        0,
        3,
        {"url": "https://e.com/a.jpg"},
    )


def test_returns_none_when_every_media_item_lacks_a_usable_ref():
    segments = [{"kind": "hook", "text": "Hi.", "media": [{}, {"mediaId": ""}, {"url": ""}]}]
    assert user_media.first_segment_media(segments) is None


def test_selects_from_pydantic_segments():
    segments = [
        ScriptSegment(kind="hook", text="Hi.", media=[{"url": "https://e.com/a.jpg"}]),
        ScriptSegment(kind="content", text="More.", media=[{"url": "https://e.com/b.jpg"}]),
    ]
    assert user_media.first_segment_media(segments) == (0, 0, {"url": "https://e.com/a.jpg"})


# ---- resolution: download the first photo to the task dir


def test_media_id_resolves_from_the_temp_assets_directory(tmp_path, monkeypatch):
    asset = tmp_path / "aabbccddeeff00112233445566778899.jpg"
    asset.write_bytes(_jpeg())
    monkeypatch.setattr(user_media, "_temp_assets_dir", lambda: str(tmp_path))
    segments = [{"kind": "hook", "text": "Hi.", "media": [{"mediaId": asset.name}]}]
    photo, segment_index, image_index, reason = user_media.resolve_first_segment_photo(
        str(tmp_path), segments
    )
    assert reason is None
    assert (segment_index, image_index) == (0, 0)
    assert photo == str(asset)


def test_url_downloads_into_the_task_dir(tmp_path):
    def download(url, dest_path, session=None):
        with open(dest_path, "wb") as handle:
            handle.write(_jpeg())
        return dest_path

    segments = [{"kind": "hook", "text": "Hi.", "media": [{"url": "https://e.com/a.jpg"}]}]
    with patch.object(image_fetch, "download_image", side_effect=download):
        photo, segment_index, image_index, reason = user_media.resolve_first_segment_photo(
            str(tmp_path), segments
        )
    assert reason is None
    assert (segment_index, image_index) == (0, 0)
    assert photo == str(tmp_path / "segment-media-hook-first.raw")


def test_no_media_reports_no_segment_media(tmp_path):
    segments = [{"kind": "hook", "text": "Hi."}]
    assert user_media.resolve_first_segment_photo(str(tmp_path), segments) == (
        "",
        -1,
        -1,
        "no_segment_media",
    )


def test_expired_media_id_reports_the_per_photo_reason(tmp_path, monkeypatch):
    monkeypatch.setattr(user_media, "_temp_assets_dir", lambda: str(tmp_path))
    segments = [
        {"kind": "hook", "text": "Hi.", "media": [{"mediaId": "aabbccddeeff00112233445566778899.jpg"}]},
    ]
    photo, segment_index, image_index, reason = user_media.resolve_first_segment_photo(
        str(tmp_path), segments
    )
    assert photo == ""
    assert (segment_index, image_index) == (0, 0)
    assert reason == "media expired or missing"


def test_media_without_id_or_url_falls_back_to_no_segment_media(tmp_path):
    # Ref-less items are skipped by selection (see
    # test_skips_media_items_without_a_usable_ref), so a segment with
    # only ref-less media carries no usable first photo: the caller falls
    # back to the persona photo, exactly like the web preflight does.
    segments = [{"kind": "hook", "text": "Hi.", "media": [{}]}]
    photo, segment_index, image_index, reason = user_media.resolve_first_segment_photo(
        str(tmp_path), segments
    )
    assert photo == ""
    assert (segment_index, image_index) == (-1, -1)
    assert reason == "no_segment_media"


def test_ref_less_first_item_resolves_the_next_usable_photo(tmp_path, monkeypatch):
    asset = tmp_path / "aabbccddeeff00112233445566778899.jpg"
    asset.write_bytes(_jpeg())
    monkeypatch.setattr(user_media, "_temp_assets_dir", lambda: str(tmp_path))
    segments = [{"kind": "hook", "text": "Hi.", "media": [{}, {"mediaId": asset.name}]}]
    photo, segment_index, image_index, reason = user_media.resolve_first_segment_photo(
        str(tmp_path), segments
    )
    assert reason is None
    assert (segment_index, image_index) == (0, 1)
    assert photo == str(asset)
