"""Duplicate photos by content: same image bytes under different references.

Exact-repeat validation (segment_media_repeat.check_repeat) only sees
reference strings, so the same file uploaded twice (two mediaIds) or the
same photo behind two signed URLs (different query strings, same bytes)
passes validation. prepare_segment_media hashes the resolved photo bytes
and skips the second copy as "duplicate photo" — labels only, never a
URL, path or mediaId in the warning.
"""

import io
import json
from unittest.mock import patch

from PIL import Image

from app.models.schema import VideoAspect
from app.services import image_fetch, segment_panels, user_media

WORDS = [
    ("Welcome", 0.0, 0.5),
    ("to", 0.5, 0.7),
    ("Porto", 0.7, 1.2),
    ("Where", 2.0, 2.3),
    ("the", 2.3, 2.5),
    ("river", 2.5, 3.0),
    ("meets", 3.0, 3.4),
    ("the", 3.4, 3.6),
    ("sea", 3.6, 4.0),
]


def _jpeg(width=1080, height=1920, color=(200, 80, 40)):
    buffer = io.BytesIO()
    Image.new("RGB", (width, height), color).save(buffer, "JPEG")
    return buffer.getvalue()


def _write_words(tmp_path, words):
    subtitle = str(tmp_path / "subtitle.srt")
    with open(subtitle, "w", encoding="utf-8") as handle:
        handle.write("1\n00:00:00,000 --> 00:00:06,300\nPorto\n\n")
    with open(f"{subtitle}.words.json", "w", encoding="utf-8") as handle:
        json.dump([[text, start, end] for text, start, end in words], handle)
    return subtitle


def _one_segment(media):
    items = media if isinstance(media, list) else [media]
    return [{"kind": "hook", "text": "Welcome to Porto.", "media": items}]


def test_same_bytes_under_two_media_ids_second_is_skipped(tmp_path, monkeypatch):
    first = tmp_path / "aabbccddeeff00112233445566778899.jpg"
    second = tmp_path / "00112233445566778899aabbccddeeff.jpg"
    first.write_bytes(_jpeg())
    second.write_bytes(_jpeg())
    assert first.read_bytes() == second.read_bytes()
    monkeypatch.setattr(user_media, "_temp_assets_dir", lambda: str(tmp_path))
    prepared, skipped = user_media.prepare_segment_media(
        "task-1",
        _one_segment([{"mediaId": first.name}, {"mediaId": second.name}]),
        _write_words(tmp_path, WORDS[:3]),
        1.2,
        str(tmp_path),
        VideoAspect.portrait,
    )
    assert len(prepared) == 1
    assert prepared[0].index == 0
    assert skipped == ["segment 0 image 1 media skipped: duplicate photo"]
    # The warning carries labels only: no mediaId of either copy.
    assert "aabbccdd" not in skipped[0] and "00112233" not in skipped[0]


def test_same_bytes_behind_two_urls_second_is_skipped(tmp_path, monkeypatch):
    monkeypatch.setattr(user_media, "_temp_assets_dir", lambda: str(tmp_path))

    def fake_download(url, dest_path, session=None):
        with open(dest_path, "wb") as handle:
            handle.write(_jpeg())
        return dest_path

    with patch.object(image_fetch, "download_image", side_effect=fake_download):
        prepared, skipped = user_media.prepare_segment_media(
            "task-1",
            _one_segment([
                {"url": "https://e.com/photo.jpg?sig=aaa"},
                {"url": "https://e.com/photo.jpg?sig=bbb"},
            ]),
            _write_words(tmp_path, WORDS[:3]),
            1.2,
            str(tmp_path),
            VideoAspect.portrait,
        )
    assert len(prepared) == 1
    assert skipped == ["segment 0 image 1 media skipped: duplicate photo"]
    # The second download is removed with the skip, not left on disk.
    assert not (tmp_path / "segment-media-0-1.raw").exists()
    # The warning carries labels only: no URL or query string.
    assert "e.com" not in skipped[0] and "sig=" not in skipped[0]


def test_different_photos_are_not_skipped(tmp_path, monkeypatch):
    first = tmp_path / "aabbccddeeff00112233445566778899.jpg"
    second = tmp_path / "00112233445566778899aabbccddeeff.jpg"
    first.write_bytes(_jpeg(color=(200, 80, 40)))
    second.write_bytes(_jpeg(color=(40, 80, 200)))
    assert first.read_bytes() != second.read_bytes()
    monkeypatch.setattr(user_media, "_temp_assets_dir", lambda: str(tmp_path))
    prepared, skipped = user_media.prepare_segment_media(
        "task-1",
        _one_segment([{"mediaId": first.name}, {"mediaId": second.name}]),
        _write_words(tmp_path, WORDS[:3]),
        1.2,
        str(tmp_path),
        VideoAspect.portrait,
    )
    assert len(prepared) == 2
    assert skipped == []


def test_same_bytes_across_segments_second_is_skipped(tmp_path, monkeypatch):
    first = tmp_path / "aabbccddeeff00112233445566778899.jpg"
    second = tmp_path / "00112233445566778899aabbccddeeff.jpg"
    first.write_bytes(_jpeg())
    second.write_bytes(_jpeg())
    assert first.read_bytes() == second.read_bytes()
    monkeypatch.setattr(user_media, "_temp_assets_dir", lambda: str(tmp_path))
    segments = [
        {"kind": "hook", "text": "Welcome to Porto.", "media": [{"mediaId": first.name}]},
        {"kind": "content", "text": "Where the river meets the sea.", "media": [{"mediaId": second.name}]},
    ]
    prepared, skipped = user_media.prepare_segment_media(
        "task-1",
        segments,
        _write_words(tmp_path, WORDS),
        4.0,
        str(tmp_path),
        VideoAspect.portrait,
    )
    assert len(prepared) == 1
    assert prepared[0].index == 0
    assert skipped == ["segment 1 image 0 media skipped: duplicate photo"]


def test_first_copy_that_fails_to_render_does_not_block_its_repeat(tmp_path, monkeypatch):
    # The hash is claimed only once the panel actually exists: a first
    # copy whose panel fails to render placed nothing, so its identical
    # repeat must render instead of being skipped as a duplicate.
    monkeypatch.setattr(user_media, "_temp_assets_dir", lambda: str(tmp_path))

    def fake_download(url, dest_path, session=None):
        with open(dest_path, "wb") as handle:
            handle.write(_jpeg())
        return dest_path

    real_build_full = segment_panels.build_full
    calls = []

    def flaky_build_full(*args, **kwargs):
        calls.append(1)
        if len(calls) == 1:
            return None
        return real_build_full(*args, **kwargs)

    with (
        patch.object(image_fetch, "download_image", side_effect=fake_download),
        patch.object(segment_panels, "build_full", side_effect=flaky_build_full),
    ):
        prepared, skipped = user_media.prepare_segment_media(
            "task-1",
            _one_segment([
                {"url": "https://e.com/photo.jpg?sig=aaa"},
                {"url": "https://e.com/photo.jpg?sig=bbb"},
            ]),
            _write_words(tmp_path, WORDS[:3]),
            1.2,
            str(tmp_path),
            VideoAspect.portrait,
        )
    assert len(prepared) == 1
    assert (prepared[0].start, prepared[0].end) == (0.6, 1.2)
    assert skipped == ["segment 0 image 0 media skipped: photo panel failed to render"]
