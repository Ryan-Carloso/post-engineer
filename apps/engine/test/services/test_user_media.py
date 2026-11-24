"""user_media: per-segment photos for voiceover videos (MCP first, Phase 2).

A segment carries either a mediaId (an media (action: upload) temp asset) or a
direct image URL. The photo occupies the segment's spoken interval, found
by walking Whisper's word times; when the walk cannot match exactly
(numbers, contractions, punctuation) the intervals fall back to timing
proportional to word counts, and the fallback is reported, never hidden.
A bad URL costs only that segment's photo, never the video: the skip is
recorded as a task warning the status endpoint surfaces.
"""

import io
import json
from unittest.mock import patch

import pytest
from PIL import Image

from app.models.schema import VideoAspect, VideoParams
from app.services import face_detect, image_coverage, image_fetch, user_media
from app.utils import ssrf

WORDS = [
    ("Welcome", 0.0, 0.5),
    ("to", 0.5, 0.7),
    ("Porto", 0.7, 1.2),
    ("where", 2.0, 2.3),
    ("the", 2.3, 2.5),
    ("river", 2.5, 3.0),
    ("meets", 3.0, 3.4),
    ("the", 3.4, 3.6),
    ("sea", 3.6, 4.0),
    ("Visit", 5.0, 5.4),
    ("Porto", 5.4, 5.9),
    ("soon", 5.9, 6.3),
]

SEGMENTS = [
    {"kind": "hook", "text": "Welcome to Porto."},
    {"kind": "content", "text": "Where the river meets the sea."},
    {"kind": "content", "text": "Visit Porto soon."},
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


def _params(**overrides):
    values = {
        "video_title": "Porto trip",
        "video_description": "Test description.",
        "video_type": "voiceover",
    }
    values.update(overrides)
    return VideoParams(**values)



def test_segment_media_limit_is_the_engine_photo_limit_not_the_library_limit():
    assert user_media.MAX_SEGMENT_MEDIA_BYTES == image_fetch.MAX_PHOTO_BYTES
    assert user_media.MAX_SEGMENT_MEDIA_BYTES == 8 * 1024 * 1024
    assert user_media.MAX_SEGMENT_MEDIA_BYTES != 10 * 1024 * 1024



def _media_segments(tmp_path, media):
    items = media if isinstance(media, list) else [media]
    return [{"kind": "hook", "text": "Welcome to Porto.", "media": items}]


def test_media_id_resolves_from_the_temp_assets_directory(tmp_path, monkeypatch):
    asset = tmp_path / "aabbccddeeff00112233445566778899.jpg"
    asset.write_bytes(_jpeg())
    monkeypatch.setattr(user_media, "_temp_assets_dir", lambda: str(tmp_path))
    prepared, skipped = user_media.prepare_segment_media(
        "task-1",
        _media_segments(tmp_path, {"mediaId": asset.name}),
        _write_words(tmp_path, WORDS[:3]),
        1.2,
        str(tmp_path),
        VideoAspect.portrait,
    )
    assert skipped == []
    assert len(prepared) == 1
    assert prepared[0].start == 0.0 and prepared[0].end == 1.2
    assert prepared[0].path.endswith(".png")


def test_expired_media_id_is_skipped_not_fatal(tmp_path, monkeypatch):
    monkeypatch.setattr(user_media, "_temp_assets_dir", lambda: str(tmp_path))
    prepared, skipped = user_media.prepare_segment_media(
        "task-1",
        _media_segments(tmp_path, {"mediaId": "aabbccddeeff00112233445566778899.jpg"}),
        _write_words(tmp_path, WORDS[:3]),
        1.2,
        str(tmp_path),
        VideoAspect.portrait,
    )
    assert prepared == []
    assert len(skipped) == 1
    assert "segment 0" in skipped[0]


def test_path_traversal_media_id_is_rejected(tmp_path, monkeypatch):
    monkeypatch.setattr(user_media, "_temp_assets_dir", lambda: str(tmp_path))
    prepared, skipped = user_media.prepare_segment_media(
        "task-1",
        _media_segments(tmp_path, {"mediaId": "../secret.jpg"}),
        _write_words(tmp_path, WORDS[:3]),
        1.2,
        str(tmp_path),
        VideoAspect.portrait,
    )
    assert prepared == []
    assert skipped


def test_one_bad_url_costs_only_that_segment(tmp_path, monkeypatch):
    good = tmp_path / "good.jpg"
    good.write_bytes(_jpeg())
    monkeypatch.setattr(user_media, "_temp_assets_dir", lambda: str(tmp_path))

    def fake_download(url, dest_path, session=None):
        if "bad" in url:
            raise ssrf.UnsafeUrlError("photo download failed: HTTP 403.")
        with open(dest_path, "wb") as handle:
            handle.write(_jpeg())
        return dest_path

    segments = [
        {"kind": "hook", "text": "Welcome to Porto.", "media": [{"url": "https://e.com/bad.jpg"}]},
        {"kind": "content", "text": "Where the river meets the sea.", "media": [{"url": "https://e.com/good.jpg"}]},
        {"kind": "content", "text": "Visit Porto soon."},
    ]
    with patch.object(image_fetch, "download_image", side_effect=fake_download):
        prepared, skipped = user_media.prepare_segment_media(
            "task-1",
            segments,
            _write_words(tmp_path, WORDS),
            6.3,
            str(tmp_path),
            VideoAspect.portrait,
        )
    assert len(prepared) == 1
    assert prepared[0].index == 1
    assert len(skipped) == 1
    assert "segment 0" in skipped[0]
    assert "e.com" not in skipped[0] and "bad.jpg" not in skipped[0]


def test_only_the_too_small_photo_is_skipped(tmp_path, monkeypatch):
    monkeypatch.setattr(user_media, "_temp_assets_dir", lambda: str(tmp_path))

    def fake_download(url, dest_path, session=None):
        size = (100, 100) if "small" in url else (1080, 1920)
        with open(dest_path, "wb") as handle:
            handle.write(_jpeg(*size))
        return dest_path

    segments = [
        {"kind": "hook", "text": "Welcome to Porto.", "media": [{"url": "https://e.com/small.jpg"}]},
        {"kind": "content", "text": "Where the river meets the sea.", "media": [{"url": "https://e.com/face.jpg"}]},
        {"kind": "content", "text": "Visit Porto soon."},
    ]
    with patch.object(image_fetch, "download_image", side_effect=fake_download):
        prepared, skipped = user_media.prepare_segment_media(
            "task-1",
            segments,
            _write_words(tmp_path, WORDS),
            6.3,
            str(tmp_path),
            VideoAspect.portrait,
        )
    assert len(prepared) == 1
    assert prepared[0].index == 1
    assert len(skipped) == 1
    assert "too small" in skipped[0]


def test_expired_media_id_reports_expired_not_invalid(tmp_path, monkeypatch):
    monkeypatch.setattr(user_media, "_temp_assets_dir", lambda: str(tmp_path))
    photo, reason = user_media._resolve_media_id("abc123def456abc123def456abc12345.jpg")
    assert photo == ""
    assert reason == "media expired or missing"



def _check(url, tmp_path, download=None):
    work = str(tmp_path)
    if download is not None:
        with patch.object(image_fetch, "download_image", side_effect=download):
            return user_media.check_media_code(url, work)
    return user_media.check_media_code(url, work)


def test_check_media_ok_for_a_good_portrait_photo(tmp_path):
    def download(url, dest_path, session=None):
        with open(dest_path, "wb") as handle:
            handle.write(_jpeg())
        return dest_path

    assert _check("https://e.com/porto.jpg", tmp_path, download) == "ok"


def test_check_media_blocked_403_when_the_host_refuses(tmp_path):
    def download(url, dest_path, session=None):
        raise ssrf.UnsafeUrlError("photo download failed: HTTP 403.")

    assert _check("https://e.com/porto.jpg", tmp_path, download) == "blocked_403"


def test_check_media_not_image_when_the_body_is_not_an_image(tmp_path):
    def download(url, dest_path, session=None):
        raise ssrf.UnsafeUrlError("photo has an unexpected content-type (text/html).")

    assert _check("https://e.com/porto.jpg", tmp_path, download) == "not_image"


def test_check_media_too_large_when_the_download_exceeds_the_photo_limit(tmp_path):
    def download(url, dest_path, session=None):
        raise ssrf.UnsafeUrlError("photo exceeds the download limit of 8 MB.")

    assert _check("https://e.com/porto.jpg", tmp_path, download) == "too_large"


def test_check_media_too_small_for_a_thumbnail(tmp_path):
    def download(url, dest_path, session=None):
        with open(dest_path, "wb") as handle:
            handle.write(_jpeg(100, 100))
        return dest_path

    assert _check("https://e.com/porto.jpg", tmp_path, download) == "too_small"


def test_check_media_timeout_when_the_download_times_out(tmp_path):
    import requests

    def download(url, dest_path, session=None):
        raise requests.exceptions.ConnectTimeout("timed out")

    assert _check("https://e.com/porto.jpg", tmp_path, download) == "timeout"


def test_segment_photos_no_longer_pass_through_face_detection():
    assert "face_detected" not in user_media.CHECK_CODES
    assert "face_detected" not in user_media._CODE_TO_REASON


def test_check_media_ok_for_a_photo_with_people(tmp_path):
    def download(url, dest_path, session=None):
        with open(dest_path, "wb") as handle:
            handle.write(_jpeg())
        return dest_path

    assert _check("https://e.com/porto.jpg", tmp_path, download) == "ok"


def test_two_photos_split_the_segment_and_a_dropped_one_fails_the_task(tmp_path):
    def fake_download(url, dest_path, session=None):
        if "drop" in url:
            raise ssrf.UnsafeUrlError("photo download failed: HTTP 403.")
        with open(dest_path, "wb") as handle:
            handle.write(_jpeg(color=(200, 80, 40) if "a.jpg" in url else (40, 80, 200)))
        return dest_path

    words = [("Welcome", 0.0, 2.0), ("to", 2.0, 3.0), ("Porto", 3.0, 4.0)]
    both = [{
        "kind": "hook",
        "text": "Welcome to Porto.",
        "media": [{"url": "https://e.com/a.jpg"}, {"url": "https://e.com/b.jpg"}],
    }]
    with patch.object(image_fetch, "download_image", side_effect=fake_download):
        prepared, skipped = user_media.prepare_segment_media(
            "task-1", both, _write_words(tmp_path, words), 4.0, str(tmp_path), VideoAspect.portrait,
        )
    assert skipped == []
    assert [(panel.start, panel.end) for panel in prepared] == [(0.0, 2.0), (2.0, 4.0)]
    assert prepared[0].path.endswith("segment-panel-0-0.png")
    assert prepared[1].path.endswith("segment-panel-0-1.png")

    dropped = [{
        "kind": "hook",
        "text": "Welcome to Porto.",
        "media": [{"url": "https://e.com/drop.jpg"}, {"url": "https://e.com/keep.jpg"}],
    }]
    with patch.object(image_fetch, "download_image", side_effect=fake_download):
        prepared, skipped = user_media.prepare_segment_media(
            "task-1", dropped, _write_words(tmp_path, words), 4.0, str(tmp_path), VideoAspect.portrait,
        )
    assert skipped == ["segment 0 image 0 media skipped: download blocked"]
    assert [(panel.start, panel.end) for panel in prepared] == [(2.0, 4.0)]
    with pytest.raises(image_coverage.ImagesDoNotCoverAudio) as exc_info:
        image_coverage.extend_over_gaps(prepared, 0.0, 4.0)
    assert str(exc_info.value) == (
        "images_do_not_cover_audio: 1 photo covers 3.0s of 4.0s at most 1.5x their pace each; "
        "need 1 more photo"
    )



def test_photo_validation_rejects_a_landscape_photo_for_a_portrait_video(tmp_path):
    path = str(tmp_path / "landscape.jpg")
    with open(path, "wb") as handle:
        handle.write(_jpeg(1920, 1080))
    assert image_fetch.validate_photo(path, VideoAspect.portrait) == "wrong_aspect"
    assert image_fetch.validate_photo(path, VideoAspect.landscape) is None
    assert image_fetch.validate_photo(path) is None


def test_check_media_code_reports_wrong_aspect_for_a_landscape_photo(tmp_path):
    def download(url, dest_path, session=None):
        with open(dest_path, "wb") as handle:
            handle.write(_jpeg(1920, 1080))
        return dest_path

    with patch.object(image_fetch, "download_image", side_effect=download):
        assert (
            user_media.check_media_code("https://e.com/porto.jpg", str(tmp_path), VideoAspect.portrait)
            == "wrong_aspect"
        )
        assert (
            user_media.check_media_code("https://e.com/porto.jpg", str(tmp_path))
            == "ok"
        )


def test_check_media_detail_for_a_media_id_reports_dimensions(tmp_path, monkeypatch):
    monkeypatch.setattr(user_media, "_temp_assets_dir", lambda: str(tmp_path))
    portrait = tmp_path / "aabbccddeeff00112233445566778899.jpg"
    portrait.write_bytes(_jpeg(1080, 1920))
    assert user_media.check_media_detail(
        media_id=portrait.name, aspect=VideoAspect.portrait
    ) == {"code": "ok", "width": 1080, "height": 1920, "has_face": False}
    landscape = tmp_path / "00112233445566778899aabbccddeeff.jpg"
    landscape.write_bytes(_jpeg(1920, 1080))
    assert user_media.check_media_detail(
        media_id=landscape.name, aspect=VideoAspect.portrait
    ) == {"code": "wrong_aspect", "width": 1920, "height": 1080, "has_face": False}
    assert user_media.check_media_detail(
        media_id="ffffffffffffffffffffffffffffffff.jpg", aspect=VideoAspect.portrait
    ) == {"code": "media_expired", "width": None, "height": None, "has_face": None}


def test_check_media_detail_reports_has_face_for_a_media_id(tmp_path, monkeypatch):
    monkeypatch.setattr(user_media, "_temp_assets_dir", lambda: str(tmp_path))
    portrait = tmp_path / "aabbccddeeff00112233445566778899.jpg"
    portrait.write_bytes(_jpeg(1080, 1920))
    with patch.object(face_detect, "image_contains_face", return_value=True) as detector:
        result = user_media.check_media_detail(media_id=portrait.name)
    assert result == {"code": "ok", "width": 1080, "height": 1920, "has_face": True}
    detector.assert_called_once_with(str(portrait))


def test_check_media_detail_skips_face_detection_for_a_rejected_file(tmp_path, monkeypatch):
    monkeypatch.setattr(user_media, "_temp_assets_dir", lambda: str(tmp_path))
    not_image = tmp_path / "aabbccddeeff00112233445566778899.jpg"
    not_image.write_bytes(b"not an image at all")
    with patch.object(face_detect, "image_contains_face") as detector:
        result = user_media.check_media_detail(media_id=not_image.name)
    assert result == {"code": "not_image", "width": None, "height": None, "has_face": None}
    detector.assert_not_called()

    tiny = tmp_path / "00112233445566778899aabbccddeeff.jpg"
    tiny.write_bytes(_jpeg(10, 10))
    with patch.object(face_detect, "image_contains_face") as detector:
        result = user_media.check_media_detail(media_id=tiny.name)
    assert result == {"code": "too_small", "width": 10, "height": 10, "has_face": None}
    detector.assert_not_called()

    huge = tmp_path / "2233445566778899aabbccddeeff0011.jpg"
    huge.write_bytes(_jpeg(8000, 7000))
    with patch.object(face_detect, "image_contains_face") as detector:
        result = user_media.check_media_detail(media_id=huge.name)
    assert result == {"code": "too_large", "width": 8000, "height": 7000, "has_face": None}
    detector.assert_not_called()


def test_check_media_detail_still_detects_faces_for_a_wrong_aspect_file(tmp_path, monkeypatch):
    monkeypatch.setattr(user_media, "_temp_assets_dir", lambda: str(tmp_path))
    landscape = tmp_path / "aabbccddeeff00112233445566778899.jpg"
    landscape.write_bytes(_jpeg(1920, 1080))
    with patch.object(face_detect, "image_contains_face", return_value=True) as detector:
        result = user_media.check_media_detail(
            media_id=landscape.name, aspect=VideoAspect.portrait
        )
    assert result == {"code": "wrong_aspect", "width": 1920, "height": 1080, "has_face": True}
    detector.assert_called_once_with(str(landscape))


def test_check_media_detail_skips_face_detection_for_a_rejected_url(tmp_path):
    def download(url, dest_path, session=None):
        with open(dest_path, "wb") as handle:
            handle.write(b"not an image at all")
        return dest_path

    with (
        patch.object(image_fetch, "download_image", side_effect=download),
        patch.object(face_detect, "image_contains_face") as detector,
    ):
        result = user_media.check_media_detail(url="https://e.com/a.jpg", work_dir=str(tmp_path))
    assert result == {"code": "not_image", "width": None, "height": None, "has_face": None}
    detector.assert_not_called()


def test_check_media_detail_reports_has_face_none_when_the_detector_is_unavailable(
    tmp_path, monkeypatch
):
    monkeypatch.setattr(user_media, "_temp_assets_dir", lambda: str(tmp_path))
    portrait = tmp_path / "aabbccddeeff00112233445566778899.jpg"
    portrait.write_bytes(_jpeg(1080, 1920))
    with patch.object(face_detect, "image_contains_face", return_value=None):
        result = user_media.check_media_detail(media_id=portrait.name)
    assert result["has_face"] is None
    assert result["code"] == "ok"


def test_check_media_detail_reports_has_face_for_a_url(tmp_path):
    def download(url, dest_path, session=None):
        with open(dest_path, "wb") as handle:
            handle.write(_jpeg())
        return dest_path

    with (
        patch.object(image_fetch, "download_image", side_effect=download),
        patch.object(face_detect, "image_contains_face", return_value=True),
    ):
        result = user_media.check_media_detail(url="https://e.com/porto.jpg", work_dir=str(tmp_path))
    assert result == {"code": "ok", "width": 1080, "height": 1920, "has_face": True}


def test_check_media_detail_still_passes_a_voiceover_photo(tmp_path, monkeypatch):
    monkeypatch.setattr(user_media, "_temp_assets_dir", lambda: str(tmp_path))
    portrait = tmp_path / "aabbccddeeff00112233445566778899.jpg"
    portrait.write_bytes(_jpeg(1080, 1920))
    with patch.object(face_detect, "image_contains_face", return_value=False):
        result = user_media.check_media_detail(media_id=portrait.name)
    assert result == {"code": "ok", "width": 1080, "height": 1920, "has_face": False}


def test_resolve_media_id_skips_a_wrong_ratio_photo_with_both_ratios_named(
    tmp_path, monkeypatch
):
    asset = tmp_path / "aabbccddeeff00112233445566778899.jpg"
    asset.write_bytes(_jpeg(1920, 1080))
    monkeypatch.setattr(user_media, "_temp_assets_dir", lambda: str(tmp_path))
    prepared, skipped = user_media.prepare_segment_media(
        "task-1",
        _media_segments(tmp_path, {"mediaId": asset.name}),
        _write_words(tmp_path, WORDS[:3]),
        1.2,
        str(tmp_path),
        VideoAspect.portrait,
    )
    assert prepared == []
    assert skipped == [
        "segment 0 image 0 media skipped: wrong aspect ratio "
        "(1920x1080 (16:9); expected 9:16 (1080x1920))"
    ]



def _clip(tmp_path, name="clip.mp4", seconds=5, width=1080, height=1920, codec="libx264"):
    import subprocess

    path = str(tmp_path / name)
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i",
         f"color=c=0xff0000:s={width}x{height}:r=25:d={seconds}",
         "-c:v", codec, "-pix_fmt", "yuv420p", "-an", path],
        check=True,
    )
    return path


def _check_clip(url, tmp_path, blob, aspect=None):
    from app.services import segment_video

    def download(url, dest_path, session=None):
        with open(dest_path, "wb") as handle:
            handle.write(blob)
        return dest_path

    with patch.object(segment_video, "download_video", side_effect=download):
        return user_media.check_media_code(url, str(tmp_path), aspect)


def test_check_media_ok_for_a_good_portrait_clip(tmp_path):
    blob = open(_clip(tmp_path), "rb").read()
    assert _check_clip("https://e.com/broll.mp4", tmp_path, blob) == "ok"


def test_check_media_not_image_for_a_non_h264_clip(tmp_path):
    blob = open(_clip(tmp_path, codec="mpeg4"), "rb").read()
    assert _check_clip("https://e.com/broll.mp4", tmp_path, blob) == "not_image"


def test_check_media_too_large_for_a_clip_over_the_duration_cap(tmp_path):
    blob = open(_clip(tmp_path, seconds=35), "rb").read()
    assert _check_clip("https://e.com/broll.mp4", tmp_path, blob) == "too_large"


def test_check_media_wrong_aspect_for_a_landscape_clip(tmp_path):
    blob = open(_clip(tmp_path, width=1920, height=1080), "rb").read()
    assert (
        _check_clip("https://e.com/broll.mp4", tmp_path, blob, VideoAspect.portrait)
        == "wrong_aspect"
    )


def test_check_media_detail_for_a_clip_media_id_reports_dimensions_and_no_face(
    tmp_path, monkeypatch
):
    from app.services import segment_video

    monkeypatch.setattr(user_media, "_temp_assets_dir", lambda: str(tmp_path))
    monkeypatch.setattr(segment_video, "_temp_assets_dir", lambda: str(tmp_path))
    name = "aabbccddeeff00112233445566778899.mp4"
    (tmp_path / name).write_bytes(open(_clip(tmp_path, name="src.mp4"), "rb").read())
    assert user_media.check_media_detail(
        media_id=name, aspect=VideoAspect.portrait
    ) == {"code": "ok", "width": 1080, "height": 1920, "has_face": None}
    assert user_media.check_media_detail(
        media_id="ffffffffffffffffffffffffffffffff.mp4", aspect=VideoAspect.portrait
    ) == {"code": "media_expired", "width": None, "height": None, "has_face": None}
