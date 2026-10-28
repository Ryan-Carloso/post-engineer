"""user_media: per-segment photos for faceless videos (MCP first, Phase 2).

A segment carries either a mediaId (an upload_media temp asset) or a
direct image URL. The photo occupies the segment's spoken interval, found
by walking Whisper's word times; when the walk cannot match exactly
(numbers, contractions, punctuation) the intervals fall back to timing
proportional to word counts, and the fallback is reported, never hidden.
A bad URL costs only that segment's photo, never the video: the skip is
recorded as a task warning the status endpoint surfaces.
"""

import io
import json
import subprocess
from unittest.mock import patch

import pytest
from PIL import Image

from app.models.schema import VideoAspect, VideoParams
from app.services import place_photos, user_media
from app.services.place_names import PreparedPhoto  # noqa: F401 - pins the shared photo shape
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
    {"kind": "body", "text": "Where the river meets the sea."},
    {"kind": "cta", "text": "Visit Porto soon."},
]


def _jpeg(width=1200, height=800, color=(200, 80, 40)):
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
    values = {"video_subject": "Porto trip"}
    values.update(overrides)
    return VideoParams(**values)


# ---- size limit: the engine photo bottleneck, not the library limit


def test_segment_media_limit_is_the_engine_photo_limit_not_the_library_limit():
    assert user_media.MAX_SEGMENT_MEDIA_BYTES == place_photos.MAX_PHOTO_BYTES
    assert user_media.MAX_SEGMENT_MEDIA_BYTES == 8 * 1024 * 1024
    assert user_media.MAX_SEGMENT_MEDIA_BYTES != 10 * 1024 * 1024


# ---- segment intervals


def test_exact_word_walk_gives_each_segment_its_spoken_interval():
    intervals, fallback = user_media.segment_intervals(SEGMENTS, WORDS, 6.3)
    assert fallback is False
    assert intervals == [(0.0, 1.2), (2.0, 4.0), (5.0, 6.3)]


def test_zero_token_segment_inherits_the_previous_boundary_instead_of_crashing():
    # A punctuation-only segment passes validation (non-empty after
    # strip, split-counted words) but tokenises to zero words. When the
    # subtitle walk otherwise matches exactly, the empty slice must not
    # raise IndexError and fail the whole task: the segment gets a
    # zero-width interval at the previous boundary, so its photo keeps
    # the original clip instead of crashing the video.
    words = [("Porto", 0.0, 1.0), ("walks", 1.0, 2.0), ("now", 2.0, 3.0)]
    segments = [
        {"kind": "hook", "text": "Porto walks."},
        {"kind": "body", "text": "!!! ???"},
        {"kind": "cta", "text": "now."},
    ]
    intervals, fallback = user_media.segment_intervals(segments, words, 3.0)
    assert fallback is False
    assert intervals == [(0.0, 2.0), (2.0, 2.0), (2.0, 3.0)]


def test_contraction_mismatch_falls_back_to_proportional_timing_and_says_so():
    # Whisper splits "don't" into one word; the segment text tokenises
    # into two ("don", "t"), so the exact walk cannot match.
    words = [("I", 0.0, 0.3), ("don't", 0.3, 0.8), ("know", 0.8, 1.2)]
    segments = [
        {"kind": "hook", "text": "I don't know."},
        {"kind": "cta", "text": "Visit Porto soon."},
    ]
    intervals, fallback = user_media.segment_intervals(segments, words, 10.0)
    assert fallback is True
    # Proportional to token counts: "don't" tokenises to 2, so the hook
    # has 4 tokens against the CTA's 3 over 10 seconds.
    assert intervals[0][0] == 0.0
    assert intervals[0][1] == pytest.approx(10.0 * 4 / 7)
    assert intervals[1] == (pytest.approx(10.0 * 4 / 7), 10.0)


def test_no_word_times_means_proportional_intervals():
    intervals, fallback = user_media.segment_intervals(SEGMENTS, [], 12.0)
    assert fallback is True
    # Token counts 3, 6, 3 over 12 seconds.
    assert intervals == [(0.0, 3.0), (3.0, 9.0), (9.0, 12.0)]


def test_intervals_read_from_the_subtitle_word_file():
    # The walker consumes subtitle.file_to_words, not a hand-built list:
    # the file next to the subtitle is the production input.
    import tempfile

    with tempfile.TemporaryDirectory() as tmp:
        from pathlib import Path

        subtitle = _write_words(Path(tmp), WORDS)
        intervals, fallback = user_media.segment_intervals_from_subtitle(
            SEGMENTS, subtitle, 6.3
        )
        assert fallback is False
        assert intervals == [(0.0, 1.2), (2.0, 4.0), (5.0, 6.3)]


# ---- resolving one segment's media


def _media_segments(tmp_path, media):
    return [{"kind": "hook", "text": "Welcome to Porto.", "media": media}]


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
    assert prepared[0].still_path.endswith(".jpg")


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
    monkeypatch.setattr(user_media, "_temp_assets_dir", lambda: str(tmp_path))

    def fake_download(url, dest_path, session=None):
        if "bad" in url:
            raise ssrf.UnsafeUrlError("photo download failed: HTTP 403.")
        with open(dest_path, "wb") as handle:
            handle.write(_jpeg())
        return dest_path

    segments = [
        {"kind": "hook", "text": "Welcome to Porto.", "media": {"url": "https://e.com/bad.jpg"}},
        {"kind": "body", "text": "Where the river meets the sea.", "media": {"url": "https://e.com/good.jpg"}},
        {"kind": "cta", "text": "Visit Porto soon."},
    ]
    with patch.object(place_photos, "download_image", side_effect=fake_download):
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
    # The warning never carries the URL: a URL can hold credentials.
    assert "e.com" not in skipped[0] and "bad.jpg" not in skipped[0]


def test_too_small_and_face_photos_are_skipped(tmp_path, monkeypatch):
    monkeypatch.setattr(user_media, "_temp_assets_dir", lambda: str(tmp_path))

    def fake_download(url, dest_path, session=None):
        size = (100, 100) if "small" in url else (1200, 800)
        with open(dest_path, "wb") as handle:
            handle.write(_jpeg(*size))
        return dest_path

    segments = [
        {"kind": "hook", "text": "Welcome to Porto.", "media": {"url": "https://e.com/small.jpg"}},
        {"kind": "body", "text": "Where the river meets the sea.", "media": {"url": "https://e.com/face.jpg"}},
        {"kind": "cta", "text": "Visit Porto soon."},
    ]
    with patch.object(place_photos, "download_image", side_effect=fake_download), patch(
        "app.services.user_media.face_detect.image_contains_face", return_value=True
    ):
        prepared, skipped = user_media.prepare_segment_media(
            "task-1",
            segments,
            _write_words(tmp_path, WORDS),
            6.3,
            str(tmp_path),
            VideoAspect.portrait,
        )
    # The small photo fails the size gate before any face check runs, so
    # the face mock only fires for the second photo; both are skipped.
    assert prepared == []
    assert len(skipped) == 2


def test_lip_sync_jobs_skip_segment_media_with_a_warning(tmp_path):
    prepared, skipped = user_media.prepare_segment_media(
        "task-1",
        _media_segments(tmp_path, {"url": "https://e.com/porto.jpg"}),
        _write_words(tmp_path, WORDS[:3]),
        1.2,
        str(tmp_path),
        VideoAspect.portrait,
        lipsync_active=True,
    )
    assert prepared == []
    assert len(skipped) == 1


def test_segment_without_media_keeps_its_clip(tmp_path):
    clips = ["a.mp4", "b.mp4", "c.mp4"]
    prepared = [user_media.SegmentMedia(index=1, still_path="/t/still.jpg", start=2.0, end=4.0)]
    with patch.object(
        user_media.image_material, "render_image_file_to_mp4", return_value="rendered.mp4"
    ), patch.object(user_media, "_clip_durations", return_value=[2.0, 2.0, 2.0]):
        result, _ = user_media.splice_segment_media(clips, prepared, 2)
    assert result[0] == "a.mp4"
    assert result[2] == "c.mp4"
    assert result[1] == "rendered.mp4"
    assert clips == ["a.mp4", "b.mp4", "c.mp4"]


def test_splice_breaks_overlap_ties_toward_the_earliest_clip(tmp_path):
    clips = ["a.mp4", "b.mp4", "c.mp4"]
    # Interval 2-6 overlaps clip 1 (2-4) and clip 2 (4-6) by 2s each:
    # the earliest wins, so a later equal overlap must not steal the slot.
    prepared = [user_media.SegmentMedia(index=0, still_path="/t/still.jpg", start=2.0, end=6.0)]
    with patch.object(
        user_media.image_material, "render_image_file_to_mp4", return_value="rendered.mp4"
    ), patch.object(user_media, "_clip_durations", return_value=[2.0, 2.0, 2.0]):
        result, _ = user_media.splice_segment_media(clips, prepared, 2)
    assert result == ["a.mp4", "rendered.mp4", "c.mp4"]


def test_splice_skips_a_second_segment_on_an_already_used_clip(tmp_path):
    clips = ["a.mp4", "b.mp4", "c.mp4"]
    # Both intervals overlap clip 1 (2-4) most: the first segment wins it
    # and the second is skipped with a warning instead of overwriting
    # the first photo with no trace.
    prepared = [
        user_media.SegmentMedia(index=0, still_path="/t/first.jpg", start=2.0, end=3.0),
        user_media.SegmentMedia(index=1, still_path="/t/second.jpg", start=2.5, end=3.5),
    ]
    with patch.object(
        user_media.image_material, "render_image_file_to_mp4", return_value="rendered.mp4"
    ) as render_mock, patch.object(user_media, "_clip_durations", return_value=[2.0, 2.0, 2.0]):
        result, skipped = user_media.splice_segment_media(clips, prepared, 2)
    assert result == ["a.mp4", "rendered.mp4", "c.mp4"]
    assert skipped == ["segment 1 media skipped: clip already used by an earlier segment"]
    assert render_mock.call_count == 1


def test_splice_picks_the_clip_with_max_interval_overlap(tmp_path):
    clips = ["a.mp4", "b.mp4", "c.mp4"]
    # Interval 3-7 overlaps clip 1 (2-4) by 1s and clip 2 (4-6) by 2s:
    # clip 2 wins even though the interval starts in clip 1.
    prepared = [user_media.SegmentMedia(index=0, still_path="/t/still.jpg", start=3.0, end=7.0)]
    with patch.object(
        user_media.image_material, "render_image_file_to_mp4", return_value="rendered.mp4"
    ), patch.object(user_media, "_clip_durations", return_value=[2.0, 2.0, 2.0]):
        result, _ = user_media.splice_segment_media(clips, prepared, 2)
    assert result == ["a.mp4", "b.mp4", "rendered.mp4"]


# ---- check_media codes (engine side of the MCP check_media tool)


def _check(url, tmp_path, download=None, face=False):
    work = str(tmp_path)
    if download is not None:
        with patch.object(place_photos, "download_image", side_effect=download):
            with patch(
                "app.services.user_media.face_detect.image_contains_face",
                return_value=face,
            ):
                return user_media.check_media_code(url, work)
    with patch(
        "app.services.user_media.face_detect.image_contains_face", return_value=face
    ):
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


def test_check_media_face_detected_when_a_face_is_present(tmp_path):
    def download(url, dest_path, session=None):
        with open(dest_path, "wb") as handle:
            handle.write(_jpeg())
        return dest_path

    assert _check("https://e.com/porto.jpg", tmp_path, download, face=True) == "face_detected"


# ---- real faceless render: two Porto photos inside their own intervals


def _render_still(tmp_path, name, color):
    source = tmp_path / f"{name}.jpg"
    source.write_bytes(_jpeg(1200, 800, color))
    still = str(tmp_path / f"{name}-still.jpg")
    composed = place_photos.compose_portrait_still(str(source), still, VideoAspect.portrait)
    assert composed == still
    return still


def _frame_color(video_path, seconds, tmp_path):
    frame = str(tmp_path / f"frame-{seconds}.png")
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-ss", str(seconds), "-i", video_path,
         "-frames:v", "1", frame],
        check=True,
    )
    with Image.open(frame) as image:
        pixels = list(image.resize((16, 16)).convert("RGB").getdata())
    red = sum(pixel[0] for pixel in pixels) / len(pixels)
    blue = sum(pixel[2] for pixel in pixels) / len(pixels)
    return red, blue


def test_faceless_render_shows_each_photo_inside_its_own_interval(tmp_path):
    from app.services import image_material

    red_still = _render_still(tmp_path, "ribeira", (220, 40, 40))
    blue_still = _render_still(tmp_path, "dom-luis", (40, 40, 220))
    gray_still = _render_still(tmp_path, "neutral", (120, 120, 120))
    gray_clip = image_material.render_image_file_to_mp4(gray_still, clip_duration=2)
    assert gray_clip
    clips = [gray_clip, gray_clip, gray_clip, gray_clip]
    prepared = [
        user_media.SegmentMedia(index=0, still_path=red_still, start=0.0, end=4.0),
        user_media.SegmentMedia(index=1, still_path=blue_still, start=4.0, end=8.0),
    ]
    spliced, _ = user_media.splice_segment_media(clips, prepared, 2)
    assert spliced[0] != gray_clip and spliced[2] != gray_clip
    final = str(tmp_path / "final.mp4")
    concat = tmp_path / "concat.txt"
    concat.write_text("".join(f"file '{clip}'\n" for clip in spliced))
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0",
         "-i", str(concat), "-c", "copy", final],
        check=True,
    )
    red, blue = _frame_color(final, 1, tmp_path)
    assert red > blue + 30, f"first interval frame should be red, got r={red} b={blue}"
    red2, blue2 = _frame_color(final, 5, tmp_path)
    assert blue2 > red2 + 30, f"second interval frame should be blue, got r={red2} b={blue2}"


def test_apply_segment_media_wires_segments_through_clips_and_warnings(tmp_path, monkeypatch):
    monkeypatch.setattr(user_media, "_temp_assets_dir", lambda: str(tmp_path))
    asset = tmp_path / "aabbccddeeff00112233445566778899.jpg"
    asset.write_bytes(_jpeg())
    # A namespace stands in for TaskVideoRequest (which carries segments):
    # building a real request would force the 60-200 word script contract,
    # which this wiring test does not exercise.
    from types import SimpleNamespace as _NS

    params = _NS(
        video_subject="Porto trip",
        video_aspect="9:16",
        faceless_material="broll",
        video_clip_duration=2,
        segments=[
            {"kind": "hook", "text": "Welcome to Porto.", "media": {"mediaId": asset.name}},
            {"kind": "body", "text": "Where the river meets the sea."},
            {"kind": "cta", "text": "Visit Porto soon."},
        ],
    )
    subtitle = _write_words(tmp_path, WORDS)
    with patch.object(
        user_media.image_material, "render_image_file_to_mp4", return_value="rendered.mp4"
    ), patch.object(user_media, "_clip_durations", return_value=[2.0, 2.0, 2.0, 2.0]):
        clips, warnings = user_media.apply_segment_media(
            "task-1", params, ["a.mp4", "b.mp4", "c.mp4", "d.mp4"],
            subtitle, 6.3, lipsync_active=False,
        )
    assert warnings == []
    assert clips[0] == "rendered.mp4"
    assert clips[1:] == ["b.mp4", "c.mp4", "d.mp4"]


def test_apply_segment_media_without_segments_changes_nothing(tmp_path):
    clips, warnings = user_media.apply_segment_media(
        "task-1", _params(), ["a.mp4"], "", 0.0, lipsync_active=False
    )
    assert clips == ["a.mp4"]
    assert warnings == []
