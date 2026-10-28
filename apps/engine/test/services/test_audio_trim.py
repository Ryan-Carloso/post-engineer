"""audio_trim: the voiceover ends where the speech ends.

A Chatterbox voiceover came back with ~6s of trailing silence: the video is
cut to the audio file's length, so drawings kept playing over silence after
the call to action. The trailing silence is cut (keeping a short breath);
any failure keeps the original file, never fails the task.
"""

import inspect
import os
import shutil
import subprocess
from unittest.mock import patch

import pytest
from loguru import logger

from app.services import audio_trim

needs_ffmpeg = pytest.mark.skipif(
    shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None,
    reason="ffmpeg is not installed",
)

_LOG_TRAILING = """
[silencedetect @ 0x1] silence_start: 12.1
[silencedetect @ 0x1] silence_end: 12.9 | silence_duration: 0.8
[silencedetect @ 0x1] silence_start: 36.04
"""


def test_speech_ends_at_the_silence_that_runs_to_the_end():
    assert audio_trim.speech_end_seconds(_LOG_TRAILING, 42.27) == 36.04


def test_silence_end_printed_at_the_file_end_still_counts():
    # Newer ffmpeg prints silence_end at EOF for a trailing silence.
    log = "silence_start: 2.999977\nsilence_end: 7 | silence_duration: 4.000023\n"
    assert audio_trim.speech_end_seconds(log, 7.0) == 2.999977


def test_no_open_silence_means_speech_runs_to_the_end():
    log = "[silencedetect @ 0x1] silence_start: 1.0\n[silencedetect @ 0x1] silence_end: 2.0 | silence_duration: 1.0\n"
    assert audio_trim.speech_end_seconds(log, 5.0) is None
    assert audio_trim.speech_end_seconds("", 5.0) is None


def test_long_trailing_silence_is_cut_keeping_a_breath(tmp_path):
    audio = tmp_path / "audio.mp3"
    audio.write_bytes(b"x")
    calls = []

    def run(cmd, **kwargs):
        calls.append(cmd)
        if "silencedetect" in " ".join(cmd):
            return subprocess.CompletedProcess(cmd, 0, "", _LOG_TRAILING)
        (tmp_path / "audio.trimmed.mp3").write_bytes(b"y")
        return subprocess.CompletedProcess(cmd, 0, "", "")

    with patch.object(audio_trim.subprocess, "run", side_effect=run), patch.object(
        audio_trim, "_duration", return_value=42.27
    ):
        assert audio_trim.trim_trailing_silence(str(audio)) == 36.04 + audio_trim.KEEP_SECONDS
    cut = calls[1]
    assert cut[cut.index("-t") + 1] == f"{36.04 + audio_trim.KEEP_SECONDS:.3f}"
    assert audio.read_bytes() == b"y"


def test_short_trailing_silence_is_left_alone(tmp_path):
    audio = tmp_path / "audio.mp3"
    audio.write_bytes(b"x")
    with patch.object(
        audio_trim.subprocess,
        "run",
        return_value=subprocess.CompletedProcess([], 0, "", _LOG_TRAILING),
    ) as run, patch.object(audio_trim, "_duration", return_value=36.5):
        assert audio_trim.trim_trailing_silence(str(audio)) is None
    assert run.call_count == 1
    assert audio.read_bytes() == b"x"


def test_ffmpeg_failure_keeps_the_original(tmp_path):
    audio = tmp_path / "audio.mp3"
    audio.write_bytes(b"x")
    with patch.object(
        audio_trim.subprocess, "run", side_effect=subprocess.CalledProcessError(1, ["ffmpeg"])
    ), patch.object(audio_trim, "_duration", return_value=7.0):
        assert audio_trim.trim_trailing_silence(str(audio)) is None
    assert audio.read_bytes() == b"x"


def test_tts_audio_is_trimmed_before_its_length_is_used():
    # Wiring: generate_audio cuts the TTS file right after synthesis.
    import inspect

    from app.services import task

    source = inspect.getsource(task.generate_audio)
    assert source.index("audio_trim.trim_trailing_silence(audio_file)") < source.index(
        "audio_duration = math.ceil(voice.get_audio_duration(sub_maker))"
    )


def _fake_cut(tmp_path, calls):
    def run(cmd, **kwargs):
        calls.append(cmd)
        (tmp_path / "audio.trimmed.mp3").write_bytes(b"y")
        return subprocess.CompletedProcess(cmd, 0, "", "")

    return run


def test_voice_is_cut_after_the_last_spoken_word(tmp_path):
    audio = tmp_path / "audio.mp3"
    audio.write_bytes(b"x")
    calls = []
    words = [("a", 0.0, 1.0), ("b", 20.0, 28.4)]
    with patch.object(
        audio_trim.subprocess, "run", side_effect=_fake_cut(tmp_path, calls)
    ), patch.object(audio_trim, "_duration", return_value=33.0):
        assert audio_trim.trim_after_last_word(str(audio), words) == (
            28.4 + audio_trim.KEEP_AFTER_WORD_SECONDS
        )
    cut = calls[0]
    assert cut[cut.index("-t") + 1] == "29.000"
    assert audio.read_bytes() == b"y"


def test_the_latest_word_end_wins_whatever_the_order(tmp_path):
    audio = tmp_path / "audio.mp3"
    audio.write_bytes(b"x")
    words = [("b", 20.0, 28.4), ("a", 0.0, 1.0)]
    with patch.object(
        audio_trim.subprocess, "run", side_effect=_fake_cut(tmp_path, [])
    ), patch.object(audio_trim, "_duration", return_value=33.0):
        assert audio_trim.trim_after_last_word(str(audio), words) == 29.0


def test_no_words_means_no_cut_and_no_ffmpeg(tmp_path):
    audio = tmp_path / "audio.mp3"
    audio.write_bytes(b"x")
    with patch.object(audio_trim.subprocess, "run") as run:
        assert audio_trim.trim_after_last_word(str(audio), []) is None
    run.assert_not_called()


def test_a_tail_under_a_second_is_left_alone(tmp_path):
    audio = tmp_path / "audio.mp3"
    audio.write_bytes(b"x")
    with patch.object(audio_trim.subprocess, "run") as run, patch.object(
        audio_trim, "_duration", return_value=29.3
    ):
        assert audio_trim.trim_after_last_word(str(audio), [("b", 20.0, 28.4)]) is None
    run.assert_not_called()


def test_a_failed_word_cut_keeps_the_original(tmp_path):
    audio = tmp_path / "audio.mp3"
    audio.write_bytes(b"x")
    with patch.object(
        audio_trim.subprocess, "run", side_effect=subprocess.CalledProcessError(1, ["ffmpeg"])
    ), patch.object(audio_trim, "_duration", return_value=33.0):
        assert audio_trim.trim_after_last_word(str(audio), [("b", 20.0, 28.4)]) is None
    assert audio.read_bytes() == b"x"


def _logged(action):
    messages = []
    sink = logger.add(messages.append, level="INFO")
    try:
        action()
    finally:
        logger.remove(sink)
    return "".join(messages)


def test_the_word_cut_decision_is_logged_in_seconds(tmp_path):
    audio = tmp_path / "audio.mp3"
    audio.write_bytes(b"x")
    with patch.object(
        audio_trim.subprocess, "run", side_effect=_fake_cut(tmp_path, [])
    ), patch.object(audio_trim, "_duration", return_value=33.0):
        text = _logged(lambda: audio_trim.trim_after_last_word(str(audio), [("b", 20.0, 28.4)]))
    assert "voiceover tail: last word ends at 28.40s of 33.00s" in text


def test_a_silence_scan_that_cuts_nothing_says_why(tmp_path):
    # The v11/v12 renders logged nothing at all when the scan found no silence.
    audio = tmp_path / "audio.mp3"
    audio.write_bytes(b"x")
    quiet_log = subprocess.CompletedProcess([], 0, "", "no silence here")
    with patch.object(audio_trim.subprocess, "run", return_value=quiet_log), patch.object(
        audio_trim, "_duration", return_value=33.0
    ):
        text = _logged(lambda: audio_trim.trim_trailing_silence(str(audio)))
    assert "voiceover tail: no trailing silence in the 33.00s file" in text


@needs_ffmpeg
def test_real_ffmpeg_cuts_after_the_last_word(tmp_path):
    audio = tmp_path / "voice.mp3"
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "sine=f=440:d=10", str(audio)],
        check=True,
    )
    assert audio_trim.trim_after_last_word(str(audio), [("hi", 0.0, 3.0)]) == pytest.approx(3.6)
    assert audio_trim._duration(str(audio)) == pytest.approx(3.6, abs=0.15)


@needs_ffmpeg
def test_real_ffmpeg_cuts_trailing_digital_silence(tmp_path):
    audio = tmp_path / "voice.mp3"
    subprocess.run(
        [
            "ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "sine=f=440:d=3",
            "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono",
            "-filter_complex", "[1]atrim=0:4[s];[0][s]concat=n=2:v=0:a=1", str(audio),
        ],
        check=True,
    )
    assert audio_trim.trim_trailing_silence(str(audio)) == pytest.approx(3.4, abs=0.1)
    assert audio_trim._duration(str(audio)) == pytest.approx(3.4, abs=0.15)


def test_voice_is_cut_after_the_last_word_once_the_subtitle_exists():
    from app.services import task

    source = inspect.getsource(task.start)
    subtitle_step = source.index("subtitle_path = generate_subtitle(")
    word_cut = source.index("audio_trim.trim_after_last_word(")
    assert subtitle_step < word_cut < source.index("_ensure_persona_hook_fits(")
    assert "audio_duration = math.ceil(trimmed_seconds)" in source


def _fake_word_cut(calls):
    """ffmpeg stub that writes the trimmed file next to the input, like _cut."""

    def run(cmd, **kwargs):
        calls.append(cmd)
        input_path = cmd[cmd.index("-i") + 1]
        root, ext = os.path.splitext(input_path)
        with open(f"{root}.trimmed{ext}", "wb") as handle:
            handle.write(b"y")
        return subprocess.CompletedProcess(cmd, 0, "", "")

    return run


def test_a_shared_custom_audio_file_is_never_trimmed_in_place(tmp_path):
    # Regression: a custom audio file from the shared local_videos dir was
    # cut in place by the word-based trim, so reusing it in a later task
    # heard the cut version. The shared file must stay byte-identical
    # while the task-local copy is still trimmed.
    shared_dir = tmp_path / "shared"
    task_dir = tmp_path / "task"
    shared_dir.mkdir()
    task_dir.mkdir()
    shared = shared_dir / "voice.mp3"
    shared.write_bytes(b"x")
    words = [("a", 0.0, 1.0), ("b", 20.0, 28.4)]
    with patch.object(
        audio_trim.subprocess, "run", side_effect=_fake_word_cut([])
    ), patch.object(audio_trim, "_duration", return_value=33.0):
        local = audio_trim.task_local_copy(str(shared), str(task_dir))
        assert local == str(task_dir / "voice.mp3")
        assert (task_dir / "voice.mp3").read_bytes() == b"x"
        assert audio_trim.trim_after_last_word(local, words) == 29.0
    assert shared.read_bytes() == b"x"
    assert (task_dir / "voice.mp3").read_bytes() == b"y"


def test_a_task_local_audio_file_passes_through_unchanged(tmp_path):
    task_dir = tmp_path / "task"
    task_dir.mkdir()
    audio = task_dir / "audio.mp3"
    audio.write_bytes(b"x")
    assert audio_trim.task_local_copy(str(audio), str(task_dir)) == str(audio)
    assert audio.read_bytes() == b"x"


def test_a_task_dir_symlink_to_shared_audio_is_replaced_not_written_through(tmp_path):
    shared_dir = tmp_path / "shared"
    task_dir = tmp_path / "task"
    shared_dir.mkdir()
    task_dir.mkdir()
    shared = shared_dir / "voice.mp3"
    shared.write_bytes(b"x")
    link = task_dir / "voice.mp3"
    link.symlink_to(shared)
    local = audio_trim.task_local_copy(str(link), str(task_dir))
    assert local == str(link)
    assert not link.is_symlink()
    assert link.read_bytes() == b"x"
    assert shared.read_bytes() == b"x"


def test_a_realpath_failure_skips_the_trim(tmp_path):
    # Degrade, don't fail: a realpath OSError (vanished path mid-flight)
    # returns None so the caller skips the trim — returning the original
    # path would cut the shared file in place, the bug this helper fixes.
    shared_dir = tmp_path / "shared"
    task_dir = tmp_path / "task"
    shared_dir.mkdir()
    task_dir.mkdir()
    shared = shared_dir / "voice.mp3"
    shared.write_bytes(b"x")
    with patch.object(audio_trim.os.path, "realpath", side_effect=OSError("vanished")):
        assert audio_trim.task_local_copy(str(shared), str(task_dir)) is None
    assert not (task_dir / "voice.mp3").exists()
    assert shared.read_bytes() == b"x"


def test_a_copy_failure_skips_the_trim(tmp_path):
    # Degrade, don't fail: when the copy into the task dir fails, the
    # caller skips the trim instead of failing the task, and the shared
    # file stays untouched (and untrimmed).
    shared_dir = tmp_path / "shared"
    task_dir = tmp_path / "task"
    shared_dir.mkdir()
    task_dir.mkdir()
    shared = shared_dir / "voice.mp3"
    shared.write_bytes(b"x")
    with patch.object(audio_trim.shutil, "copyfile", side_effect=OSError("read-only task dir")) as copy:
        assert audio_trim.task_local_copy(str(shared), str(task_dir)) is None
    copy.assert_called_once()
    assert not (task_dir / "voice.mp3").exists()
    assert shared.read_bytes() == b"x"


def test_task_start_copies_shared_audio_before_the_word_cut():
    # Pin the task.start wiring: the task-local copy must precede the
    # in-place word cut, or the shared original gets cut (see the
    # task_local_copy tests above). Same source-scan pattern as the
    # word-cut ordering test.
    from app.services import task

    source = inspect.getsource(task.start)
    copy_call = source.index("audio_trim.task_local_copy(")
    word_cut = source.index("audio_trim.trim_after_last_word(")
    assert copy_call < word_cut
    assert "if task_local is not None:" in source


def test_media_duration_probes_any_media_file():
    # place_photos reads clip lengths through it to find the slot of a photo.
    with patch.object(audio_trim, "_duration", return_value=4.5) as probe:
        assert audio_trim.media_duration("clip.mp4") == 4.5
    probe.assert_called_once_with("clip.mp4")
