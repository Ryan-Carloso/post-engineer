"""user_media: the info card inside a segment photo's panel, and the panel itself.

The card is painted after the photo's checks, inside the panel; any refusal
keeps the plain photo and records a task warning.
"""

import io
import json
import os
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from PIL import Image, ImageFont

from app.models.schema import VideoAspect
from app.services import persona_hook, image_fetch, segment_panels, subtitle, user_media

WORDS = [
    ("Welcome", 0.0, 0.5),
    ("to", 0.5, 0.7),
    ("Porto", 0.7, 1.2),
    ("Visit", 5.0, 5.4),
    ("Porto", 5.4, 5.9),
]
SEGMENTS_TEXT = [
    {"kind": "hook", "text": "Welcome to Porto."},
    {"kind": "cta", "text": "Visit Porto."},
]
RED = (200, 30, 30)


def _jpeg():
    buffer = io.BytesIO()
    Image.new("RGB", (1080, 1920), RED).save(buffer, "JPEG")
    return buffer.getvalue()


def _subtitle(tmp_path):
    path = str(tmp_path / "subtitle.srt")
    with open(path, "w", encoding="utf-8") as handle:
        handle.write("1\n00:00:00,000 --> 00:00:06,000\nPorto\n\n")
    with open(f"{path}.words.json", "w", encoding="utf-8") as handle:
        json.dump([[text, start, end] for text, start, end in WORDS], handle)
    return path


def _download(url, dest_path, session=None):
    with open(dest_path, "wb") as handle:
        handle.write(_jpeg())
    return dest_path


def _font_for(size):
    return ImageFont.load_default(size)


def _prepare(tmp_path, segments, font_for=_font_for, has_face=False, face=segment_panels.FACE_FULL):
    with (
        patch.object(image_fetch, "download_image", side_effect=_download),
        patch("app.services.user_media.face_detect.image_contains_face", return_value=has_face),
    ):
        return user_media.prepare_segment_media(
            "task-1",
            segments,
            _subtitle(tmp_path),
            6.0,
            str(tmp_path),
            VideoAspect.portrait,
            face=face,
            video_script="\n\n".join(segment["text"] for segment in segments),
            font_for=font_for,
        )


def _segments(overlay):
    media = {"url": "https://e.com/p.jpg"}
    if overlay is not None:
        media["overlay"] = overlay
    return [{**SEGMENTS_TEXT[0], "media": [media]}, SEGMENTS_TEXT[1]]


def _panel_pixel(panel, offset_y):
    with Image.open(panel.path) as image:
        return image.convert("RGBA").getpixel((40 + 500, 40 + offset_y))


def test_panel_carries_the_segment_interval_and_the_bottom_position(tmp_path):
    panels, skipped = _prepare(tmp_path, _segments(None))
    assert skipped == []
    assert len(panels) == 1
    panel = panels[0]
    assert (panel.index, panel.start, panel.end) == (0, 0.0, 1.2)
    assert panel.path.endswith("segment-panel-0-0.png") and os.path.exists(panel.path)
    assert (panel.x, panel.y) == (0, 1920 - 30 - 730 - 40), (
        "panel at 40px/30px from the bottom, minus the 40px shadow pad"
    )
    assert panel.caption_bottom == 1920 - 30 - 730 - segment_panels.CAPTION_GAP


def test_card_is_painted_inside_the_panel(tmp_path):
    panels, skipped = _prepare(
        tmp_path, _segments({"title": "Sushi Kinoshita", "subtitle": "Rua das Flores 12"})
    )
    assert skipped == []
    pixel = _panel_pixel(panels[0], 30)
    assert max(abs(a - b) for a, b in zip(pixel[:3], RED)) > 60, (
        "the card darkens the top of the panel"
    )
    plain, _ = _prepare(tmp_path, _segments(None))
    assert max(abs(a - b) for a, b in zip(_panel_pixel(plain[0], 30)[:3], RED)) < 40


def test_downloaded_photo_is_removed_once_the_panel_is_drawn(tmp_path):
    _prepare(tmp_path, _segments(None))
    assert not os.path.exists(tmp_path / "segment-media-0-0.raw")


def test_text_that_does_not_fit_keeps_the_photo_and_warns(tmp_path):
    panels, skipped = _prepare(tmp_path, _segments({"title": "W" * 60}))
    assert len(panels) == 1, "a refused card must never cost the photo"
    assert skipped == ["segment 0 image 0 media overlay skipped: overlay text does not fit"]


def test_missing_font_keeps_the_photo_and_warns(tmp_path):
    panels, skipped = _prepare(tmp_path, _segments({"title": "Sushi"}), font_for=None)
    assert len(panels) == 1
    assert skipped == ["segment 0 image 0 media overlay skipped: overlay font unavailable"]


def test_photo_with_a_face_is_skipped_before_any_panel_is_drawn(tmp_path):
    panels, skipped = _prepare(tmp_path, _segments({"title": "Sushi"}), has_face=True)
    assert panels == []
    assert skipped == ["segment 0 image 0 media skipped: face detected"]
    assert not os.path.exists(tmp_path / "segment-panel-0-0.png")


def test_segment_with_no_spoken_time_is_skipped_with_a_reason(tmp_path):
    segments = [
        {**SEGMENTS_TEXT[0], "media": [{"url": "https://e.com/p.jpg"}]},
        {"kind": "body", "text": "!!! ???"},
    ]
    segments[1]["media"] = [{"url": "https://e.com/q.jpg"}]
    panels, skipped = _prepare(tmp_path, segments)
    assert [panel.index for panel in panels] == [0]
    assert skipped == ["segment 1 image 0 media skipped: segment has no spoken time"]


def test_panel_that_fails_to_draw_is_skipped_with_a_reason(tmp_path):
    with patch.object(segment_panels, "build_panel", return_value=None):
        panels, skipped = _prepare(tmp_path, _segments(None))
    assert panels == []
    assert skipped == ["segment 0 image 0 media skipped: photo panel failed to render"]


def test_two_segments_sharing_one_media_id_each_get_their_own_panel_and_card(tmp_path, monkeypatch):
    monkeypatch.setattr(user_media, "_temp_assets_dir", lambda: str(tmp_path))
    asset = tmp_path / "aabbccddeeff00112233445566778899.jpg"
    asset.write_bytes(_jpeg())
    segments = [
        {**SEGMENTS_TEXT[0], "media": [{"mediaId": asset.name, "overlay": {"title": "First"}}]},
        {**SEGMENTS_TEXT[1], "media": [{"mediaId": asset.name, "overlay": {"title": "Second"}}]},
    ]
    with patch("app.services.user_media.face_detect.image_contains_face", return_value=False):
        panels, skipped = user_media.prepare_segment_media(
            "task-1",
            segments,
            _subtitle(tmp_path),
            6.0,
            str(tmp_path),
            VideoAspect.portrait,
            font_for=_font_for,
        )
    assert skipped == []
    assert len({panel.path for panel in panels}) == 2
    assert asset.exists(), "the temp asset is the caller's upload and must not be deleted"


def test_prepare_segment_panels_resolves_the_subtitle_font_only_when_a_card_is_wanted(
    tmp_path, monkeypatch
):
    monkeypatch.setattr(segment_panels.utils, "task_dir", lambda task_id: str(tmp_path))
    monkeypatch.setattr(user_media.utils, "task_dir", lambda task_id: str(tmp_path))
    seen = []

    def fake_resolve(params):
        seen.append(params.font_name)
        return "/fonts/BeVietnamPro-Medium.ttf"

    params = SimpleNamespace(
        video_aspect="9:16",
        font_name="BeVietnamPro-Medium.ttf",
        segments=_segments({"title": "Sushi"}),
    )
    with (
        patch.object(user_media.video, "_resolve_font_with_fallback", side_effect=fake_resolve),
        patch.object(image_fetch, "download_image", side_effect=_download),
        patch("app.services.user_media.face_detect.image_contains_face", return_value=False),
        patch.object(user_media.media_overlay, "font_loader", return_value=_font_for),
    ):
        warnings = user_media.prepare_segment_panels("task-1", params, _subtitle(tmp_path), 6.0)
    assert seen == ["BeVietnamPro-Medium.ttf"]
    assert warnings == ["segment 0 image extended: a neighbour image covers a missing image"]
    panels, stored_warnings = segment_panels._read_manifest("task-1")
    assert [panel.index for panel in panels] == [0]
    assert stored_warnings == warnings

    seen.clear()
    params.segments = _segments(None)
    with (
        patch.object(user_media.video, "_resolve_font_with_fallback", side_effect=fake_resolve),
        patch.object(image_fetch, "download_image", side_effect=_download),
        patch("app.services.user_media.face_detect.image_contains_face", return_value=False),
    ):
        user_media.prepare_segment_panels("task-1", params, _subtitle(tmp_path), 6.0)
    assert seen == [], "no card wanted, no font lookup"


def test_prepare_segment_panels_warns_and_keeps_the_photo_when_the_font_is_missing(
    tmp_path, monkeypatch
):
    monkeypatch.setattr(segment_panels.utils, "task_dir", lambda task_id: str(tmp_path))
    monkeypatch.setattr(user_media.utils, "task_dir", lambda task_id: str(tmp_path))
    params = SimpleNamespace(
        video_aspect="9:16", font_name="Missing.ttf", segments=_segments({"title": "Sushi"})
    )
    with (
        patch.object(
            user_media.video, "_resolve_font_with_fallback", side_effect=ValueError("no font")
        ),
        patch.object(image_fetch, "download_image", side_effect=_download),
        patch("app.services.user_media.face_detect.image_contains_face", return_value=False),
    ):
        warnings = user_media.prepare_segment_panels("task-1", params, _subtitle(tmp_path), 6.0)
    assert warnings == [
        "segment 0 image 0 media overlay skipped: overlay font unavailable",
        "segment 0 image extended: a neighbour image covers a missing image",
    ]
    panels, stored = segment_panels._read_manifest("task-1")
    assert len(panels) == 1 and stored == warnings


def test_prepare_segment_panels_without_segments_writes_nothing(tmp_path, monkeypatch):
    monkeypatch.setattr(segment_panels.utils, "task_dir", lambda task_id: str(tmp_path))
    params = SimpleNamespace(video_aspect="9:16", segments=None)
    assert user_media.prepare_segment_panels("task-1", params, "", 0.0) == []
    assert not (tmp_path / segment_panels.MANIFEST_NAME).exists()


# ---- panel over the face, full frame everywhere else


def _two_media_segments():
    return [
        {
            **SEGMENTS_TEXT[0],
            "media": [{"url": "https://e.com/hook.jpg", "overlay": {"title": "Hook place"}}],
        },
        {
            **SEGMENTS_TEXT[1],
            "media": [{"url": "https://e.com/body.jpg", "overlay": {"title": "Body place"}}],
        },
    ]


def _is_full_frame(panel):
    with Image.open(panel.path) as image:
        return image.size == (1080, 1920) and (panel.x, panel.y) == (0, 0)


def test_faceless_photos_are_all_full_frame(tmp_path):
    panels, skipped = _prepare(tmp_path, _two_media_segments(), face=segment_panels.FACE_NONE)
    assert skipped == []
    assert [_is_full_frame(panel) for panel in panels] == [True, True]


def test_full_lipsync_photos_are_all_panels_over_the_face(tmp_path):
    panels, skipped = _prepare(tmp_path, _two_media_segments(), face=segment_panels.FACE_FULL)
    assert skipped == []
    assert [_is_full_frame(panel) for panel in panels] == [False, False]


def test_hook_only_lipsync_puts_the_hook_photo_over_the_face_and_the_background_photo_full_frame(
    tmp_path,
):
    # The hook is spoken 0.0-1.2 and the CTA from 5.0: the face leaves at 1.2.
    panels, skipped = _prepare(tmp_path, _two_media_segments(), face=segment_panels.FACE_HOOK)
    assert skipped == []
    assert [panel.index for panel in panels] == [0, 1]
    assert _is_full_frame(panels[0]) is False, "the hook photo is a panel: the face is on screen"
    assert _is_full_frame(panels[1]) is True, (
        "after the hook it is background footage, so the photo is full frame"
    )


def _timed_subtitle(tmp_path, words, name="timed.srt"):
    path = str(tmp_path / name)
    with open(path, "w", encoding="utf-8") as handle:
        handle.write("1\n00:00:00,000 --> 00:00:40,000\nHook\n\n")
    with open(f"{path}.words.json", "w", encoding="utf-8") as handle:
        json.dump([[text, start, end] for text, start, end in words], handle)
    return path


def _script():
    return "\n\n".join(segment["text"] for segment in SEGMENTS_TEXT)


def test_the_handover_is_the_window_the_intro_actually_renders(tmp_path):
    # The MAJOR this pins: the panel/full-frame boundary must come from the
    # same measurement the intro renders, not from the segment intervals.
    subtitle_path = _subtitle(tmp_path)
    intro_window = persona_hook.resolve_lipsync_window(
        "t",
        _script(),
        subtitle.file_to_subtitles(subtitle_path),
        6.0,
        persona_hook.PERSONA_HOOK_MAX_SECONDS,
        words=subtitle.file_to_words(subtitle_path),
    )
    assert user_media._hook_end(_script(), subtitle_path, 6.0) == intro_window


def test_a_hook_spoken_past_the_ceiling_hands_over_to_b_roll_at_the_ceiling(tmp_path):
    subtitle_path = _timed_subtitle(tmp_path, [("Welcome", 0.0, 20.0), ("to", 20.0, 20.5)])
    assert (
        user_media._hook_end(_script(), subtitle_path, 20.5)
        == persona_hook.PERSONA_HOOK_MAX_SECONDS
    )


def test_no_measurable_hook_means_no_face_on_screen(tmp_path):
    path = str(tmp_path / "empty.srt")
    open(path, "w", encoding="utf-8").close()
    assert user_media._hook_end(_script(), path, 0.0) == 0.0


def test_a_missing_script_has_no_face_window(tmp_path):
    assert user_media._hook_end("", _subtitle(tmp_path), 6.0) == 0.0


def test_a_segment_that_starts_exactly_when_the_face_leaves_is_full_frame(tmp_path):
    segments = _two_media_segments()
    with patch.object(user_media, "_hook_end", return_value=5.0):
        panels, _ = _prepare(tmp_path, segments, face=segment_panels.FACE_HOOK)
    assert _is_full_frame(panels[1]) is True, "start == hook end is background footage, not face"


@pytest.mark.parametrize(
    ("persona", "full", "expected"),
    [
        (None, False, segment_panels.FACE_NONE),
        (None, True, segment_panels.FACE_NONE),
        ("lipsync", False, segment_panels.FACE_HOOK),
        ("lipsync", True, segment_panels.FACE_FULL),
        ("voice-only", False, segment_panels.FACE_NONE),
    ],
)
def test_face_mode_follows_the_video_type(persona, full, expected):
    from app.models.schema import PersonaParams, VideoParams

    if persona is None:
        params = VideoParams(
            video_title="Porto", video_description="Test description.", video_type="faceless"
        )
    else:
        voice_only = persona == "voice-only"
        params = VideoParams(
            video_title="Porto",
            video_description="Test description.",
            video_type="full_lipsync" if full else "hook_lipsync",
            persona=PersonaParams(
                name="Ana",
                avatar_url=None if voice_only else "https://e.com/a.png",
                voice_id="calm",
            ),
        )
    assert user_media._face_mode(params) == expected


def test_prepare_segment_panels_uses_the_video_type_to_pick_panel_or_full_frame(
    tmp_path, monkeypatch
):
    from app.models.schema import PersonaParams

    monkeypatch.setattr(segment_panels.utils, "task_dir", lambda task_id: str(tmp_path))
    monkeypatch.setattr(user_media.utils, "task_dir", lambda task_id: str(tmp_path))
    params = SimpleNamespace(
        video_aspect="9:16",
        font_name="x.ttf",
        segments=_two_media_segments(),
        video_type="hook_lipsync",
        persona=PersonaParams(name="Ana", avatar_url="https://e.com/a.png", voice_id="calm"),
        video_layout="standard",
        video_script=_script(),
    )
    with (
        patch.object(user_media.video, "_resolve_font_with_fallback", return_value="/f.ttf"),
        patch.object(user_media.media_overlay, "font_loader", return_value=_font_for),
        patch.object(image_fetch, "download_image", side_effect=_download),
        patch("app.services.user_media.face_detect.image_contains_face", return_value=False),
    ):
        warnings = user_media.prepare_segment_panels("task-1", params, _subtitle(tmp_path), 6.0)
    assert warnings == ["segment 1 image extended: a neighbour image covers a missing image"]
    panels, _ = segment_panels._read_manifest("task-1")
    assert [(panel.index, _is_full_frame(panel)) for panel in panels] == [(0, False), (1, True)]
