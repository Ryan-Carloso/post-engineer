"""video.generate_video: a caption spoken over a segment panel stays above it.

A persona video moves its centered caption down to the lip-sync position,
which lands inside a bottom-anchored panel. The panel's caption band pulls
the block back up, so the photo stays visible.
"""

import os
import shutil
import subprocess

import numpy as np
import pytest
from PIL import Image

from app.models.schema import PersonaParams, VideoParams
from app.services import full_lipsync, segment_panels
from app.services import video as vd

BLUE = (30, 30, 210)
FONT_CANDIDATES = (
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/dejavu/DejaVuSans.ttf",
)
TEXT_LINE = "EIGHT EUROS AT THE DOOR TODAY"


def _stub_bundled_font(tmp_path, monkeypatch):
    """Copy a system font under the bundled default name for this test.

    CI and a fresh checkout ship no fonts (resource/fonts is gitignored and
    baked into the image); the production default is still exercised.
    """
    source = next((path for path in FONT_CANDIDATES if os.path.exists(path)), None)
    if source is None:
        pytest.skip("no system TrueType font to stand in for the bundled default")
    fonts = tmp_path / "fonts"
    fonts.mkdir()
    shutil.copyfile(source, fonts / vd.DEFAULT_SUBTITLE_FONT)
    monkeypatch.setattr(vd.utils, "font_dir", lambda sub_dir="": str(fonts / sub_dir if sub_dir else fonts))


def _media(tmp_path):
    base = str(tmp_path / "base.mp4")
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "color=c=0x1e1ed2:s=1080x1920:r=25:d=2",
         "-pix_fmt", "yuv420p", base],
        check=True,
    )
    audio = str(tmp_path / "voice.wav")
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono", "-t", "2", audio],
        check=True,
    )
    subtitle = str(tmp_path / "subtitle.srt")
    with open(subtitle, "w", encoding="utf-8") as handle:
        handle.write("1\n00:00:00,200 --> 00:00:01,800\n" + TEXT_LINE + "\n\n")
    return base, audio, subtitle


def _text_rows(path, tmp_path):
    """First and last pixel row carrying caption text, in a rendered video."""
    frame = str(tmp_path / "frame.png")
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-ss", "1", "-i", path, "-frames:v", "1", frame], check=True)
    with Image.open(frame) as opened:
        pixels = np.asarray(opened.convert("RGB")).astype(int)
    differs = np.abs(pixels - np.array(BLUE)).sum(axis=2) > 90
    rows = np.where(differs.any(axis=1))[0]
    assert rows.size, "the caption was rendered"
    return int(rows.min()), int(rows.max())


def _render(tmp_path, caption_bands, name):
    base, audio, subtitle = _media(tmp_path)
    output = str(tmp_path / name)
    # The same params the final encode gets for a persona video.
    params = full_lipsync.caption_params(
        VideoParams(
            video_subject="x",
            video_aspect="9:16",
            persona=PersonaParams(name="p", photo_url="https://example.com/p.png", voice_id="calm"),
        )
    )
    vd.generate_video(
        video_path=base,
        audio_path=audio,
        subtitle_path=subtitle,
        output_file=output,
        params=params,
        music_mood="",
        caption_bands=caption_bands,
    )
    return output


def test_the_production_caption_position_lands_inside_the_panel_without_a_band(tmp_path, monkeypatch):
    _stub_bundled_font(tmp_path, monkeypatch)
    output = _render(tmp_path, (), "no-band.mp4")
    _top, bottom = _text_rows(output, tmp_path)
    panel_top = segment_panels.panel_rect(1080, 1920)[1]
    assert bottom >= panel_top, "without the band the caption covers the photo (the bug)"


def test_a_panel_band_lifts_the_caption_above_the_photo(tmp_path, monkeypatch):
    _stub_bundled_font(tmp_path, monkeypatch)
    panel_top = segment_panels.panel_rect(1080, 1920)[1]
    bands = [(0.0, 2.0, panel_top - segment_panels.CAPTION_GAP)]
    output = _render(tmp_path, bands, "band.mp4")
    top, bottom = _text_rows(output, tmp_path)
    assert bottom <= panel_top - segment_panels.CAPTION_GAP, "the captions stay above the panel"
    assert top > 0 and bottom < 1920, "the whole caption is on the frame"


def test_a_cue_that_starts_before_the_panel_is_still_lifted(tmp_path, monkeypatch):
    # The cue (0.2-1.8s) begins before the panel's interval (1.0-2.0s) but is on
    # screen when the photo appears: matching on the cue start alone would let
    # it cover the photo.
    _stub_bundled_font(tmp_path, monkeypatch)
    panel_top = segment_panels.panel_rect(1080, 1920)[1]
    bands = [(1.0, 2.0, panel_top - segment_panels.CAPTION_GAP)]
    output = _render(tmp_path, bands, "band-late.mp4")
    _top, bottom = _text_rows(output, tmp_path)
    assert bottom <= panel_top - segment_panels.CAPTION_GAP, "the captions stay above the panel"


def test_captions_use_the_frame_scaled_font_size_and_leave_the_callers_params_alone(tmp_path, monkeypatch):
    _stub_bundled_font(tmp_path, monkeypatch)
    sizes = []
    real_text_clip = vd.TextClip

    def recording_text_clip(*args, **kwargs):
        sizes.append(kwargs["font_size"])
        return real_text_clip(*args, **kwargs)

    scaled_calls = []

    def fake_scaled(font_size, width, height):
        scaled_calls.append((font_size, width, height))
        return 33

    monkeypatch.setattr(vd, "TextClip", recording_text_clip)
    monkeypatch.setattr(vd.subtitle_sizing, "scaled_font_size", fake_scaled)
    base, audio, subtitle = _media(tmp_path)
    params = VideoParams(video_subject="x", video_aspect="9:16", font_size=50)
    vd.generate_video(
        video_path=base,
        audio_path=audio,
        subtitle_path=subtitle,
        output_file=str(tmp_path / "out.mp4"),
        params=params,
        music_mood="",
    )
    assert scaled_calls == [(50, 1080, 1920)]
    assert sizes and set(sizes) == {33}, "every caption clip uses the scaled size"
    assert params.font_size == 50, "scaling must not compound across videos"
