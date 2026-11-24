"""The hook title over the first seconds: manifest, ffmpeg overlay, card move.

The title is drawn at the materials stage and overlaid with the panels when
the final video is assembled. It is the last input and the last overlay, so
it sits above every panel, and it works with or without panels.
"""

import hashlib
import io
import json
import subprocess
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from PIL import Image, ImageFont

from app.models.schema import VideoAspect
from app.services import caption_layout, hook_title, hook_title_stage, image_fetch, media_overlay, segment_panels, user_media
from app.services.segment_panels import Panel

BLUE = (30, 30, 210)
RED = (210, 30, 30)
SIZE = (1080, 1920)


def _font_for(size):
    return ImageFont.load_default(size)


@pytest.fixture
def task_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(segment_panels.utils, "task_dir", lambda task_id: str(tmp_path))
    monkeypatch.setattr(user_media.utils, "task_dir", lambda task_id: str(tmp_path))
    return tmp_path


def _title(tmp_path, end=3.0, text="I entered the sea clothed?"):
    layer, reason = hook_title.build_title(text, _font_for, SIZE, str(tmp_path / "title.png"), end)
    assert reason is None and layer is not None
    return layer


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


def _white_pixels(image, top, bottom):
    return sum(
        1 for y in range(top, bottom, 4) for x in range(0, image.width, 4) if min(image.getpixel((x, y))) > 235
    )


def _command(panels, title):
    return segment_panels.overlay_command(
        "/t/in.mp4", panels, "/t/out.mp4", "libx264", "veryfast", "ffmpeg", title=title
    )


def _graph(command):
    return command[command.index("-filter_complex") + 1]


LAYER = hook_title.TitleLayer(path="/t/title.png", x=0, y=139, start=0.0, end=3.0, floor=425)


def test_without_panels_the_title_is_the_only_overlay_for_its_window():
    command = _command([], LAYER)
    assert command.count("-loop") == 1
    assert _graph(command) == "[0:v][1:v]overlay=0:139:enable='between(t,0.000,3.000)':shortest=1[vt]"
    assert command[command.index("-map") + 1] == "[vt]"


def test_a_window_shorter_than_three_seconds_ends_with_the_first_segment():
    shorter = hook_title.TitleLayer(path="/t/title.png", x=0, y=139, start=0.0, end=1.4, floor=425)
    assert "between(t,0.000,1.400)" in _graph(_command([], shorter))


def test_the_title_input_comes_after_the_panels_and_is_overlaid_last():
    panels = [Panel(0, "/t/a.png", 0, 0, 0.0, 2.0), Panel(1, "/t/b.png", 10, 900, 2.0, 4.0)]
    command = _command(panels, LAYER)
    inputs = [command[i + 1] for i, arg in enumerate(command) if arg == "-i"]
    assert inputs == ["/t/in.mp4", "/t/a.png", "/t/b.png", "/t/title.png"]
    graph = _graph(command)
    assert graph.endswith("[v1][3:v]overlay=0:139:enable='between(t,0.000,3.000)':shortest=1[vt]")
    assert command[command.index("-map") + 1] == "[vt]"


def test_without_a_title_the_command_has_no_title_step():
    command = _command([Panel(0, "/t/a.png", 0, 0, 0.0, 2.0)], None)
    assert "vt" not in _graph(command)
    assert command[command.index("-map") + 1] == "[v0]"


def test_the_manifest_round_trips_the_title(task_dir):
    layer = _title(task_dir)
    segment_panels.write_manifest("t", [], ["a warning"], layer)
    assert segment_panels.read_title("t") == layer
    assert segment_panels._read_manifest("t") == ([], ["a warning"])


def test_a_manifest_without_a_title_reads_none(task_dir):
    segment_panels.write_manifest("t", [], [])
    assert segment_panels.read_title("t") is None
    assert segment_panels.read_title("never-written") is None


def test_a_manifest_with_only_a_title_is_overlaid_not_passed_through(task_dir):
    segment_panels.write_manifest("t", [], [], _title(task_dir))
    base = _video(task_dir)
    out = segment_panels.overlay_onto("t", base, lambda *a, **k: None)
    assert out != base


def test_real_overlay_shows_the_title_on_the_first_seconds_only_with_no_panels(task_dir):
    segment_panels.write_manifest("t", [], [], _title(task_dir, end=2.0))
    out = segment_panels.overlay_onto("t", _video(task_dir, seconds=4), lambda *a, **k: None)
    band = (139, 139 + 250)
    assert _white_pixels(_frame(out, 1, task_dir), *band) > 20, "the title is on screen inside its window"
    assert _white_pixels(_frame(out, 3, task_dir), *band) == 0, "and gone after it"
    assert _white_pixels(_frame(out, 1, task_dir), 900, 1000) == 0, "nothing else changed"


def test_real_overlay_draws_the_title_above_a_full_frame_panel(task_dir):
    photo = str(task_dir / "photo.jpg")
    Image.new("RGB", (1080, 1920), RED).save(photo, "JPEG")
    built = segment_panels.build_full(photo, None, None, VideoAspect.portrait, str(task_dir / "full.png"))
    segment_panels.write_manifest("t", [Panel(0, built.path, 0, 0, 0.0, 4.0)], [], _title(task_dir))
    out = segment_panels.overlay_onto("t", _video(task_dir), lambda *a, **k: None)
    frame = _frame(out, 1, task_dir)
    assert _white_pixels(frame, 139, 139 + 250) > 20, "white title text over the red photo"
    assert frame.getpixel((540, 1500))[0] > 150, "the photo still covers the rest of the frame"


def test_a_failed_overlay_clears_the_title_and_records_it(task_dir):
    segment_panels.write_manifest("t", [], ["kept warning"], _title(task_dir))
    recorded = []
    with patch.object(segment_panels.video, "_run_ffmpeg_bounded", side_effect=RuntimeError("boom")):
        out = segment_panels.overlay_onto("t", "/t/in.mp4", lambda task_id, **k: recorded.append(k))
    assert out == "/t/in.mp4"
    assert recorded == [{"media_warnings": ["kept warning", segment_panels.REASON_TITLE_RENDER_FAILED]}]
    assert segment_panels.read_title("t") is None, "no title is on screen, so nothing may reserve room for it"


def test_a_failed_overlay_with_panels_and_a_title_records_both(task_dir):
    segment_panels.write_manifest("t", [Panel(0, "/t/a.png", 0, 0, 1.0, 2.0)], [], _title(task_dir))
    recorded = []
    with patch.object(segment_panels.video, "_run_ffmpeg_bounded", side_effect=RuntimeError("boom")):
        segment_panels.overlay_onto("t", "/t/in.mp4", lambda task_id, **k: recorded.append(k))
    assert recorded[0]["media_warnings"] == [
        segment_panels.REASON_RENDER_FAILED,
        segment_panels.REASON_TITLE_RENDER_FAILED,
    ]


def test_a_failed_panel_only_overlay_does_not_blame_a_title(task_dir):
    segment_panels.write_manifest("t", [Panel(0, "/t/a.png", 0, 0, 1.0, 2.0)], [])
    recorded = []
    with patch.object(segment_panels.video, "_run_ffmpeg_bounded", side_effect=RuntimeError("boom")):
        segment_panels.overlay_onto("t", "/t/in.mp4", lambda task_id, **k: recorded.append(k))
    assert recorded[0]["media_warnings"] == [segment_panels.REASON_RENDER_FAILED]


def test_the_manifest_title_becomes_a_caption_floor_next_to_the_panel_bands(task_dir):
    layer = _title(task_dir, end=2.0)
    panel = Panel(0, "/t/a.png", 0, 0, 1.0, 2.0, caption_bottom=1100)
    segment_panels.write_manifest("t", [panel], [], layer)
    bands = segment_panels.caption_bands("t")
    assert bands == [(1.0, 2.0, 1100), caption_layout.TitleFloor(0.0, 2.0, layer.floor)]
    assert caption_layout.cue_floor(bands, (0.5, 1.0)) == layer.floor
    assert caption_layout.cue_bottom(bands, (1.2, 1.8)) == 1100


def test_without_a_title_the_caption_bands_have_no_floor(task_dir):
    segment_panels.write_manifest("t", [], [])
    assert segment_panels.caption_bands("t") == []


def test_a_failed_overlay_leaves_no_caption_floor_for_a_title_that_is_not_on_screen(task_dir):
    segment_panels.write_manifest("t", [], [], _title(task_dir))
    assert segment_panels.caption_bands("t") != []
    with patch.object(segment_panels.video, "_run_ffmpeg_bounded", side_effect=RuntimeError("boom")):
        segment_panels.overlay_onto("t", "/t/in.mp4", lambda *a, **k: None)
    assert segment_panels.caption_bands("t") == []


# --- the full-frame info card moves below the title ----------------------


def test_full_card_rect_moves_down_to_the_given_top_and_keeps_its_height():
    default = segment_panels.full_card_rect(1080, 1920)
    moved = segment_panels.full_card_rect(1080, 1920, top=425)
    assert moved[1] == 425 and moved[1] > default[1]
    assert moved[3] - moved[1] == default[3] - default[1]
    assert moved[3] < 1920, "the moved card still fits the frame"


def test_a_moved_card_is_painted_below_the_title_floor(tmp_path):
    photo = str(tmp_path / "photo.jpg")
    Image.new("RGB", (1080, 1920), RED).save(photo, "JPEG")
    out = str(tmp_path / "full.png")
    overlay = {"title": "Sushi Kinoshita"}
    segment_panels.build_full(photo, overlay, _font_for, VideoAspect.portrait, out, card_top=425)
    with Image.open(out) as image:
        card = image.getpixel((540, 425 + media_overlay.INSET + 8))
        above = image.getpixel((540, 425 - 20))
    assert max(card) < 120, "the dark card fill starts at the floor, inset like any card"
    assert above[0] > 150, "and the photo shows above it, where the title is"


def test_the_card_stays_in_place_when_no_card_top_is_given(tmp_path):
    photo = str(tmp_path / "photo.jpg")
    Image.new("RGB", (1080, 1920), RED).save(photo, "JPEG")
    out = str(tmp_path / "full.png")
    segment_panels.build_full(photo, {"title": "Sushi Kinoshita"}, _font_for, VideoAspect.portrait, out)
    _, top, _, _ = segment_panels.full_card_rect(1080, 1920)
    with Image.open(out) as image:
        assert max(image.getpixel((540, top + media_overlay.INSET + 8))) < 120


@pytest.mark.parametrize(
    ("panel_start", "expected"), [(0.0, 425), (2.9, 425), (3.0, None), (4.5, None)]
)
def test_card_top_applies_only_to_a_photo_that_starts_inside_the_window(panel_start, expected):
    assert hook_title.card_top(LAYER, panel_start) == expected


def test_card_top_is_none_without_a_title():
    assert hook_title.card_top(None, 0.0) is None


# --- the materials stage ---------------------------------------------------

WORDS = [("Welcome", 0.0, 0.5), ("to", 0.5, 0.7), ("Porto", 0.7, 1.2), ("Visit", 5.0, 5.4), ("Porto", 5.4, 5.9)]
SEGMENTS = [
    {"kind": "hook", "text": "Welcome to Porto.", "media": [{"url": "https://e.com/hook.jpg", "overlay": {"title": "Cafe"}}]},
    {"kind": "content", "text": "Visit Porto.", "media": [{"url": "https://e.com/cta.jpg", "overlay": {"title": "Bar"}}]},
]


def _subtitle(tmp_path):
    path = str(tmp_path / "subtitle.srt")
    with open(path, "w", encoding="utf-8") as handle:
        handle.write("1\n00:00:00,000 --> 00:00:06,000\nPorto\n\n")
    with open(f"{path}.words.json", "w", encoding="utf-8") as handle:
        json.dump([[text, start, end] for text, start, end in WORDS], handle)
    return path


def _download(url, dest_path, session=None, width=1080, height=1920):
    digest = hashlib.sha256(url.encode()).digest()
    buffer = io.BytesIO()
    Image.new("RGB", (width, height), tuple(digest[:3])).save(buffer, "JPEG")
    with open(dest_path, "wb") as handle:
        handle.write(buffer.getvalue())
    return dest_path


def _params(segments=SEGMENTS, **extra):
    return SimpleNamespace(
        video_aspect="9:16", font_name="x.ttf", segments=segments, persona=None,
        video_script="\n\n".join(s["text"] for s in segments or []), **extra,
    )


@pytest.fixture
def fonts(monkeypatch):
    monkeypatch.setattr(hook_title_stage, "_font", lambda params: _font_for)
    monkeypatch.setattr(user_media, "_overlay_font", lambda params, segments: _font_for)


def _prepare(task_dir, params):
    with patch.object(image_fetch, "download_image", side_effect=_download):
        return user_media.prepare_segment_panels("task-1", params, _subtitle(task_dir), 6.0)


def test_a_request_without_a_title_writes_no_title(task_dir, fonts):
    _prepare(task_dir, _params())
    assert segment_panels.read_title("task-1") is None


def test_the_title_is_drawn_and_stored_with_the_first_segment_as_its_window(task_dir, fonts):
    warnings = _prepare(task_dir, _params(hook_title="I entered the sea clothed?"))
    layer = segment_panels.read_title("task-1")
    assert warnings == []
    assert layer is not None and (layer.start, layer.end) == (0.0, 1.2)
    assert layer.floor > layer.y


def test_a_title_without_segments_still_gets_a_manifest_with_the_full_window(task_dir, fonts):
    warnings = _prepare(task_dir, _params(segments=None, hook_title="Porto?"))
    layer = segment_panels.read_title("task-1")
    assert warnings == []
    assert layer is not None and layer.end == hook_title.HOOK_TITLE_SECONDS


def test_no_segments_and_no_title_writes_nothing(task_dir, fonts):
    assert _prepare(task_dir, _params(segments=None)) == []
    assert segment_panels.read_title("task-1") is None


def test_a_title_that_cannot_be_drawn_is_a_warning_and_the_video_still_ships(task_dir, monkeypatch):
    monkeypatch.setattr(hook_title_stage, "_font", lambda params: None)
    monkeypatch.setattr(user_media, "_overlay_font", lambda params, segments: _font_for)
    warnings = _prepare(task_dir, _params(hook_title="Porto?"))
    assert hook_title.REASON_NO_FONT in warnings
    assert segment_panels.read_title("task-1") is None
    panels, _ = segment_panels._read_manifest("task-1")
    assert panels, "the photos are still prepared"


def test_a_full_frame_photo_starting_in_the_window_gets_its_card_moved(task_dir, fonts):
    real = segment_panels.build_full
    seen = []

    def spy(photo, overlay, font_for, aspect, out_path, card_top=None):
        seen.append(card_top)
        return real(photo, overlay, font_for, aspect, out_path, card_top)

    with patch.object(segment_panels, "build_full", side_effect=spy):
        _prepare(task_dir, _params(hook_title="Porto?"))
    layer = segment_panels.read_title("task-1")
    assert layer is not None
    assert seen == [layer.floor, None], "the photo at 0s is moved, the one at 3s keeps its place"


def test_without_a_title_no_card_is_moved(task_dir, fonts):
    real = segment_panels.build_full
    seen = []

    def spy(photo, overlay, font_for, aspect, out_path, card_top=None):
        seen.append(card_top)
        return real(photo, overlay, font_for, aspect, out_path, card_top)

    with patch.object(segment_panels, "build_full", side_effect=spy):
        _prepare(task_dir, _params())
    assert seen == [None, None]


def test_a_window_with_no_time_is_refused_with_a_reason(tmp_path):
    layer, warnings = hook_title_stage.prepare_title(
        SimpleNamespace(hook_title="Porto?", segments=None, font_name="x.ttf"), "x", 0.0, VideoAspect.portrait, str(tmp_path)
    )
    assert layer is None and warnings == [hook_title_stage.REASON_NO_WINDOW]


def test_the_overlay_runs_after_the_lip_sync_intro_is_spliced_in():
    source = (user_media.__file__).replace("services/user_media.py", "services/task.py")
    text = open(source, encoding="utf-8").read()
    splice = text.index("prepare_persona_lipsync_video(")
    overlay = text.index("segment_panels.overlay_onto(")
    assert splice < overlay, "the title must land on the final video, above the LongCat clip"
