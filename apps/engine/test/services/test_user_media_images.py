"""user_media with the images material: photos cover the whole audio, none left fails."""

import hashlib
import io
import json
import subprocess
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from PIL import Image

from app.models.schema import VideoAspect
from app.services import image_coverage, image_fetch, segment_panels, segment_video, user_media

WORDS = [("Welcome", 0.0, 0.5), ("to", 0.5, 0.7), ("Porto", 0.7, 1.2), ("Visit", 5.0, 5.4), ("Porto", 5.4, 5.9)]
SEGMENTS = [
    {"kind": "hook", "text": "Welcome to Porto.", "media": [{"url": "https://e.com/hook.jpg"}]},
    {"kind": "content", "text": "Visit Porto.", "media": [{"url": "https://e.com/cta.jpg"}]},
]


def _subtitle(tmp_path, words=WORDS):
    path = str(tmp_path / "subtitle.srt")
    with open(path, "w", encoding="utf-8") as handle:
        handle.write("1\n00:00:00,000 --> 00:00:06,000\nPorto\n\n")
    with open(f"{path}.words.json", "w", encoding="utf-8") as handle:
        json.dump([[text, start, end] for text, start, end in words], handle)
    return path


def _download(url, dest_path, session=None, width=1080, height=1920):
    digest = hashlib.sha256(url.encode()).digest()
    buffer = io.BytesIO()
    Image.new("RGB", (width, height), tuple(digest[:3])).save(buffer, "JPEG")
    with open(dest_path, "wb") as handle:
        handle.write(buffer.getvalue())
    return dest_path



@pytest.fixture
def task_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(segment_panels.utils, "task_dir", lambda task_id: str(tmp_path))
    monkeypatch.setattr(user_media.utils, "task_dir", lambda task_id: str(tmp_path))
    return tmp_path


def _params(segments=SEGMENTS):
    return SimpleNamespace(
        video_aspect="9:16", font_name="x.ttf", segments=segments, persona=None,
        video_script="\n\n".join(s["text"] for s in segments),
    )


def _run(task_dir, params, download=_download, words=WORDS):
    with patch.object(image_fetch, "download_image", side_effect=download):
        return user_media.prepare_segment_panels("task-1", params, _subtitle(task_dir, words), 6.0)


def test_images_material_photos_cover_the_whole_audio_and_zoom(task_dir):
    words = [
        ("Welcome", 0.0, 0.5), ("to", 0.5, 0.7), ("Porto", 0.7, 1.2),
        ("Where", 2.0, 2.3), ("the", 2.3, 2.5), ("river", 2.5, 3.0),
        ("Visit", 5.0, 5.4), ("Porto", 5.4, 5.9),
    ]
    segments = [
        {"kind": "hook", "text": "Welcome to Porto.", "media": [{"url": "https://e.com/hook.jpg"}]},
        {"kind": "content", "text": "Where the river.", "media": [{"url": "https://e.com/body.jpg"}]},
        {"kind": "content", "text": "Visit Porto.", "media": [{"url": "https://e.com/cta.jpg"}]},
    ]
    warnings = _run(task_dir, _params(segments=segments), words=words)
    panels, stored = segment_panels._read_manifest("task-1")
    assert [(p.index, p.start, p.end, p.motion) for p in panels] == [
        (0, 0.0, 2.0, "in"), (1, 2.0, 5.0, "out"), (2, 5.0, 6.0, "in"),
    ]
    assert warnings == []
    assert stored == warnings


def test_a_silence_between_photos_is_absorbed_up_to_the_fitted_cap(task_dir):
    _run(task_dir, _params())
    panels, _ = segment_panels._read_manifest("task-1")
    assert [(p.index, p.start, p.end) for p in panels] == [(0, 0.0, 3.0), (1, 3.0, 6.0)]


def test_a_silence_beyond_the_fitted_cap_fails_instead_of_stretching(task_dir):
    words = [("Welcome", 0.0, 0.5), ("to", 0.5, 0.7), ("Porto", 0.7, 1.2), ("Visit", 5.6, 5.8), ("Porto", 5.8, 5.9)]
    segments = [
        {"kind": "hook", "text": "Welcome to Porto.", "media": [{"url": "https://e.com/hook.jpg", "duration": 1.0}]},
        {"kind": "content", "text": "Visit Porto.", "media": [{"url": "https://e.com/cta.jpg", "duration": 1.0}]},
    ]
    with pytest.raises(image_coverage.ImagesDoNotCoverAudio) as exc_info:
        _run(task_dir, _params(segments=segments), words=words)
    assert str(exc_info.value) == (
        "images_do_not_cover_audio: 2 photos cover 3.0s of 6.0s at most 1.5x their pace each; "
        "need 2 more photos"
    )
    assert segment_panels._read_manifest("task-1") == ([], [])


def test_a_dropped_photo_fails_the_task_naming_the_photo(task_dir):
    segments = [
        {
            "kind": "hook",
            "text": "Welcome to Porto.",
            "media": [{"url": "https://e.com/drop.jpg"}, {"url": "https://e.com/hook.jpg"}],
        },
        {"kind": "content", "text": "Visit Porto.", "media": [{"url": "https://e.com/cta.jpg"}]},
    ]

    def only_kept(url, dest_path, session=None):
        if "drop" in url:
            raise OSError("blocked")
        return _download(url, dest_path, session)

    with pytest.raises(image_coverage.ImagesDoNotCoverAudio) as exc_info:
        _run(task_dir, _params(segments=segments), download=only_kept)
    message = str(exc_info.value)
    assert message.startswith("images_do_not_cover_audio: ")
    assert "3 sent, 2 survived, 1 skipped (download blocked x1)" in message
    assert "segment 0 image 0 media skipped: download blocked" in message
    assert segment_panels._read_manifest("task-1") == ([], [])


def test_no_surviving_photo_reports_every_skip_reason(task_dir):
    def refuse(url, dest_path, session=None):
        raise OSError("blocked")

    with pytest.raises(image_coverage.ImagesDoNotCoverAudio) as exc_info:
        _run(task_dir, _params(), download=refuse)
    message = str(exc_info.value)
    assert message.startswith("images_do_not_cover_audio: no full-frame image survived; ")
    assert "2 sent, 0 survived, 2 skipped (download blocked x2)" in message
    assert "segment 0 image 0 media skipped: download blocked" in message
    assert "segment 1 image 0 media skipped: download blocked" in message
    assert segment_panels._read_manifest("task-1") == ([], [])


def test_blocked_photos_fail_with_the_counts_and_every_skip_reason(task_dir):
    body = (
        "Walk the Ribeira in the morning light, cross the Dom Luis bridge, taste "
        "francesinha where the locals eat, and finish with port wine as the river "
        "turns gold at sunset before heading home."
    )
    segments = [
        {"kind": "hook", "text": "Welcome to Porto.", "media": [{"url": "https://e.com/hook.jpg"}]},
        {
            "kind": "content",
            "text": body,
            "media": [{"url": f"https://e.com/body{i}.jpg"} for i in range(5)],
        },
        {"kind": "content", "text": "Visit Porto.", "media": [{"url": "https://e.com/cta.jpg"}]},
    ]

    def mostly_blocked(url, dest_path, session=None):
        if any(f"body{i}" in url for i in range(1, 5)):
            raise OSError("blocked")
        return _download(url, dest_path, session)

    with pytest.raises(image_coverage.ImagesDoNotCoverAudio) as exc_info:
        _run(task_dir, _params(segments=segments), download=mostly_blocked, words=[])
    message = str(exc_info.value)
    assert message.startswith("images_do_not_cover_audio: ")
    assert "7 sent, 3 survived, 4 skipped (download blocked x4)" in message
    assert "segment 1 image 1 media skipped: download blocked" in message
    assert "segment 1 image 4 media skipped: download blocked" in message
    assert segment_panels._read_manifest("task-1") == ([], [])


def test_hook_persona_coverage_starts_where_the_face_hands_over(task_dir):
    params = _params(segments=[
        {"kind": "hook", "text": "Welcome to Porto.", "media": [{"url": "https://e.com/hook.jpg"}]},
        {
            "kind": "content",
            "text": "Visit Porto.",
            "media": [
                {"url": "https://e.com/cta.jpg"},
                {"url": "https://e.com/cta2.jpg"},
                {"url": "https://e.com/cta3.jpg"},
            ],
        },
    ])
    with patch.object(user_media, "_face_mode", return_value=segment_panels.FACE_HOOK), patch.object(
        user_media, "_hook_end", return_value=1.5
    ) as hook_end:
        _run(task_dir, params)
    hook_end.assert_called()
    panels, _ = segment_panels._read_manifest("task-1")
    framed = [p for p in panels if p.caption_bottom is not None]
    full = [p for p in panels if p.caption_bottom is None]
    assert [(p.index, p.start, p.end, p.motion) for p in framed] == [(0, 0.0, 1.2, None)], "the hook panel never moves"
    assert [(p.index, p.start, p.end) for p in full] == [(1, 1.5, 4.5), (1, 4.5, 5.6), (1, 5.6, 6.0)]


def test_full_lipsync_has_nothing_to_cover_and_never_fails(task_dir):
    def refuse(url, dest_path, session=None):
        raise OSError("blocked")

    with patch.object(user_media, "_face_mode", return_value=segment_panels.FACE_FULL):
        warnings = _run(task_dir, _params(), download=refuse)
    assert len(warnings) == 2 and all("media skipped" in w for w in warnings)



def test_images_material_landscape_photos_fail_the_video(task_dir):
    def landscape(url, dest_path, session=None):
        return _download(url, dest_path, session, width=1920, height=1080)

    with pytest.raises(image_coverage.ImagesDoNotCoverAudio) as exc_info:
        _run(task_dir, _params(), download=landscape)
    assert "wrong aspect ratio" in str(exc_info.value)
    assert segment_panels._read_manifest("task-1") == ([], [])


def test_a_wrong_ratio_photo_fails_the_task_naming_the_ratios(task_dir):
    segments = [
        {
            "kind": "hook",
            "text": "Welcome to Porto.",
            "media": [{"url": "https://e.com/hook-bad.jpg"}, {"url": "https://e.com/hook-good.jpg"}],
        },
        {"kind": "content", "text": "Visit Porto.", "media": [{"url": "https://e.com/cta.jpg"}]},
    ]

    def mixed(url, dest_path, session=None):
        if "bad" in url:
            return _download(url, dest_path, session, width=1920, height=1080)
        return _download(url, dest_path, session)

    with pytest.raises(image_coverage.ImagesDoNotCoverAudio) as exc_info:
        _run(task_dir, _params(segments=segments), download=mixed)
    message = str(exc_info.value)
    assert "3 sent, 2 survived, 1 skipped" in message
    assert (
        "segment 0 image 0 media skipped: wrong aspect ratio "
        "(1920x1080 (16:9); expected 9:16 (1080x1920))"
    ) in message
    assert segment_panels._read_manifest("task-1") == ([], [])


def test_a_landscape_hook_photo_stays_a_panel_when_the_face_shows(task_dir):
    words = [
        ("Welcome", 0.0, 0.5), ("to", 0.5, 0.7), ("Porto", 0.7, 1.2),
        ("Where", 2.0, 2.3), ("the", 2.3, 2.5), ("river", 2.5, 3.0),
        ("Visit", 5.0, 5.4), ("Porto", 5.4, 5.9),
    ]
    segments = [
        {"kind": "hook", "text": "Welcome to Porto.", "media": [{"url": "https://e.com/hook.jpg"}]},
        {
            "kind": "content",
            "text": "Where the river.",
            "media": [{"url": "https://e.com/body.jpg"}, {"url": "https://e.com/body2.jpg"}],
        },
        {"kind": "content", "text": "Visit Porto.", "media": [{"url": "https://e.com/cta.jpg"}]},
    ]

    def mixed(url, dest_path, session=None):
        if "hook" in url:
            return _download(url, dest_path, session, width=1920, height=1080)
        return _download(url, dest_path, session)

    params = _params(segments=segments)
    with patch.object(user_media, "_face_mode", return_value=segment_panels.FACE_HOOK), patch.object(
        user_media, "_hook_end", return_value=1.5
    ):
        warnings = _run(task_dir, params, download=mixed, words=words)
    panels, _ = segment_panels._read_manifest("task-1")
    framed = [p for p in panels if p.caption_bottom is not None]
    full = [p for p in panels if p.caption_bottom is None]
    assert [(p.index, p.start, p.end) for p in framed] == [(0, 0.0, 1.2)]
    assert [(p.index, p.start, p.end) for p in full] == [(1, 1.5, 2.5), (1, 2.5, 5.0), (2, 5.0, 6.0)]
    assert warnings == []



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


def _clip_bytes(tmp_path, **kwargs):
    with open(_clip(tmp_path, **kwargs), "rb") as handle:
        return handle.read()


def _run_clip(task_dir, params, words, clip_source, photo_download=_download):
    """prepare_segment_panels with clips downloaded by segment_video."""
    def download_video(url, dest_path, session=None):
        with open(dest_path, "wb") as handle:
            handle.write(clip_source(url, dest_path))
        return dest_path

    with (
        patch.object(image_fetch, "download_image", side_effect=photo_download),
        patch.object(segment_video, "download_video", side_effect=download_video),
    ):
        return user_media.prepare_segment_panels(
            "task-1", params, _subtitle(task_dir, words), 6.0
        )


def _one_clip_segments():
    return [{"kind": "hook", "text": "Welcome to Porto.",
             "media": [{"url": "https://e.com/broll.mp4"}]}]


def _one_clip_words():
    return [("Welcome", 0.0, 2.0), ("to", 2.0, 4.0), ("Porto", 4.0, 6.0)]


def test_a_video_clip_loops_to_cover_its_whole_take(task_dir):
    blob = _clip_bytes(task_dir)
    warnings = _run_clip(
        task_dir, _params(segments=_one_clip_segments()), _one_clip_words(),
        lambda url, dest: blob,
    )
    panels, _ = segment_panels._read_manifest("task-1")
    assert warnings == []
    assert len(panels) == 1
    assert panels[0].path.endswith("segment-clip-0-0.mp4")
    assert (panels[0].start, panels[0].end) == (0.0, 6.0)
    assert panels[0].clip_seconds == pytest.approx(5.0, abs=0.1)
    assert panels[0].motion is None, "a clip plays as-is, never zoomed"
    assert panels[0].caption_bottom is None, "a clip is always full-frame"


def test_a_clip_and_photos_share_a_video_with_their_own_rules(task_dir):
    blob = _clip_bytes(task_dir)
    words = [
        ("Welcome", 0.0, 1.0), ("to", 1.0, 1.5), ("Porto", 1.5, 2.0),
        ("Where", 2.0, 2.5), ("the", 2.5, 3.0), ("river", 3.0, 4.0),
        ("Visit", 4.0, 5.0), ("Porto", 5.0, 6.0),
    ]
    segments = [
        {"kind": "hook", "text": "Welcome to Porto.",
         "media": [{"url": "https://e.com/broll.mp4"}]},
        {"kind": "content", "text": "Where the river.",
         "media": [{"url": "https://e.com/body.jpg"}]},
        {"kind": "content", "text": "Visit Porto.",
         "media": [{"url": "https://e.com/cta.jpg"}]},
    ]
    warnings = _run_clip(
        task_dir, _params(segments=segments), words, lambda url, dest: blob
    )
    panels, _ = segment_panels._read_manifest("task-1")
    assert warnings == []
    assert [(p.index, p.start, p.end, p.motion) for p in panels] == [
        (0, 0.0, 2.0, None), (1, 2.0, 4.0, "in"), (2, 4.0, 6.0, "out"),
    ]
    assert panels[0].path.endswith(".mp4")
    assert panels[1].path.endswith(".png")


def test_a_clip_by_media_id_is_copied_not_moved(task_dir, monkeypatch):
    monkeypatch.setattr(user_media, "_temp_assets_dir", lambda: str(task_dir))
    monkeypatch.setattr(segment_video, "_temp_assets_dir", lambda: str(task_dir))
    name = "aabbccddeeff00112233445566778899.mp4"
    (task_dir / name).write_bytes(_clip_bytes(task_dir, name="src.mp4"))
    segments = [{"kind": "hook", "text": "Welcome to Porto.",
                 "media": [{"mediaId": name}]}]
    warnings = user_media.prepare_segment_panels(
        "task-1", _params(segments=segments),
        _subtitle(task_dir, _one_clip_words()), 6.0,
    )
    panels, _ = segment_panels._read_manifest("task-1")
    assert warnings == []
    assert len(panels) == 1
    assert panels[0].path == str(task_dir / "segment-clip-0-0.mp4")
    assert (task_dir / name).exists(), "the temp asset stays for the caller"


def test_an_invalid_clip_fails_the_task_like_a_skipped_photo(task_dir):
    with pytest.raises(image_coverage.ImagesDoNotCoverAudio) as exc_info:
        _run_clip(
            task_dir, _params(segments=_one_clip_segments()), _one_clip_words(),
            lambda url, dest: b"not a video at all",
        )
    assert "segment 0 image 0 media skipped: not a video clip" in str(exc_info.value)


def test_a_too_long_clip_fails_naming_its_seconds(task_dir):
    blob = _clip_bytes(task_dir, seconds=35)
    with pytest.raises(image_coverage.ImagesDoNotCoverAudio) as exc_info:
        _run_clip(
            task_dir, _params(segments=_one_clip_segments()), _one_clip_words(),
            lambda url, dest: blob,
        )
    assert "segment 0 image 0 media skipped: video clip is too long (35.0s; max 30s)" in str(
        exc_info.value
    )


def test_a_non_h264_clip_fails_as_not_a_video_clip(task_dir):
    blob = _clip_bytes(task_dir, codec="mpeg4")
    with pytest.raises(image_coverage.ImagesDoNotCoverAudio) as exc_info:
        _run_clip(
            task_dir, _params(segments=_one_clip_segments()), _one_clip_words(),
            lambda url, dest: blob,
        )
    assert "segment 0 image 0 media skipped: not a video clip" in str(exc_info.value)


def test_a_landscape_clip_fails_for_a_portrait_video(task_dir):
    blob = _clip_bytes(task_dir, width=1920, height=1080)
    with pytest.raises(image_coverage.ImagesDoNotCoverAudio) as exc_info:
        _run_clip(
            task_dir, _params(segments=_one_clip_segments()), _one_clip_words(),
            lambda url, dest: blob,
        )
    assert (
        "segment 0 image 0 media skipped: wrong aspect ratio "
        "(1920x1080 (16:9); expected 9:16 (1080x1920))" in str(exc_info.value)
    )


def test_a_clip_over_the_personas_face_is_skipped(task_dir):
    blob = _clip_bytes(task_dir)
    words = [("Welcome", 0.0, 2.0), ("to", 2.0, 3.0), ("Porto", 3.0, 4.0)]
    segments = [{"kind": "hook", "text": "Welcome to Porto.",
                 "media": [{"url": "https://e.com/broll.mp4"}]}]

    def download_video(url, dest_path, session=None):
        with open(dest_path, "wb") as handle:
            handle.write(blob)
        return dest_path

    with patch.object(segment_video, "download_video", side_effect=download_video):
        panels, skipped = user_media.prepare_segment_media(
            "task-1", segments, _subtitle(task_dir, words), 4.0, str(task_dir),
            VideoAspect.portrait, face=segment_panels.FACE_FULL,
        )
    assert panels == []
    assert skipped == [
        "segment 0 image 0 media skipped: video clip cannot cover the persona's face"
    ]


def test_a_repeated_clip_under_a_different_url_is_a_duplicate(task_dir):
    blob = _clip_bytes(task_dir)
    words = [
        ("Welcome", 0.0, 1.0), ("to", 1.0, 1.5), ("Porto", 1.5, 2.0),
        ("Where", 2.0, 2.5), ("the", 2.5, 3.0), ("river", 3.0, 4.0),
        ("Visit", 4.0, 5.0), ("Porto", 5.0, 6.0),
    ]
    segments = [
        {"kind": "hook", "text": "Welcome to Porto.",
         "media": [{"url": "https://e.com/one.mp4"}]},
        {"kind": "content", "text": "Where the river.",
         "media": [{"url": "https://e.com/two.mp4"}]},
        {"kind": "content", "text": "Visit Porto.",
         "media": [{"url": "https://e.com/cta.jpg"}]},
    ]
    with pytest.raises(image_coverage.ImagesDoNotCoverAudio) as exc_info:
        _run_clip(task_dir, _params(segments=segments), words, lambda url, dest: blob)
    assert "segment 1 image 0 media skipped: duplicate video clip" in str(exc_info.value)


def test_the_hook_photo_is_the_first_photo_never_a_clip(task_dir):
    clip = {"mediaId": "aabbccddeeff00112233445566778899.mp4"}
    photo = {"mediaId": "00112233445566778899aabbccddeeff.jpg"}
    segments = [
        {"kind": "hook", "text": "Welcome to Porto.", "media": [clip]},
        {"kind": "content", "text": "Visit Porto.", "media": [photo]},
    ]
    assert user_media.first_segment_media(segments) == (1, 0, photo)


def test_an_overlay_on_a_clip_warns_and_the_clip_still_ships(task_dir):
    blob = _clip_bytes(task_dir)
    segments = [{"kind": "hook", "text": "Welcome to Porto.",
                 "media": [{"url": "https://e.com/broll.mp4",
                            "overlay": {"title": "Porto"}}]}]
    warnings = _run_clip(
        task_dir, _params(segments=segments), _one_clip_words(),
        lambda url, dest: blob,
    )
    panels, _ = segment_panels._read_manifest("task-1")
    assert len(panels) == 1
    assert warnings == [
        "segment 0 image 0 media overlay skipped: overlays are not supported on video clips"
    ]
def test_a_requested_duration_rides_to_the_panel_and_weights_its_slice(task_dir):
    words = [
        ("Welcome", 0.0, 0.5), ("to", 0.5, 0.7), ("Porto", 0.7, 1.2),
        ("Where", 2.0, 2.3), ("the", 2.3, 2.5), ("river", 2.5, 3.0),
        ("Visit", 5.0, 5.4), ("Porto", 5.4, 5.9),
    ]
    segments = [
        {"kind": "hook", "text": "Welcome to Porto.", "media": [{"url": "https://e.com/hook.jpg", "duration": 3.0}]},
        {
            "kind": "content",
            "text": "Where the river.",
            "media": [
                {"url": "https://e.com/body.jpg", "duration": 3.0},
                {"url": "https://e.com/body2.jpg", "duration": 1.0},
            ],
        },
        {"kind": "content", "text": "Visit Porto.", "media": [{"url": "https://e.com/cta.jpg", "duration": 2.0}]},
    ]
    warnings = _run(task_dir, _params(segments=segments), words=words)
    panels, stored = segment_panels._read_manifest("task-1")
    assert [(p.index, p.start, p.end, p.motion) for p in panels] == [
        (0, 0.0, 2.0, "in"), (1, 2.0, 2.75, "out"), (1, 2.75, 4.25, "in"), (2, 4.25, 6.0, "out"),
    ]
    assert [p.requested_duration for p in panels] == [3.0, 3.0, 1.0, 2.0]
    assert warnings == []
    assert stored == warnings


def test_photos_without_a_request_carry_no_duration(task_dir):
    words = [
        ("Welcome", 0.0, 0.5), ("to", 0.5, 0.7), ("Porto", 0.7, 1.2),
        ("Where", 2.0, 2.3), ("the", 2.3, 2.5), ("river", 2.5, 3.0),
        ("Visit", 5.0, 5.4), ("Porto", 5.4, 5.9),
    ]
    segments = [
        {"kind": "hook", "text": "Welcome to Porto.", "media": [{"url": "https://e.com/hook.jpg"}]},
        {"kind": "content", "text": "Where the river.", "media": [{"url": "https://e.com/body.jpg"}]},
        {"kind": "content", "text": "Visit Porto.", "media": [{"url": "https://e.com/cta.jpg"}]},
    ]
    warnings = _run(task_dir, _params(segments=segments), words=words)
    assert warnings == []
    panels, _stored = segment_panels._read_manifest("task-1")
    assert [(p.start, p.end) for p in panels] == [(0.0, 2.0), (2.0, 5.0), (5.0, 6.0)]
    assert [p.requested_duration for p in panels] == [None, None, None]
