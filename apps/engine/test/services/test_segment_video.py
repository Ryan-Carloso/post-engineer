"""segment_video: mp4 clips as segment media (PR-B).

A clip is detected by its .mp4 reference (mediaId or URL path), never by
a new field: the segment contract is unchanged. A usable clip is h264,
1-30s, at least 600x300, within 50M pixels, and portrait-matched when it
plays full-frame — the same bounds as the photo path, plus a duration
cap and a codec gate. Clips loop to fill their take (at most 3 plays);
the check endpoint reuses the photo codes so the web/MCP contract keeps
passing, and the render skip reasons carry the precise wording.
"""

import os
import subprocess
from unittest.mock import patch

import pytest

from app.models.schema import VideoAspect
from app.services import segment_video
from app.services.segment_video import (
    CLIP_DENSITY_ITEMS,
    MAX_CLIP_BYTES,
    MAX_CLIP_DURATION_SECONDS,
    MAX_CLIP_LOOPS,
    MIN_CLIP_DURATION_SECONDS,
)
from app.utils import ssrf


def _clip(tmp_path, name="clip.mp4", seconds=5, width=1080, height=1920,
          color="0xff0000", codec="libx264"):
    path = str(tmp_path / name)
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i",
         f"color=c={color}:s={width}x{height}:r=25:d={seconds}",
         "-c:v", codec, "-pix_fmt", "yuv420p", "-an", path],
        check=True,
    )
    return path


def test_limits_are_explicit_and_sane():
    assert MAX_CLIP_BYTES == 50 * 1024 * 1024
    assert MIN_CLIP_DURATION_SECONDS == 1.0
    assert MAX_CLIP_DURATION_SECONDS == 30.0
    assert MAX_CLIP_LOOPS == 3
    assert CLIP_DENSITY_ITEMS == 4, "one clip stands in for ~12s of speech"
    assert segment_video.VIDEO_CODEC == "h264"


def test_clip_upload_cap_matches_the_temp_asset_cap():
    # A larger clip could never arrive via temp_assets: the two caps must
    # stay equal, or the engine would accept a clip the upload refuses.
    from app.controllers.v1 import temp_assets

    assert MAX_CLIP_BYTES == temp_assets._TEMP_ASSET_MAX_UPLOAD_BYTES


# ---- detection: the .mp4 reference, never a new field


@pytest.mark.parametrize("media,expected", [
    ({"mediaId": "aabbccddeeff00112233445566778899.mp4"}, True),
    ({"mediaId": "aabbccddeeff00112233445566778899.jpg"}, False),
    ({"url": "https://e.com/broll.mp4"}, True),
    ({"url": "https://e.com/broll.mp4?token=abc"}, True),
    ({"url": "https://e.com/broll.MP4"}, True),
    ({"url": "https://e.com/photo.jpg"}, False),
    ({"mediaId": "aabbccddeeff00112233445566778899.mov"}, False),
    ({"url": "https://e.com/broll.mov"}, False),
    ({}, False),
    ({"overlay": {"title": "Porto"}}, False),
    ("https://e.com/broll.mp4", False),
])
def test_is_video_ref_reads_the_reference_suffix(media, expected):
    assert segment_video.is_video_ref(media) is expected


# ---- probing: ffprobe is the content gate, the suffix is only admission


def test_probe_video_reads_dimensions_duration_and_codec(tmp_path):
    path = _clip(tmp_path, seconds=5)
    probe = segment_video.probe_video(path)
    assert probe is not None
    assert (probe["width"], probe["height"]) == (1080, 1920)
    assert probe["duration"] == pytest.approx(5.0, abs=0.1)
    assert probe["codec_name"] == "h264"


def test_probe_video_returns_none_for_a_non_video_file(tmp_path):
    path = tmp_path / "clip.mp4"
    path.write_bytes(b"not a video at all")
    assert segment_video.probe_video(str(path)) is None


def test_probe_video_returns_none_for_a_missing_file(tmp_path):
    assert segment_video.probe_video(str(tmp_path / "gone.mp4")) is None


def test_probe_video_returns_none_for_audio_only(tmp_path):
    path = str(tmp_path / "audio.mp4")
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:d=2",
         "-c:a", "aac", path],
        check=True,
    )
    assert segment_video.probe_video(path) is None


# ---- validation: same bounds as photos, plus codec and duration


def test_validate_video_accepts_a_portrait_h264_clip(tmp_path):
    assert segment_video.validate_video(_clip(tmp_path), VideoAspect.portrait) is None


def test_validate_video_accepts_a_clip_without_an_aspect_gate(tmp_path):
    assert segment_video.validate_video(_clip(tmp_path, width=1920, height=1080)) is None


def test_validate_video_rejects_a_non_h264_clip(tmp_path):
    path = _clip(tmp_path, codec="mpeg4")
    assert segment_video.validate_video(path, VideoAspect.portrait) == "not_video"


def test_validate_video_rejects_a_landscape_clip_for_a_portrait_video(tmp_path):
    path = _clip(tmp_path, width=1920, height=1080)
    assert segment_video.validate_video(path, VideoAspect.portrait) == "wrong_aspect"
    assert segment_video.validate_video(path, VideoAspect.landscape) is None


def test_validate_video_rejects_a_thumbnail_clip(tmp_path):
    path = _clip(tmp_path, width=100, height=100)
    assert segment_video.validate_video(path, VideoAspect.portrait) == "too_small"


def test_validate_video_rejects_a_clip_longer_than_the_cap(tmp_path):
    path = _clip(tmp_path, seconds=35)
    assert segment_video.validate_video(path, VideoAspect.portrait) == "video_too_long"


def test_validate_video_rejects_a_clip_shorter_than_one_second(tmp_path):
    path = _clip(tmp_path, seconds=0.4)
    assert segment_video.validate_video(path, VideoAspect.portrait) == "not_video"


def test_validate_video_rejects_an_undecodable_file(tmp_path):
    path = tmp_path / "clip.mp4"
    path.write_bytes(b"not a video at all")
    assert segment_video.validate_video(str(path), VideoAspect.portrait) == "not_video"


# ---- download: the SSRF guard and the byte cap, same as photos


def test_download_video_goes_through_the_ssrf_guarded_fetcher(tmp_path):
    dest = str(tmp_path / "clip.raw")
    with patch.object(ssrf, "download_public_file", return_value=dest) as fetch:
        assert segment_video.download_video("https://e.com/broll.mp4", dest) == dest
    fetch.assert_called_once()
    kwargs = fetch.call_args.kwargs
    assert kwargs["max_bytes"] == MAX_CLIP_BYTES
    assert kwargs["allowed_content_types"] == ("video/",)
    assert kwargs["what"] == "segment video clip"


# ---- check: the photo codes, so the web/MCP contract keeps passing


def test_check_media_file_reports_dimensions_and_no_face_verdict(tmp_path):
    path = _clip(tmp_path, seconds=5)
    assert segment_video.check_media_file(path, VideoAspect.portrait) == {
        "code": "ok", "width": 1080, "height": 1920, "has_face": None,
    }


def test_check_media_file_maps_a_bad_codec_to_the_photo_code(tmp_path):
    path = _clip(tmp_path, codec="mpeg4")
    result = segment_video.check_media_file(path, VideoAspect.portrait)
    assert result["code"] == "not_image"
    assert result["has_face"] is None


def test_check_media_file_maps_too_long_to_too_large(tmp_path):
    path = _clip(tmp_path, seconds=35)
    assert segment_video.check_media_file(path, VideoAspect.portrait)["code"] == "too_large"


def test_check_media_file_maps_wrong_aspect_through(tmp_path):
    path = _clip(tmp_path, width=1920, height=1080)
    result = segment_video.check_media_file(path, VideoAspect.portrait)
    assert result["code"] == "wrong_aspect"
    assert (result["width"], result["height"]) == (1920, 1080)


def test_check_media_id_reports_expired_for_a_missing_asset(tmp_path, monkeypatch):
    monkeypatch.setattr(segment_video, "_temp_assets_dir", lambda: str(tmp_path))
    assert segment_video.check_media_id(
        "ffffffffffffffffffffffffffffffff.mp4", VideoAspect.portrait
    ) == {"code": "media_expired", "width": None, "height": None, "has_face": None}


def test_check_media_id_checks_a_real_asset(tmp_path, monkeypatch):
    monkeypatch.setattr(segment_video, "_temp_assets_dir", lambda: str(tmp_path))
    name = "aabbccddeeff00112233445566778899.mp4"
    (tmp_path / name).write_bytes(open(_clip(tmp_path, name="src.mp4"), "rb").read())
    assert segment_video.check_media_id(name, VideoAspect.portrait)["code"] == "ok"


def test_check_media_url_reports_the_download_failure_code(tmp_path):
    def download(url, dest_path, session=None):
        raise ssrf.UnsafeUrlError("clip download failed: HTTP 403.")

    with patch.object(segment_video, "download_video", side_effect=download):
        result = segment_video.check_media_url(
            "https://e.com/broll.mp4", VideoAspect.portrait, str(tmp_path)
        )
    assert result == {"code": "blocked_403", "width": None, "height": None, "has_face": None}
    assert not os.path.exists(os.path.join(str(tmp_path), "check-media-clip.raw"))


# ---- clip_panel: the render item (copied into the task dir, never the temp asset)


def _panel_clip(tmp_path, name="clip.mp4", seconds=5):
    return _clip(tmp_path, name=name, seconds=seconds)


def test_clip_panel_copies_the_temp_asset_into_the_task_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(segment_video, "_temp_assets_dir", lambda: str(tmp_path))
    source = _panel_clip(tmp_path, name="aabbccddeeff00112233445566778899.mp4")
    task_dir = tmp_path / "task"
    task_dir.mkdir()
    media = {"mediaId": "aabbccddeeff00112233445566778899.mp4"}
    panel, lines = segment_video.clip_panel(
        media, 0, 0, 0.0, 6.0, str(task_dir), VideoAspect.portrait,
        on_face=False, seen={},
    )
    assert lines == []
    assert panel is not None
    assert panel.path == str(task_dir / "segment-clip-0-0.mp4")
    assert panel.path != source, "the manifest must not point at the 1h-TTL temp asset"
    assert os.path.exists(source), "the temp asset stays for the caller"
    assert panel.clip_seconds == pytest.approx(5.0, abs=0.1)
    assert (panel.start, panel.end) == (0.0, 6.0)
    assert (panel.x, panel.y) == (0, 0)
    assert panel.caption_bottom is None, "a clip is always full-frame"
    assert panel.motion is None, "a clip plays as-is, never zoomed"
    assert (panel.frame_width, panel.frame_height) == (1080, 1920)


def test_clip_panel_downloads_a_url_clip_into_the_task_dir(tmp_path):
    source = _panel_clip(tmp_path, name="src.mp4")
    task_dir = tmp_path / "task"
    task_dir.mkdir()

    def download(url, dest_path, session=None):
        with open(dest_path, "wb") as handle:
            handle.write(open(source, "rb").read())
        return dest_path

    with patch.object(segment_video, "download_video", side_effect=download):
        panel, lines = segment_video.clip_panel(
            {"url": "https://e.com/broll.mp4"}, 1, 0, 2.0, 8.0, str(task_dir),
            VideoAspect.portrait, on_face=False, seen={},
        )
    assert lines == []
    assert panel is not None
    assert panel.path == str(task_dir / "segment-clip-1-0.mp4")
    assert panel.clip_seconds == pytest.approx(5.0, abs=0.1)


def test_clip_panel_skips_a_clip_over_the_personas_face(tmp_path):
    media = {"mediaId": "aabbccddeeff00112233445566778899.mp4"}
    panel, lines = segment_video.clip_panel(
        media, 0, 0, 0.0, 6.0, str(tmp_path), VideoAspect.portrait,
        on_face=True, seen={},
    )
    assert panel is None
    assert lines == ["segment 0 image 0 media skipped: video clip cannot cover the persona's face"]


def test_clip_panel_skips_an_invalid_clip_naming_why(tmp_path, monkeypatch):
    monkeypatch.setattr(segment_video, "_temp_assets_dir", lambda: str(tmp_path))
    (tmp_path / "aabbccddeeff00112233445566778899.mp4").write_bytes(b"not a video")
    panel, lines = segment_video.clip_panel(
        {"mediaId": "aabbccddeeff00112233445566778899.mp4"}, 0, 0, 0.0, 6.0,
        str(tmp_path), VideoAspect.portrait, on_face=False, seen={},
    )
    assert panel is None
    assert lines == ["segment 0 image 0 media skipped: not a video clip"]


def test_clip_panel_skips_a_too_long_clip_naming_its_seconds(tmp_path, monkeypatch):
    monkeypatch.setattr(segment_video, "_temp_assets_dir", lambda: str(tmp_path))
    _clip(tmp_path, name="aabbccddeeff00112233445566778899.mp4", seconds=35)
    panel, lines = segment_video.clip_panel(
        {"mediaId": "aabbccddeeff00112233445566778899.mp4"}, 0, 0, 0.0, 6.0,
        str(tmp_path), VideoAspect.portrait, on_face=False, seen={},
    )
    assert panel is None
    assert lines == [
        "segment 0 image 0 media skipped: video clip is too long (35.0s; max 30s)"
    ]


def test_clip_panel_skips_a_repeat_under_a_different_reference(tmp_path, monkeypatch):
    monkeypatch.setattr(segment_video, "_temp_assets_dir", lambda: str(tmp_path))
    _clip(tmp_path, name="aabbccddeeff00112233445566778899.mp4")
    _clip(tmp_path, name="00112233445566778899aabbccddeeff.mp4")
    seen: dict = {}
    panel, lines = segment_video.clip_panel(
        {"mediaId": "aabbccddeeff00112233445566778899.mp4"}, 0, 0, 0.0, 6.0,
        str(tmp_path), VideoAspect.portrait, on_face=False, seen=seen,
    )
    assert panel is not None and lines == []
    panel2, lines2 = segment_video.clip_panel(
        {"mediaId": "00112233445566778899aabbccddeeff.mp4"}, 1, 0, 6.0, 12.0,
        str(tmp_path), VideoAspect.portrait, on_face=False, seen=seen,
    )
    assert panel2 is None
    assert lines2 == ["segment 1 image 0 media skipped: duplicate video clip"]


def test_clip_panel_keeps_the_clip_and_warns_when_an_overlay_is_asked(tmp_path, monkeypatch):
    monkeypatch.setattr(segment_video, "_temp_assets_dir", lambda: str(tmp_path))
    _clip(tmp_path, name="aabbccddeeff00112233445566778899.mp4")
    panel, lines = segment_video.clip_panel(
        {"mediaId": "aabbccddeeff00112233445566778899.mp4",
         "overlay": {"title": "Porto"}},
        0, 0, 0.0, 6.0, str(tmp_path), VideoAspect.portrait, on_face=False, seen={},
    )
    assert panel is not None
    assert lines == [
        "segment 0 image 0 media overlay skipped: overlays are not supported on video clips"
    ]
