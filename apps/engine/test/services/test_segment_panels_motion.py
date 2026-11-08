"""segment_panels with motion: full-frame photos of the images material zoom slowly."""

import subprocess

import pytest
from PIL import Image, ImageDraw

from app.models.schema import VideoAspect
from app.services import segment_panels
from app.services.segment_panels import Panel

RED = (210, 30, 30)
GREEN = (30, 200, 30)
BLUE = (30, 30, 210)
BAND = 40


def _near(pixel, color, tolerance=45):
    return all(abs(a - b) <= tolerance for a, b in zip(pixel[:3], color))


def _banded_photo(tmp_path, name="banded.jpg"):
    """A frame-sized red photo with a green band at the edges: zooming in pushes the band out."""
    path = str(tmp_path / name)
    image = Image.new("RGB", (1080, 1920), GREEN)
    ImageDraw.Draw(image).rectangle((BAND, BAND, 1080 - BAND, 1920 - BAND), fill=RED)
    image.save(path, "JPEG", quality=95)
    return path


def _video(tmp_path, seconds):
    path = str(tmp_path / "base.mp4")
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", f"color=c=0x1e1ed2:s=1080x1920:r=30:d={seconds}",
         "-f", "lavfi", "-i", f"sine=frequency=440:d={seconds}", "-c:v", "libx264", "-pix_fmt", "yuv420p",
         "-c:a", "aac", "-shortest", path],
        check=True,
    )
    return path


def _frame(path, seconds, tmp_path):
    frame = str(tmp_path / f"frame-{seconds}.png")
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-ss", str(seconds), "-i", path, "-frames:v", "1", frame], check=True)
    return Image.open(frame).convert("RGB")


def _duration(path):
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
        capture_output=True, text=True, check=True,
    )
    return float(probe.stdout.strip())


@pytest.fixture
def task_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(segment_panels.utils, "task_dir", lambda task_id: str(tmp_path))
    return tmp_path


def test_a_moving_panel_is_a_single_image_zoomed_into_a_finite_clip_that_passes_the_video_through():
    panels = [
        Panel(0, "/t/a.png", 0, 0, 0.0, 2.0, motion="in"),
        Panel(1, "/t/b.png", 10, 900, 2.0, 4.0, caption_bottom=880),
    ]
    command = segment_panels.overlay_command(
        "/t/in.mp4", panels, "/t/out.mp4", "libx264", "veryfast", "ffmpeg", frame_size=(1080, 1920)
    )
    graph = command[command.index("-filter_complex") + 1]
    assert command.count("-loop") == 1, "only the still panel loops; the moving one is a single image"
    assert "[1:v]scale=2160:3840,zoompan=" in graph
    assert "[0:v][m0]overlay=0:0:enable='between(t,0.000,2.000)':eof_action=pass[v0]" in graph
    assert "[v0][2:v]overlay=10:900:enable='between(t,2.000,4.000)':shortest=1[v1]" in graph


def test_without_a_frame_size_a_panel_with_motion_stays_a_still_overlay():
    panels = [Panel(0, "/t/a.png", 0, 0, 0.0, 2.0, motion="in")]
    command = segment_panels.overlay_command("/t/in.mp4", panels, "/t/out.mp4", "libx264", "veryfast", "ffmpeg")
    graph = command[command.index("-filter_complex") + 1]
    assert "zoompan" not in graph and command.count("-loop") == 1


def test_manifest_round_trips_the_motion(task_dir):
    panels = [Panel(0, "/t/a.png", 0, 0, 0.0, 3.0, motion="out")]
    segment_panels.write_manifest("t", panels, [])
    assert segment_panels._read_manifest("t")[0] == panels


def test_real_zoom_in_pushes_the_photo_edge_out_of_frame_and_keeps_the_whole_video(task_dir):
    base = _video(task_dir, seconds=5)
    built = segment_panels.build_full(
        _banded_photo(task_dir), None, None, VideoAspect.portrait, str(task_dir / "full.png")
    )
    segment_panels.write_manifest("t", [Panel(0, built.path, 0, 0, 1.0, 4.0, motion="in")], [])
    recorded = []
    out = segment_panels.overlay_onto("t", base, lambda *a, **k: recorded.append(k))
    assert out != base and recorded == []
    assert _near(_frame(out, 1.1, task_dir).getpixel((BAND // 2, 960)), GREEN), "the zoom starts on the whole photo"
    late = _frame(out, 3.8, task_dir)
    assert _near(late.getpixel((BAND // 2, 960)), RED), "by the end the zoom has pushed the edge band out"
    assert _near(late.getpixel((540, 960)), RED)
    assert _near(_frame(out, 0.5, task_dir).getpixel((540, 960)), BLUE), "no photo before its seconds"
    assert _near(_frame(out, 4.5, task_dir).getpixel((540, 960)), BLUE), "no photo after its seconds"
    assert _duration(out) == pytest.approx(_duration(base), abs=0.1), "the finite zoom clip never cuts the video short"


def test_real_zoom_out_starts_cropped_and_ends_on_the_whole_photo(task_dir):
    base = _video(task_dir, seconds=4)
    built = segment_panels.build_full(
        _banded_photo(task_dir), None, None, VideoAspect.portrait, str(task_dir / "full.png")
    )
    segment_panels.write_manifest("t", [Panel(0, built.path, 0, 0, 0.0, 4.0, motion="out")], [])
    out = segment_panels.overlay_onto("t", base, lambda *a, **k: None)
    assert _near(_frame(out, 0.1, task_dir).getpixel((BAND // 2, 960)), RED)
    assert _near(_frame(out, 3.9, task_dir).getpixel((BAND // 2, 960)), GREEN)


def test_an_unreadable_moving_panel_is_a_recorded_render_failure_not_a_crash(task_dir):
    segment_panels.write_manifest("t", [Panel(0, str(task_dir / "missing.png"), 0, 0, 0.0, 2.0, motion="in")], [])
    recorded = []
    assert segment_panels.overlay_onto("t", "/t/in.mp4", lambda *a, **k: recorded.append(k)) == "/t/in.mp4"
    assert recorded == [{"media_warnings": [segment_panels.REASON_RENDER_FAILED]}]
