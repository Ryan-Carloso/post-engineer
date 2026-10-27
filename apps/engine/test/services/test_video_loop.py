"""video_loop: the looped timeline ends with the voice, not a whole clip later.

combine_videos trims the last clip of its first pass to the remaining budget,
but when the material is short it looped WHOLE clips: a 6s clip could
overshoot the voiceover by up to 6s of picture over silence (v14: 54.0s of
video for a 49.4s voice). The loop now trims its last clip to the budget and
never repeats a place photo (a photo shown eight times reads as a mistake).
"""

import inspect
import shutil
import subprocess
from pathlib import Path
from unittest.mock import patch

import pytest

from app.services import image_material, video, video_loop
from app.services.place_names import PHOTO_FILE_PREFIX
from app.services.video import SubClippedVideoClip

needs_ffmpeg = pytest.mark.skipif(
    shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None,
    reason="ffmpeg is not installed",
)


def _clip(name, duration, source=None):
    return SubClippedVideoClip(
        file_path=f"/t/{name}.mp4",
        duration=duration,
        width=1080,
        height=1920,
        source_file_path=source or f"/src/{name}.mp4",
    )


def _extend(processed, required, start=None, reencode_error=None):
    base = list(processed)
    start = sum(clip.duration for clip in processed) if start is None else start
    with patch.object(
        video, "_reencode_clip_with_ffmpeg", side_effect=reencode_error
    ) as reencode, patch.object(video, "_get_configured_video_codec", return_value="libx264"):
        total = video_loop.extend(processed, base, start, required, "/t", 1080, 1920, 30, 2)
    return total, reencode


def test_the_last_looped_clip_is_trimmed_to_the_remaining_budget():
    processed = [_clip("a", 6), _clip("b", 6)]
    total, reencode = _extend(processed, 14.1)
    assert total == pytest.approx(14.1)
    kwargs = reencode.call_args.kwargs
    assert kwargs["src"] == "/t/a.mp4" and kwargs["out"] == "/t/loop-trim.mp4"
    assert kwargs["start_time"] == 0 and kwargs["end_time"] == pytest.approx(2.1)
    assert (kwargs["target_w"], kwargs["target_h"], kwargs["codec"]) == (1080, 1920, "libx264")
    assert len(processed) == 3
    assert processed[2].file_path == "/t/loop-trim.mp4" and processed[2].duration == pytest.approx(2.1)


def test_whole_clips_are_appended_while_they_fit():
    processed = [_clip("a", 4), _clip("b", 4)]
    total, reencode = _extend(processed, 12.0)
    assert total == pytest.approx(12.0)
    assert [clip.file_path for clip in processed] == ["/t/a.mp4", "/t/b.mp4", "/t/a.mp4"]
    reencode.assert_not_called()


def test_a_timeline_already_long_enough_is_left_alone():
    processed = [_clip("a", 20)]
    total, reencode = _extend(processed, 14.0)
    assert total == 20 and len(processed) == 1
    reencode.assert_not_called()


def test_a_sliver_under_a_few_hundredths_is_not_worth_a_clip():
    processed = [_clip("a", 6)]
    total, _ = _extend(processed, 14.0, start=13.97)
    assert total == 13.97 and len(processed) == 1


def test_place_photos_are_never_looped_when_drawings_exist():
    photo = _clip("photo", 6, source=f"/src/{PHOTO_FILE_PREFIX}0.jpg.mp4")
    processed = [photo, _clip("d", 6)]
    total, _ = _extend(processed, 30.0)
    assert total == pytest.approx(30.0)
    assert [clip.source_file_path for clip in processed[2:]] == ["/src/d.mp4"] * 3


def test_only_photos_still_loop_rather_than_leave_the_voice_uncovered():
    photo = _clip("photo", 6, source=f"/src/{PHOTO_FILE_PREFIX}0.jpg.mp4")
    processed = [photo]
    total, _ = _extend(processed, 12.0)
    assert total == pytest.approx(12.0) and len(processed) == 2


def test_zero_length_material_returns_instead_of_looping_forever():
    processed = [_clip("z", 0)]
    total, _ = _extend(processed, 5.0)
    assert total == 0 and len(processed) == 1


def test_a_failed_trim_falls_back_to_the_whole_clip():
    processed = [_clip("a", 6), _clip("b", 6)]
    total, _ = _extend(processed, 14.1, reencode_error=RuntimeError("ffmpeg died"))
    assert total == 18
    assert processed[-1].file_path == "/t/a.mp4"


@needs_ffmpeg
def test_real_ffmpeg_trims_the_last_looped_clip(tmp_path):
    source = tmp_path / "a.mp4"
    subprocess.run(
        [
            "ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i",
            "color=c=red:s=108x192:r=30:d=3", "-pix_fmt", "yuv420p", str(source),
        ],
        check=True,
    )
    clip = SubClippedVideoClip(
        file_path=str(source), duration=3.0, width=108, height=192, source_file_path=str(source)
    )
    processed = [clip]
    total = video_loop.extend(processed, [clip], 3.0, 4.0, str(tmp_path), 108, 192, 30, 2)
    assert total == pytest.approx(4.0)
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", processed[-1].file_path],
        check=True, capture_output=True, text=True,
    )
    assert float(probe.stdout) == pytest.approx(1.0, abs=0.15)


def test_combine_videos_loops_through_video_loop():
    source = inspect.getsource(video.combine_videos)
    assert "video_loop.extend(" in source
    assert "itertools.cycle(" not in source


def test_a_photo_clip_is_named_after_its_still():
    # video_loop finds photo clips by the name prefix of their SOURCE file: the
    # clip rendered from place-photo-0.jpg must stay place-photo-0.jpg.mp4.
    source = Path(image_material.__file__).read_text(encoding="utf-8")
    assert 'video_file = f"{image_path}.mp4"' in source
