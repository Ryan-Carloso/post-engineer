"""segment_panels: a segment photo as a framed panel over the video, never full frame."""

import subprocess
from unittest.mock import patch

import pytest
from PIL import Image, ImageFont

from app.models.schema import VideoAspect
from app.services import media_overlay, segment_panels
from app.services.segment_panels import Panel

RED = (210, 30, 30)
BLUE = (30, 30, 210)


def _font_for(size):
    return ImageFont.load_default(size)


def _photo(tmp_path, size=(1600, 1000), color=RED, name="photo.jpg"):
    path = str(tmp_path / name)
    Image.new("RGB", size, color).save(path, "JPEG", quality=95)
    return path


def _near(pixel, color, tolerance=40):
    return all(abs(a - b) <= tolerance for a, b in zip(pixel[:3], color))


# ---- geometry


def test_panel_sits_30px_from_the_bottom_and_is_38_percent_of_the_frame():
    x, y, width, height = segment_panels.panel_rect(1080, 1920)
    assert (x, width, height) == (40, 1000, 730)
    assert height / 1920 == pytest.approx(0.38, abs=0.001)
    assert y + height == 1920 - 30


def test_panel_leaves_room_above_it_for_the_captions():
    _, y, _, _ = segment_panels.panel_rect(1080, 1920)
    assert y == 1160, "the caption block above the panel keeps the photo clear"


def test_panel_never_covers_the_frame_and_leaves_the_side_margins():
    for aspect in (VideoAspect.portrait, VideoAspect.square, VideoAspect.landscape):
        width, height = aspect.to_resolution()
        x, y, panel_width, panel_height = segment_panels.panel_rect(width, height)
        assert x > 0 and x + panel_width < width
        assert panel_height < height * 0.4


def test_landscape_panel_is_capped_instead_of_spanning_the_whole_width():
    _, _, width, _ = segment_panels.panel_rect(1920, 1080)
    assert width == 1000


# ---- the drawn panel


def test_built_panel_is_a_transparent_png_larger_than_the_panel_by_its_shadow(tmp_path):
    out = str(tmp_path / "panel.png")
    built = segment_panels.build_panel(
        _photo(tmp_path), None, None, VideoAspect.portrait, out
    )
    assert built is not None and built.card_reason is None
    assert built.caption_bottom == 1160 - segment_panels.CAPTION_GAP, "captions stop above the panel"
    with Image.open(out) as image:
        assert image.mode == "RGBA"
        assert image.size == (1000 + 80, 730 + 80)
        assert image.getpixel((0, 0))[3] == 0, "outside the shadow the layer is transparent"
        assert image.getpixel((540, 40 + 365))[3] == 255, "the photo itself is opaque"
        assert _near(image.getpixel((540, 40 + 365)), RED)
    assert (built.x, built.y) == (0, 1120)


def test_panel_has_a_white_border_and_rounded_corners(tmp_path):
    out = str(tmp_path / "panel.png")
    segment_panels.build_panel(_photo(tmp_path), None, None, VideoAspect.portrait, out)
    with Image.open(out) as image:
        assert _near(image.getpixel((540, 41)), (255, 255, 255), 10), "the top edge is the white border"
        corner = image.getpixel((41, 41))
        assert corner[3] < 255 or not _near(corner, RED), "the corner is rounded off, not square photo"


def test_whole_photo_is_shown_over_a_blurred_backdrop_nothing_cropped(tmp_path):
    # A tall photo with a blue stripe at its very top and bottom: contain keeps both.
    path = str(tmp_path / "tall.jpg")
    photo = Image.new("RGB", (800, 1600), RED)
    for y in list(range(0, 40)) + list(range(1560, 1600)):
        for x in range(800):
            photo.putpixel((x, y), BLUE)
    photo.save(path, "JPEG", quality=95)
    out = str(tmp_path / "panel.png")
    segment_panels.build_panel(path, None, None, VideoAspect.portrait, out)
    with Image.open(out) as image:
        centre_x = 40 + 500
        assert _near(image.getpixel((centre_x, 40 + 12)), BLUE, 60)
        assert _near(image.getpixel((centre_x, 40 + 730 - 14)), BLUE, 60)


def test_card_is_painted_inside_the_panel(tmp_path):
    out = str(tmp_path / "panel.png")
    built = segment_panels.build_panel(
        _photo(tmp_path), {"title": "Sushi Kinoshita"}, _font_for, VideoAspect.portrait, out
    )
    assert built is not None and built.card_reason is None
    with Image.open(out) as image:
        card_pixel = image.getpixel((40 + 500, 40 + 30))
        assert not _near(card_pixel, RED, 60), "the card darkens the top of the panel"
        assert _near(image.getpixel((40 + 500, 40 + 700)), RED), "the rest of the photo is untouched"


def test_card_that_does_not_fit_keeps_the_plain_photo_and_says_why(tmp_path):
    out = str(tmp_path / "panel.png")
    built = segment_panels.build_panel(
        _photo(tmp_path), {"title": "W" * 120}, _font_for, VideoAspect.portrait, out
    )
    assert built is not None
    assert built.card_reason == media_overlay.REASON_NO_FIT


def test_card_without_a_font_keeps_the_plain_photo_and_says_why(tmp_path):
    out = str(tmp_path / "panel.png")
    built = segment_panels.build_panel(
        _photo(tmp_path), {"title": "Sushi"}, None, VideoAspect.portrait, out
    )
    assert built is not None
    assert built.card_reason == media_overlay.REASON_NO_FONT


def test_unreadable_photo_gives_no_panel(tmp_path):
    bad = tmp_path / "bad.jpg"
    bad.write_bytes(b"nope")
    assert (
        segment_panels.build_panel(
            str(bad), None, None, VideoAspect.portrait, str(tmp_path / "p.png")
        )
        is None
    )


# ---- the overlay command


def test_overlay_command_overlays_each_panel_only_for_its_seconds_and_keeps_the_audio():
    panels = [Panel(0, "/t/a.png", 0, -10, 1.0, 3.5), Panel(2, "/t/b.png", 0, -10, 5.0, 7.25)]
    command = segment_panels.overlay_command("/t/in.mp4", panels, "/t/out.mp4", "libx264", "veryfast", "ffmpeg")
    graph = command[command.index("-filter_complex") + 1]
    assert "[0:v][1:v]overlay=0:-10:enable='between(t,1.000,3.500)':shortest=1[v0]" in graph
    assert "[v0][2:v]overlay=0:-10:enable='between(t,5.000,7.250)':shortest=1[v1]" in graph
    assert command[command.index("-map") + 1] == "[v1]"
    assert "0:a?" in command
    assert command[command.index("-c:a") + 1] == "copy"
    assert command[-1] == "/t/out.mp4"
    assert command.count("-loop") == 2


# ---- manifest and the real overlay


def _video(tmp_path, seconds=4):
    path = str(tmp_path / "base.mp4")
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", f"color=c=0x1e1ed2:s=1080x1920:r=25:d={seconds}",
         "-f", "lavfi", "-i", f"sine=frequency=440:d={seconds}", "-c:v", "libx264", "-pix_fmt", "yuv420p",
         "-c:a", "aac", "-shortest", path],
        check=True,
    )
    return path


def _frame(path, seconds, tmp_path):
    frame = str(tmp_path / f"frame-{seconds}.png")
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-ss", str(seconds), "-i", path, "-frames:v", "1", frame], check=True)
    return Image.open(frame).convert("RGB")


@pytest.fixture
def task_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(segment_panels.utils, "task_dir", lambda task_id: str(tmp_path))
    return tmp_path


def test_manifest_round_trips_panels_and_warnings(task_dir):
    panels = [Panel(1, "/t/a.png", 0, -10, 1.5, 4.0)]
    segment_panels.write_manifest("t", panels, ["segment 0 media skipped: too small"])
    read_panels, read_warnings = segment_panels._read_manifest("t")
    assert read_panels == panels
    assert read_warnings == ["segment 0 media skipped: too small"]


def test_without_a_manifest_the_video_passes_through_untouched(task_dir):
    recorded = []
    assert segment_panels.overlay_onto("t", "/t/in.mp4", lambda *a, **k: recorded.append(k)) == "/t/in.mp4"
    assert recorded == []


def test_manifest_without_panels_passes_through_even_with_warnings(task_dir):
    segment_panels.write_manifest("t", [], ["segment 0 media skipped: too small"])
    recorded = []
    assert segment_panels.overlay_onto("t", "/t/in.mp4", lambda *a, **k: recorded.append(k)) == "/t/in.mp4"
    assert recorded == []


def test_real_overlay_shows_the_photo_only_in_its_seconds_and_never_full_frame(task_dir):
    base = _video(task_dir, seconds=4)
    built = segment_panels.build_panel(
        _photo(task_dir), None, None, VideoAspect.portrait, str(task_dir / "panel.png")
    )
    segment_panels.write_manifest("t", [Panel(0, built.path, built.x, built.y, 1.0, 3.0)], [])
    recorded = []
    out = segment_panels.overlay_onto("t", base, lambda *a, **k: recorded.append(k))
    assert out != base and recorded == []
    inside = _frame(out, 2, task_dir)
    assert _near(inside.getpixel((540, 1500)), RED), "the photo shows inside the panel while its segment is spoken"
    assert _near(inside.getpixel((540, 400)), BLUE), "the background shows above the panel: never full frame"
    assert _near(inside.getpixel((15, 1500)), BLUE), "and beside it"
    assert _near(_frame(out, 0.4, task_dir).getpixel((540, 1500)), BLUE), "no panel before its segment"
    assert _near(_frame(out, 3.6, task_dir).getpixel((540, 1500)), BLUE), "no panel after its segment"
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "a", "-show_entries", "stream=codec_name", "-of", "csv=p=0", out],
        capture_output=True, text=True, check=True,
    )
    assert probe.stdout.strip() == "aac", "the audio track is kept"


def test_panel_bands_record_each_panel_and_leave_full_frame_photos_alone(task_dir):
    panel = segment_panels.build_panel(
        _photo(task_dir), None, None, VideoAspect.portrait, str(task_dir / "panel.png")
    )
    full = segment_panels.build_full(_photo(task_dir, name="f.jpg"), None, None, VideoAspect.portrait, str(task_dir / "full.png"))
    segment_panels.write_manifest(
        "t",
        [
            Panel(0, panel.path, panel.x, panel.y, 0.5, 2.5, caption_bottom=panel.caption_bottom),
            Panel(1, full.path, full.x, full.y, 3.0, 5.0, caption_bottom=full.caption_bottom),
        ],
        [],
    )
    assert segment_panels.caption_bands("t") == [(0.5, 2.5, 1160 - segment_panels.CAPTION_GAP)]


def test_failed_overlay_keeps_the_video_and_records_the_stored_warnings_plus_the_failure(task_dir):
    segment_panels.write_manifest("t", [Panel(0, "/t/a.png", 0, 0, 1.0, 2.0)], ["segment 3 media skipped: too small"])
    recorded = []
    with patch.object(segment_panels.video, "_run_ffmpeg_bounded", side_effect=RuntimeError("boom")):
        out = segment_panels.overlay_onto("t", "/t/in.mp4", lambda task_id, **k: recorded.append((task_id, k)))
    assert out == "/t/in.mp4"
    assert recorded == [
        ("t", {"media_warnings": ["segment 3 media skipped: too small", segment_panels.REASON_RENDER_FAILED]})
    ]


def test_timed_out_overlay_is_a_failure_not_a_crash(task_dir):
    segment_panels.write_manifest("t", [Panel(0, "/t/a.png", 0, 0, 1.0, 2.0)], [])
    recorded = []
    with patch.object(
        segment_panels.video, "_run_ffmpeg_bounded", side_effect=subprocess.TimeoutExpired("ffmpeg", 1)
    ):
        out = segment_panels.overlay_onto("t", "/t/in.mp4", lambda task_id, **k: recorded.append(k))
    assert out == "/t/in.mp4"
    assert recorded and recorded[0]["media_warnings"][-1] == segment_panels.REASON_RENDER_FAILED


def test_a_failed_overlay_imposes_no_caption_band_on_the_panel_less_video(task_dir):
    # Captions must keep the user's placement: lifting them above a panel that
    # never reached the video leaves them floating over the footage.
    panel = Panel(0, "/t/a.png", 0, 0, 1.0, 2.0, caption_bottom=1100)
    segment_panels.write_manifest("t", [panel], [])
    assert segment_panels.caption_bands("t") == [(1.0, 2.0, 1100)]
    with patch.object(segment_panels.video, "_run_ffmpeg_bounded", side_effect=RuntimeError("boom")):
        segment_panels.overlay_onto("t", "/t/in.mp4", lambda task_id, **k: None)
    assert segment_panels.caption_bands("t") == []


# ---- full frame: faceless videos and the b-roll after a hook-only intro


def test_full_frame_photo_is_an_opaque_frame_sized_png_at_the_origin(tmp_path):
    out = str(tmp_path / "full.png")
    built = segment_panels.build_full(_photo(tmp_path), None, None, VideoAspect.portrait, out)
    assert built is not None and built.card_reason is None
    assert (built.x, built.y) == (0, 0)
    with Image.open(out) as image:
        assert image.size == (1080, 1920)
        assert image.mode == "RGB", "an opaque layer: nothing of the video shows through"
        assert _near(image.getpixel((540, 960)), RED)


def test_a_photo_that_does_not_fill_the_frame_gets_a_blurred_backdrop_not_black_bars(tmp_path):
    # A landscape photo contained in a portrait frame leaves bands above and
    # below it: they must be the blurred photo, never black.
    out = str(tmp_path / "full.png")
    segment_panels.build_full(_photo(tmp_path, size=(1600, 1000)), None, None, VideoAspect.portrait, out)
    with Image.open(out) as image:
        for y in (20, 300, 1620, 1900):
            assert _near(image.getpixel((540, y)), RED, 60), f"row {y} must be backdrop, got {image.getpixel((540, y))}"


def test_square_photo_in_a_portrait_frame_has_no_black_bars_either(tmp_path):
    out = str(tmp_path / "full.png")
    segment_panels.build_full(_photo(tmp_path, size=(1000, 1000)), None, None, VideoAspect.portrait, out)
    with Image.open(out) as image:
        assert _near(image.getpixel((540, 40)), RED, 60)
        assert _near(image.getpixel((540, 1880)), RED, 60)


def test_full_frame_card_sits_below_the_status_bar_inset_from_the_sides(tmp_path):
    out = str(tmp_path / "full.png")
    built = segment_panels.build_full(
        _photo(tmp_path), {"title": "Sushi Kinoshita", "subtitle": "Rua das Flores 12"}, _font_for,
        VideoAspect.portrait, out,
    )
    assert built is not None and built.card_reason is None
    left, top, right, bottom = segment_panels.full_card_rect(1080, 1920)
    with Image.open(out) as image:
        assert not _near(image.getpixel((540, top + 40)), RED, 60), "the card darkens the photo under the status bar"
        assert _near(image.getpixel((540, 60)), RED, 60), "the strip above the card stays photo"
        assert _near(image.getpixel((20, top + 40)), RED, 60), "and beside it"
        assert _near(image.getpixel((540, 1500)), RED), "the rest of the photo is untouched"
    assert bottom - top <= 1920 * 0.55


def test_full_frame_card_refusals_keep_the_plain_photo_and_say_why(tmp_path):
    long_title = segment_panels.build_full(
        _photo(tmp_path), {"title": "W" * 120}, _font_for, VideoAspect.portrait, str(tmp_path / "a.png")
    )
    assert long_title is not None and long_title.card_reason == media_overlay.REASON_NO_FIT
    no_font = segment_panels.build_full(
        _photo(tmp_path), {"title": "Sushi"}, None, VideoAspect.portrait, str(tmp_path / "b.png")
    )
    assert no_font is not None and no_font.card_reason == media_overlay.REASON_NO_FONT


def test_unreadable_photo_gives_no_full_frame_photo_and_leaves_no_temp_file(tmp_path):
    bad = tmp_path / "bad.jpg"
    bad.write_bytes(b"nope")
    out = str(tmp_path / "full.png")
    assert segment_panels.build_full(str(bad), None, None, VideoAspect.portrait, out) is None
    assert not (tmp_path / "full.png.still.jpg").exists()


def test_temp_still_is_removed_after_a_full_frame_photo_is_drawn(tmp_path):
    out = str(tmp_path / "full.png")
    segment_panels.build_full(_photo(tmp_path), None, None, VideoAspect.portrait, out)
    assert not (tmp_path / "full.png.still.jpg").exists()


def test_real_overlay_of_a_full_frame_photo_covers_the_whole_frame_only_in_its_seconds(task_dir):
    base = _video(task_dir, seconds=4)
    built = segment_panels.build_full(_photo(task_dir), None, None, VideoAspect.portrait, str(task_dir / "full.png"))
    segment_panels.write_manifest("t", [Panel(0, built.path, built.x, built.y, 1.0, 3.0)], [])
    out = segment_panels.overlay_onto("t", base, lambda *a, **k: None)
    inside = _frame(out, 2, task_dir)
    for point in ((540, 960), (20, 20), (540, 1900), (1060, 1000)):
        assert _near(inside.getpixel(point), RED), f"{point} must be the photo, not the video behind it"
    assert _near(_frame(out, 0.4, task_dir).getpixel((540, 960)), BLUE)
    assert _near(_frame(out, 3.6, task_dir).getpixel((540, 960)), BLUE)


def test_a_full_frame_photo_and_a_panel_can_follow_each_other_in_one_video(task_dir):
    base = _video(task_dir, seconds=6)
    panel = segment_panels.build_panel(
        _photo(task_dir, color=RED), None, None, VideoAspect.portrait, str(task_dir / "panel.png")
    )
    full = segment_panels.build_full(_photo(task_dir, color=(30, 200, 30), name="g.jpg"), None, None, VideoAspect.portrait, str(task_dir / "full.png"))
    segment_panels.write_manifest(
        "t", [Panel(0, panel.path, panel.x, panel.y, 0.5, 2.5), Panel(1, full.path, full.x, full.y, 3.0, 5.0)], []
    )
    out = segment_panels.overlay_onto("t", base, lambda *a, **k: None)
    first = _frame(out, 1.5, task_dir)
    assert _near(first.getpixel((540, 1500)), RED) and _near(first.getpixel((540, 400)), BLUE)
    second = _frame(out, 4, task_dir)
    assert _near(second.getpixel((540, 400)), (30, 200, 30)) and _near(second.getpixel((540, 1500)), (30, 200, 30))
