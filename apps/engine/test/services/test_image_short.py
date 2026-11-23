"""Still image to vertical YouTube Short (app/services/image_short.py)."""

from __future__ import annotations

import io
import json
import shutil
import subprocess
from pathlib import Path

import pytest
from PIL import Image

from app.services import image_short
from app.services.image_short import (
    MAX_IMAGE_SHORT_BYTES,
    BackgroundTrack,
    ImageShortError,
    ffmpeg_command,
    filter_graph,
    normalized_png,
    render_image_short,
)
from app.utils import utils


def _image_bytes(size: tuple[int, int], fmt: str = "JPEG", exif_rotation: int | None = None) -> bytes:
    image = Image.new("RGB", size, (200, 40, 40))
    buffer = io.BytesIO()
    if exif_rotation is None:
        image.save(buffer, format=fmt)
    else:
        exif = Image.Exif()
        exif[0x0112] = exif_rotation
        image.save(buffer, format=fmt, exif=exif.tobytes())
    return buffer.getvalue()


def _repo_root() -> Path:
    for parent in Path(__file__).resolve().parents:
        if (parent / "shared/contracts/upload-types.ts").is_file():
            return parent
    raise AssertionError("repo root not found from the test file location")


def test_max_image_bytes_matches_the_shared_upload_limit():
    text = (_repo_root() / "shared/contracts/upload-types.ts").read_text(encoding="utf-8")
    assert "export const MAX_IMAGE_UPLOAD_BYTES = 8 * 1024 * 1024;" in text
    assert MAX_IMAGE_SHORT_BYTES == 8 * 1024 * 1024


def test_normalized_png_applies_the_exif_rotation():
    rotated = normalized_png(_image_bytes((400, 200), exif_rotation=6))
    with Image.open(io.BytesIO(rotated)) as image:
        assert image.format == "PNG"
        assert image.size == (200, 400)


def test_normalized_png_accepts_png():
    with Image.open(io.BytesIO(normalized_png(_image_bytes((10, 20), fmt="PNG")))) as image:
        assert image.size == (10, 20)
        assert image.mode == "RGB"


def test_normalized_png_rejects_a_format_other_than_jpeg_or_png():
    with pytest.raises(ImageShortError) as caught:
        normalized_png(_image_bytes((10, 10), fmt="GIF"))
    assert caught.value.code == "invalid_image"


def test_normalized_png_rejects_bytes_that_are_not_an_image():
    with pytest.raises(ImageShortError) as caught:
        normalized_png(b"not an image")
    assert caught.value.code == "invalid_image"


def test_normalized_png_rejects_an_image_over_the_byte_cap():
    with pytest.raises(ImageShortError) as caught:
        normalized_png(b"\xff" * (MAX_IMAGE_SHORT_BYTES + 1))
    assert caught.value.code == "image_too_large"


def test_filter_graph_centres_the_zoom_and_fades_the_music_out():
    graph = filter_graph()
    assert "zoompan=z='1+0.06*on/240':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2'" in graph
    assert "s=1080x1920:fps=30" in graph
    assert "force_original_aspect_ratio=decrease" in graph
    assert "gblur=sigma=40" in graph
    assert "afade=t=out:st=7.0:d=1.0" in graph


def test_ffmpeg_command_starts_the_track_at_its_offset():
    command = ffmpeg_command("ffmpeg", "/w/image.png", BackgroundTrack("/songs/a.mp3", 12.5), "/w/out.mp4")
    assert command[command.index("-ss") + 1] == "12.500"
    assert command[command.index("-ss") + 3] == "/songs/a.mp3"
    assert command[-1] == "/w/out.mp4"
    assert "anullsrc=r=44100:cl=stereo" not in command


def test_ffmpeg_command_without_a_track_renders_silence():
    command = ffmpeg_command("ffmpeg", "/w/image.png", None, "/w/out.mp4")
    assert "anullsrc=r=44100:cl=stereo" in command
    assert "-ss" not in command


def test_pick_background_track_logs_an_error_on_an_empty_catalog(monkeypatch):
    errors: list[str] = []
    monkeypatch.setattr(image_short, "get_available_music_moods", lambda: ())
    monkeypatch.setattr(image_short.logger, "error", errors.append)
    assert image_short.pick_background_track() is None
    assert errors == ["BGM catalog is empty: image Short renders without music"]


def test_pick_background_track_uses_the_first_catalogued_mood(monkeypatch):
    from app.services import video

    picked: list[str] = []
    monkeypatch.setattr(image_short, "get_available_music_moods", lambda: ("calm", "upbeat"))
    monkeypatch.setattr(video, "get_bgm_file", lambda mood: picked.append(mood) or "/songs/calm.mp3")
    monkeypatch.setattr(video, "get_bgm_start_offset", lambda path: 4.0)
    assert image_short.pick_background_track() == BackgroundTrack("/songs/calm.mp3", 4.0)
    assert picked == ["calm"]


def test_render_failure_raises_render_failed_with_a_scrubbed_message(tmp_path, monkeypatch):
    errors: list[str] = []
    monkeypatch.setattr(image_short.logger, "error", errors.append)

    def failing_run(command, **kwargs):
        return subprocess.CompletedProcess(command, 1, b"", f"{tmp_path}/image.png: boom".encode())

    with pytest.raises(ImageShortError) as caught:
        render_image_short(_image_bytes((50, 50)), str(tmp_path), pick_track=lambda: None, run=failing_run)
    assert caught.value.code == "render_failed"
    assert str(tmp_path) not in str(caught.value)
    assert "boom" in str(caught.value)
    assert errors == [str(caught.value)]


def test_render_timeout_raises_render_failed(tmp_path, monkeypatch):
    monkeypatch.setattr(image_short.logger, "error", lambda message: None)

    def slow_run(command, **kwargs):
        raise subprocess.TimeoutExpired(command, kwargs["timeout"])

    with pytest.raises(ImageShortError) as caught:
        render_image_short(_image_bytes((50, 50)), str(tmp_path), pick_track=lambda: None, run=slow_run)
    assert caught.value.code == "render_failed"


def test_render_returns_the_output_file_bytes(tmp_path):
    def fake_run(command, **kwargs):
        Path(command[-1]).write_bytes(b"mp4-bytes")
        return subprocess.CompletedProcess(command, 0, b"", b"")

    assert render_image_short(_image_bytes((50, 50)), str(tmp_path), pick_track=lambda: None, run=fake_run) == b"mp4-bytes"


@pytest.mark.skipif(shutil.which("ffprobe") is None, reason="ffprobe is not installed")
def test_real_render_is_an_eight_second_vertical_short_with_audio(tmp_path):
    video = render_image_short(_image_bytes((1600, 900)), str(tmp_path), pick_track=lambda: None)
    output = tmp_path / "probe.mp4"
    output.write_bytes(video)
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "stream=codec_type,width,height,duration", "-of", "json", str(output)],
        capture_output=True,
        check=True,
    )
    streams = json.loads(probe.stdout)["streams"]
    video_stream = next(stream for stream in streams if stream["codec_type"] == "video")
    audio_stream = next(stream for stream in streams if stream["codec_type"] == "audio")
    assert (video_stream["width"], video_stream["height"]) == (1080, 1920)
    assert float(video_stream["duration"]) == pytest.approx(8.0, abs=0.1)
    assert float(audio_stream["duration"]) == pytest.approx(8.0, abs=0.1)
    assert utils.get_ffmpeg_binary()
