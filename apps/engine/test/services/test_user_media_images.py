"""user_media with the images material: photos cover the whole audio, none left fails."""

import io
import json
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from PIL import Image

from app.services import image_coverage, image_fetch, segment_panels, user_media

# Hook spoken 0.0-1.2 s, CTA 5.0-5.9 s, audio 6.0 s.
WORDS = [("Welcome", 0.0, 0.5), ("to", 0.5, 0.7), ("Porto", 0.7, 1.2), ("Visit", 5.0, 5.4), ("Porto", 5.4, 5.9)]
SEGMENTS = [
    {"kind": "hook", "text": "Welcome to Porto.", "media": [{"url": "https://e.com/hook.jpg"}]},
    {"kind": "cta", "text": "Visit Porto.", "media": [{"url": "https://e.com/cta.jpg"}]},
]


def _subtitle(tmp_path, words=WORDS):
    path = str(tmp_path / "subtitle.srt")
    with open(path, "w", encoding="utf-8") as handle:
        handle.write("1\n00:00:00,000 --> 00:00:06,000\nPorto\n\n")
    with open(f"{path}.words.json", "w", encoding="utf-8") as handle:
        json.dump([[text, start, end] for text, start, end in words], handle)
    return path


def _download(url, dest_path, session=None, width=1080, height=1920):
    buffer = io.BytesIO()
    Image.new("RGB", (width, height), (200, 30, 30)).save(buffer, "JPEG")
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
    warnings = _run(task_dir, _params())
    panels, stored = segment_panels._read_manifest("task-1")
    assert [(p.index, p.start, p.end, p.motion) for p in panels] == [(0, 0.0, 5.0, "in"), (1, 5.0, 6.0, "out")]
    # The hook photo runs on over the 3.8 s silence before the CTA: worth a warning.
    assert warnings == ["segment 0 image extended: a neighbour image covers a missing image"]
    assert stored == warnings


def test_a_dropped_photo_keeps_its_skip_warning_and_the_neighbour_covers_it(task_dir):
    # The hook keeps one of its two photos, so it still meets its
    # density minimum; the dropped one is a warning and the neighbour
    # covers its slice. A segment that kept none would fail instead.
    segments = [
        {
            "kind": "hook",
            "text": "Welcome to Porto.",
            "media": [{"url": "https://e.com/drop.jpg"}, {"url": "https://e.com/hook.jpg"}],
        },
        {"kind": "cta", "text": "Visit Porto.", "media": [{"url": "https://e.com/cta.jpg"}]},
    ]

    def only_kept(url, dest_path, session=None):
        if "drop" in url:
            raise OSError("blocked")
        return _download(url, dest_path, session)

    warnings = _run(task_dir, _params(segments=segments), download=only_kept)
    panels, _ = segment_panels._read_manifest("task-1")
    assert [(p.index, p.start, p.end) for p in panels] == [(0, 0.0, 5.0), (1, 5.0, 6.0)]
    assert warnings[0].startswith("segment 0 image 0 media skipped: ")
    assert warnings[1:] == ["segment 0 image extended: a neighbour image covers a missing image"]


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


def test_thin_survivors_fail_with_the_segment_minimum_and_skip_reasons(task_dir):
    # Body: 33 words, so it needs at least 5 photos (one per ~3s); four
    # of its five are blocked, so one survivor is too thin even though
    # a photo remains to stretch over the audio.
    body = (
        "Walk the Ribeira in the morning light, cross the Dom Luis bridge, taste "
        "francesinha where the locals eat, and finish with port wine as the river "
        "turns gold at sunset before heading home."
    )
    segments = [
        {"kind": "hook", "text": "Welcome to Porto.", "media": [{"url": "https://e.com/hook.jpg"}]},
        {
            "kind": "body",
            "text": body,
            "media": [{"url": f"https://e.com/body{i}.jpg"} for i in range(5)],
        },
        {"kind": "cta", "text": "Visit Porto.", "media": [{"url": "https://e.com/cta.jpg"}]},
    ]

    def mostly_blocked(url, dest_path, session=None):
        if any(f"body{i}" in url for i in range(1, 5)):
            raise OSError("blocked")
        return _download(url, dest_path, session)

    with pytest.raises(image_coverage.ImagesDoNotCoverAudio) as exc_info:
        _run(task_dir, _params(segments=segments), download=mostly_blocked, words=[])
    message = str(exc_info.value)
    assert message.startswith("images_do_not_cover_audio: ")
    assert "segment 1 has 1 surviving image but needs at least 5 images (one per ~3s)" in message
    assert "7 sent, 3 survived, 4 skipped (download blocked x4)" in message
    assert "segment 1 image 1 media skipped: download blocked" in message
    assert segment_panels._read_manifest("task-1") == ([], [])


def test_hook_persona_coverage_starts_where_the_face_hands_over(task_dir):
    params = _params()
    with patch.object(user_media, "_face_mode", return_value=segment_panels.FACE_HOOK), patch.object(
        user_media, "_hook_end", return_value=1.5
    ) as hook_end:
        _run(task_dir, params)
    hook_end.assert_called()
    panels, _ = segment_panels._read_manifest("task-1")
    framed = [p for p in panels if p.caption_bottom is not None]
    full = [p for p in panels if p.caption_bottom is None]
    assert [(p.index, p.start, p.end, p.motion) for p in framed] == [(0, 0.0, 1.2, None)], "the hook panel never moves"
    assert [(p.index, p.start, p.end) for p in full] == [(1, 1.5, 6.0)]


def test_full_lipsync_has_nothing_to_cover_and_never_fails(task_dir):
    def refuse(url, dest_path, session=None):
        raise OSError("blocked")

    with patch.object(user_media, "_face_mode", return_value=segment_panels.FACE_FULL):
        warnings = _run(task_dir, _params(), download=refuse)
    assert len(warnings) == 2 and all("media skipped" in w for w in warnings)


# ---- aspect ratio (issue #538): a photo that fills the frame must match it


def test_images_material_landscape_photos_fail_the_video(task_dir):
    def landscape(url, dest_path, session=None):
        return _download(url, dest_path, session, width=1920, height=1080)

    with pytest.raises(image_coverage.ImagesDoNotCoverAudio) as exc_info:
        _run(task_dir, _params(), download=landscape)
    assert "wrong aspect ratio" in str(exc_info.value)
    assert segment_panels._read_manifest("task-1") == ([], [])


def test_a_wrong_ratio_photo_is_skipped_and_the_neighbour_covers_it(task_dir):
    # The hook keeps one of its two photos, so it still meets its
    # density minimum; the wrong-ratio one is a warning naming both
    # ratios. A segment that kept none would fail instead.
    segments = [
        {
            "kind": "hook",
            "text": "Welcome to Porto.",
            "media": [{"url": "https://e.com/hook-bad.jpg"}, {"url": "https://e.com/hook-good.jpg"}],
        },
        {"kind": "cta", "text": "Visit Porto.", "media": [{"url": "https://e.com/cta.jpg"}]},
    ]

    def mixed(url, dest_path, session=None):
        if "bad" in url:
            return _download(url, dest_path, session, width=1920, height=1080)
        return _download(url, dest_path, session)

    warnings = _run(task_dir, _params(segments=segments), download=mixed)
    panels, _ = segment_panels._read_manifest("task-1")
    assert [(p.index, p.start, p.end) for p in panels] == [(0, 0.0, 5.0), (1, 5.0, 6.0)]
    assert warnings[0] == (
        "segment 0 image 0 media skipped: wrong aspect ratio "
        "(1920x1080 (16:9); expected 9:16 (1080x1920))"
    )
    assert warnings[1:] == ["segment 0 image extended: a neighbour image covers a missing image"]


def test_a_landscape_hook_photo_stays_a_panel_when_the_face_shows(task_dir):
    # Hook (panel over the face) + body (full frame) + CTA (full frame):
    # only the full-frame photos are gated, so the landscape hook photo
    # stays while the landscape CTA photo is skipped — and the CTA keeps
    # its second photo, so it still meets its density minimum.
    words = [
        ("Welcome", 0.0, 0.5), ("to", 0.5, 0.7), ("Porto", 0.7, 1.2),
        ("Where", 2.0, 2.3), ("the", 2.3, 2.5), ("river", 2.5, 3.0),
        ("Visit", 5.0, 5.4), ("Porto", 5.4, 5.9),
    ]
    segments = [
        {"kind": "hook", "text": "Welcome to Porto.", "media": [{"url": "https://e.com/hook.jpg"}]},
        {"kind": "body", "text": "Where the river.", "media": [{"url": "https://e.com/body.jpg"}]},
        {
            "kind": "cta",
            "text": "Visit Porto.",
            "media": [{"url": "https://e.com/cta-bad.jpg"}, {"url": "https://e.com/cta-good.jpg"}],
        },
    ]

    def mixed(url, dest_path, session=None):
        if "bad" in url:
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
    assert [(p.index, p.start, p.end) for p in full] == [(1, 1.5, 5.45), (2, 5.45, 6.0)]
    assert warnings[0].startswith("segment 2 image 0 media skipped: wrong aspect ratio")
    assert warnings[1:] == ["segment 1 image extended: a neighbour image covers a missing image"]
