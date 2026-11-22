"""Subtitle font size: `font_size` is pixels at a 1080px short side."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from app.services import subtitle_sizing


def test_portrait_1080_is_unchanged():
    assert subtitle_sizing.scaled_font_size(50, 1080, 1920) == 50


def test_landscape_1080_is_unchanged():
    assert subtitle_sizing.scaled_font_size(50, 1920, 1080) == 50


def test_smaller_frames_scale_down_by_the_short_side():
    assert subtitle_sizing.scaled_font_size(60, 720, 1280) == 40


def test_larger_frames_scale_up():
    assert subtitle_sizing.scaled_font_size(50, 2160, 3840) == 100


def test_the_result_never_drops_below_the_schema_minimum():
    assert subtitle_sizing.scaled_font_size(8, 360, 640) == subtitle_sizing.MIN_FONT_SIZE


def test_the_minimum_matches_the_schema_lower_bound():
    from app.models.schema import VideoParams

    bound = VideoParams.model_fields["font_size"].metadata[0].ge
    assert subtitle_sizing.MIN_FONT_SIZE == bound


import os
import shutil
import subprocess

import numpy as np
import pytest
from PIL import Image, ImageDraw, ImageFont

from app.models.schema import VideoParams
from app.services import subtitle_text
from app.services import video as vd

FONT_CANDIDATES = (
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/dejavu/DejaVuSans.ttf",
)
PHRASES = {
    1: "Going to the gym today",
    2: "Going to the gym today because everybody",
    3: "Going to the gym today because everybody keeps jumping",
}
BRANCHES = {
    "plain": {"text_background_color": False},
    "square": {"text_background_color": "#000000"},
    "rounded": {"text_background_color": "#000000", "rounded_subtitle_background": True},
}
FONT_SIZE = 65
BOTTOM_SLACK = 3


def _font_file(tmp_path, monkeypatch):
    source = next((path for path in FONT_CANDIDATES if os.path.exists(path)), None)
    if source is None:
        pytest.skip("no system TrueType font to stand in for the bundled default")
    fonts = tmp_path / "fonts"
    fonts.mkdir()
    shutil.copyfile(source, fonts / vd.DEFAULT_SUBTITLE_FONT)
    monkeypatch.setattr(
        vd.utils, "font_dir", lambda sub_dir="": str(fonts / sub_dir if sub_dir else fonts)
    )
    return source


def _media(tmp_path, phrase):
    base = str(tmp_path / "base.mp4")
    audio = str(tmp_path / "voice.wav")
    subtitle = str(tmp_path / "subtitle.srt")
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i",
         "color=c=0x1e1ed2:s=1080x1920:r=25:d=2", "-pix_fmt", "yuv420p", base],
        check=True,
    )
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono",
         "-t", "2", audio],
        check=True,
    )
    with open(subtitle, "w", encoding="utf-8") as handle:
        handle.write("1\n00:00:00,200 --> 00:00:01,800\n" + phrase + "\n\n")
    return base, audio, subtitle


def _render_caption(tmp_path, monkeypatch, phrase, branch):
    _font_file(tmp_path, monkeypatch)
    texts = []
    text_kwargs = []
    boxes = []
    real_text_clip = vd.TextClip
    real_composite = vd.CompositeVideoClip

    def recording_text_clip(*args, **kwargs):
        clip = real_text_clip(*args, **kwargs)
        if "interline" in kwargs:
            texts.append(clip)
            text_kwargs.append(kwargs)
        return clip

    def recording_composite(clips, *args, **kwargs):
        composite = real_composite(clips, *args, **kwargs)
        if "size" in kwargs:
            boxes.append((clips, kwargs["size"]))
        return composite

    monkeypatch.setattr(vd, "TextClip", recording_text_clip)
    monkeypatch.setattr(vd, "CompositeVideoClip", recording_composite)
    base, audio, subtitle = _media(tmp_path, phrase)
    params = VideoParams(
        video_title="x",
        video_description="Test description.",
        video_type="faceless",
        video_aspect="9:16",
        font_size=FONT_SIZE,
        **BRANCHES[branch],
    )
    vd.generate_video(
        video_path=base,
        audio_path=audio,
        subtitle_path=subtitle,
        output_file=str(tmp_path / "out.mp4"),
        params=params,
        music_mood="",
    )
    assert len(texts) == 1, "exactly one caption clip was built"
    text_clip = texts[0]
    text_clip.kwargs = text_kwargs[0]
    if branch == "plain":
        return text_clip, text_clip.h, 0
    clips, size = boxes[0]
    return text_clip, size[1], int(clips[1].pos(0)[1])


def _ink_bottom(text_clip):
    alpha = text_clip.mask.get_frame(0)
    rows = np.where((alpha > 0.01).any(axis=1))[0]
    return int(rows.max())


@pytest.mark.parametrize("branch", list(BRANCHES))
@pytest.mark.parametrize("lines", [1, 2, 3])
def test_the_caption_box_covers_the_ink_bottom_of_the_last_line(
    tmp_path, monkeypatch, lines, branch
):
    text_clip, box_height, text_y = _render_caption(tmp_path, monkeypatch, PHRASES[lines], branch)
    assert str(text_clip.text).count("\n") + 1 == lines
    assert text_y + _ink_bottom(text_clip) < box_height


@pytest.mark.parametrize("lines", [1, 2, 3])
def test_the_plain_caption_keeps_its_bottom_rows_transparent(tmp_path, monkeypatch, lines):
    text_clip, box_height, _ = _render_caption(tmp_path, monkeypatch, PHRASES[lines], "plain")
    alpha = text_clip.mask.get_frame(0)
    unclipped = vd.TextClip(**{**text_clip.kwargs, "size": (text_clip.w, None), "margin": (0, 19)})
    assert box_height >= unclipped.h, "the box is as tall as the unclipped text"
    assert alpha.shape[0] == box_height
    assert alpha[-BOTTOM_SLACK:].max() < 0.01
    assert _ink_bottom(text_clip) < box_height - BOTTOM_SLACK


@pytest.mark.parametrize("lines", [1, 2, 3])
def test_wrap_text_height_covers_every_emitted_line(lines):
    font_file = next((path for path in FONT_CANDIDATES if os.path.exists(path)), None)
    if font_file is None:
        pytest.skip("no system TrueType font")
    wrapped, height = subtitle_text.wrap_text(
        PHRASES[lines], max_width=972, font=font_file, fontsize=FONT_SIZE
    )
    assert wrapped.count("\n") + 1 == lines
    font = ImageFont.truetype(font_file, FONT_SIZE)
    ascent, descent = font.getmetrics()
    interline = int(FONT_SIZE * 0.25)
    assert height == lines * (ascent + descent) + (lines - 1) * interline
    canvas = ImageDraw.Draw(Image.new("L", (1, 1)))
    _, _, _, ink_bottom = canvas.multiline_textbbox(
        (0, 0), wrapped, font=font, spacing=interline, anchor="la"
    )
    assert height >= ink_bottom
