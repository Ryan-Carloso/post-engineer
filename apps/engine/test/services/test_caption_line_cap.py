import os

import pytest

from app.models.schema import PersonaParams, VideoParams
from app.services import caption_line_cap, full_lipsync
from app.services import video as vd
from test.services.test_subtitle_sizing import FONT_SIZE, PHRASES, _font_file, _media

FONT_CANDIDATES = (
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/dejavu/DejaVuSans.ttf",
)


def _font():
    path = next((p for p in FONT_CANDIDATES if os.path.exists(p)), None)
    if path is None:
        pytest.skip("no system TrueType font")
    return path


def _lipsync_params(**overrides):
    return full_lipsync.caption_params(
        VideoParams(
            video_title="x",
            video_description="Test description.",
            video_type="hook_lipsync",
            video_aspect="9:16",
            font_size=FONT_SIZE,
            persona=PersonaParams(name="p", photo_url="https://example.com/p.png", voice_id="calm"),
            **overrides,
        )
    )


def _faceless_params():
    return VideoParams(
        video_title="x",
        video_description="Test description.",
        video_type="faceless",
        video_aspect="9:16",
        font_size=FONT_SIZE,
    )


def _line_count(text):
    return text.count("\n") + 1


def test_max_lines_applies_only_to_the_moved_lipsync_caption():
    assert caption_line_cap.max_lines(_lipsync_params()) == 2
    assert caption_line_cap.max_lines(_faceless_params()) is None
    assert caption_line_cap.max_lines(_lipsync_params(subtitle_position="bottom")) is None


@pytest.mark.parametrize("lines", [1, 2, 3])
def test_lipsync_cues_wrap_to_at_most_two_lines(lines):
    font = _font()
    items = [((0.0, 2.0), PHRASES[lines])]
    capped = caption_line_cap.cap_items(items, _lipsync_params(), font, 1080, False)
    from app.services.subtitle_text import wrap_text

    for _, part in capped:
        wrapped, _ = wrap_text(part, max_width=972, font=font, fontsize=FONT_SIZE)
        assert _line_count(wrapped) <= 2
    assert " ".join(part for _, part in capped) == PHRASES[lines]
    assert len(capped) == (2 if lines == 3 else 1)


def test_a_split_cue_shares_its_span_without_gaps():
    capped = caption_line_cap.cap_items(
        [((1.0, 3.0), PHRASES[3])], _lipsync_params(), _font(), 1080, False
    )
    assert capped[0][0][0] == 1.0
    assert capped[-1][0][1] == 3.0
    for before, after in zip(capped, capped[1:]):
        assert before[0][1] == after[0][0]
    assert all(start < end for (start, end), _ in capped)


def test_the_background_padding_narrows_the_cap_width():
    assert caption_line_cap.text_box(65, True, 972) == (39, 894)
    assert caption_line_cap.text_box(65, False, 972) == (0, 972)


def test_other_paths_keep_their_cues_untouched():
    items = [((0.0, 2.0), PHRASES[3])]
    assert caption_line_cap.cap_items(items, _faceless_params(), _font(), 1080, False) == items


def test_a_word_wider_than_the_frame_is_kept_as_its_own_part():
    parts = caption_line_cap.split_to_fit("a b c", lambda part: False)
    assert parts == ["a", "b", "c"]


def _render_texts(tmp_path, monkeypatch, params, phrase):
    _font_file(tmp_path, monkeypatch)
    texts = []
    real_text_clip = vd.TextClip

    def recording_text_clip(*args, **kwargs):
        if "interline" in kwargs:
            texts.append(kwargs["text"])
        return real_text_clip(*args, **kwargs)

    monkeypatch.setattr(vd, "TextClip", recording_text_clip)
    base, audio, subtitle = _media(tmp_path, phrase)
    vd.generate_video(
        video_path=base,
        audio_path=audio,
        subtitle_path=subtitle,
        output_file=str(tmp_path / "out.mp4"),
        params=params,
        music_mood="",
    )
    return texts


@pytest.mark.parametrize("lines", [1, 2, 3])
def test_the_lipsync_render_never_builds_a_three_line_caption(tmp_path, monkeypatch, lines):
    texts = _render_texts(tmp_path, monkeypatch, _lipsync_params(), PHRASES[lines])
    assert texts
    assert max(_line_count(text) for text in texts) <= 2
    assert len(texts) == (2 if lines == 3 else 1)


def test_the_faceless_render_still_wraps_three_lines(tmp_path, monkeypatch):
    texts = _render_texts(tmp_path, monkeypatch, _faceless_params(), PHRASES[3])
    assert [_line_count(text) for text in texts] == [3]
