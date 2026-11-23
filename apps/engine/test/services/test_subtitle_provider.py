"""build_subtitle: Whisper always times the captions; the TTS estimate is only a fallback."""

import sys
from pathlib import Path
from unittest.mock import patch

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from app.config import config
from app.models.schema import VideoParams
from app.services import subtitle_provider

_SRT = "1\n00:00:00,000 --> 00:00:01,000\nHello world.\n\n"
_CLEANED_SRT = "1\n00:00:00,000 --> 00:00:01,000\nHello world\n\n"


@pytest.fixture
def task_dir(tmp_path):
    with patch.object(subtitle_provider.utils, "task_dir", return_value=str(tmp_path)):
        yield tmp_path


def _params(enabled=True):
    return VideoParams(
        video_title="s",
        video_description="Test description.",
        video_type="voiceover",
        video_script="Hello world.",
        subtitle_enabled=enabled,
    )


def _write(path_arg, content=_SRT):
    def writer(**kwargs):
        Path(kwargs[path_arg]).write_text(content, encoding="utf-8")
        return kwargs[path_arg]

    return writer


def _build(sub_maker, params=None):
    return subtitle_provider.build_subtitle(
        task_id="t",
        params=params or _params(),
        video_script="Hello world.",
        sub_maker=sub_maker,
        audio_file="audio.mp3",
    )


def test_disabled_subtitles_return_empty_and_call_nobody(task_dir):
    with (
        patch.object(subtitle_provider.subtitle, "create") as whisper,
        patch.object(subtitle_provider.voice, "create_subtitle") as estimate,
    ):
        assert _build(object(), _params(enabled=False)) == ""
    assert whisper.call_count == 0
    assert estimate.call_count == 0


def test_whisper_times_the_captions_even_when_a_tts_timeline_exists(task_dir):
    with (
        patch.object(
            subtitle_provider.subtitle, "create", side_effect=_write("subtitle_file")
        ) as create,
        patch.object(subtitle_provider.subtitle, "correct") as correct,
        patch.object(subtitle_provider.voice, "create_subtitle") as estimate,
    ):
        result = _build(object())
    assert result == str(task_dir / "subtitle.srt")
    assert create.call_count == 1
    create.assert_called_once_with(audio_file="audio.mp3", subtitle_file=result)
    assert correct.call_count == 1
    correct.assert_called_once_with(subtitle_file=result, video_script="Hello world.")
    assert estimate.call_count == 0
    assert Path(result).read_text(encoding="utf-8") == _CLEANED_SRT


def test_the_provider_setting_no_longer_selects_the_tts_estimate(task_dir):
    with (
        patch.object(subtitle_provider.subtitle, "create", side_effect=_write("subtitle_file")) as create,
        patch.object(subtitle_provider.subtitle, "correct"),
        patch.object(subtitle_provider.voice, "create_subtitle") as estimate,
        patch.dict(config.app, {"subtitle_provider": "edge"}),
    ):
        _build(object())
    assert create.call_count == 1
    assert estimate.call_count == 0


def test_whisper_without_a_file_falls_back_to_the_estimate_and_logs_an_error(task_dir):
    with (
        patch.object(subtitle_provider.subtitle, "create", return_value=""),
        patch.object(subtitle_provider.subtitle, "correct") as correct,
        patch.object(
            subtitle_provider.voice, "create_subtitle", side_effect=_write("subtitle_file")
        ) as estimate,
        patch.object(subtitle_provider.logger, "error") as log_error,
    ):
        result = _build(object())
    assert result == str(task_dir / "subtitle.srt")
    assert estimate.call_count == 1
    assert correct.call_count == 0
    assert Path(result).read_text(encoding="utf-8") == _CLEANED_SRT
    log_error.assert_any_call("whisper wrote no subtitle file")
    log_error.assert_any_call(
        "whisper produced no subtitle; falling back to the estimated TTS timeline"
    )


def test_whisper_model_load_failure_is_logged_and_falls_back_to_the_estimate(task_dir):
    with (
        patch.object(subtitle_provider.subtitle, "create", return_value=None),
        patch.object(subtitle_provider.subtitle, "correct") as correct,
        patch.object(
            subtitle_provider.voice, "create_subtitle", side_effect=_write("subtitle_file")
        ) as estimate,
        patch.object(subtitle_provider.logger, "error") as log_error,
    ):
        result = _build(object())
    assert result == str(task_dir / "subtitle.srt")
    assert estimate.call_count == 1
    assert correct.call_count == 0
    log_error.assert_any_call("whisper model could not load; see the failed to load model error")
    assert "whisper wrote no subtitle file" not in [call.args[0] for call in log_error.call_args_list]


def test_whisper_raising_falls_back_to_the_estimate_and_logs_an_error(task_dir):
    with (
        patch.object(
            subtitle_provider.subtitle, "create", side_effect=RuntimeError("model load failed")
        ),
        patch.object(
            subtitle_provider.voice, "create_subtitle", side_effect=_write("subtitle_file")
        ) as estimate,
        patch.object(subtitle_provider.logger, "error") as log_error,
    ):
        result = _build(object())
    assert result == str(task_dir / "subtitle.srt")
    assert estimate.call_count == 1
    assert Path(result).read_text(encoding="utf-8") == _CLEANED_SRT
    log_error.assert_any_call("whisper subtitle failed: RuntimeError: model load failed")


def test_whisper_correction_failure_falls_back_to_the_estimate(task_dir):
    with (
        patch.object(subtitle_provider.subtitle, "create", side_effect=_write("subtitle_file")),
        patch.object(
            subtitle_provider.subtitle, "correct", side_effect=RuntimeError("align failed")
        ),
        patch.object(
            subtitle_provider.voice, "create_subtitle", side_effect=_write("subtitle_file")
        ) as estimate,
        patch.object(subtitle_provider.logger, "error") as log_error,
    ):
        result = _build(object())
    assert result == str(task_dir / "subtitle.srt")
    assert estimate.call_count == 1
    assert Path(result).read_text(encoding="utf-8") == _CLEANED_SRT
    log_error.assert_any_call("whisper subtitle failed: RuntimeError: align failed")


def test_estimate_without_cues_returns_empty(task_dir):
    with (
        patch.object(subtitle_provider.subtitle, "create", return_value=None),
        patch.object(
            subtitle_provider.voice, "create_subtitle", side_effect=_write("subtitle_file", "")
        ) as estimate,
        patch.object(subtitle_provider.logger, "error") as log_error,
    ):
        result = _build(object())
    assert result == ""
    assert estimate.call_count == 1
    log_error.assert_any_call(
        "no subtitle cues: whisper failed and no TTS timeline could replace it"
    )


def test_whisper_with_an_empty_file_falls_back_to_the_estimate(task_dir):
    with (
        patch.object(subtitle_provider.subtitle, "create", side_effect=_write("subtitle_file", "")),
        patch.object(subtitle_provider.subtitle, "correct"),
        patch.object(
            subtitle_provider.voice, "create_subtitle", side_effect=_write("subtitle_file")
        ) as estimate,
    ):
        result = _build(object())
    assert result == str(task_dir / "subtitle.srt")
    assert estimate.call_count == 1
    assert Path(result).read_text(encoding="utf-8") == _CLEANED_SRT


def test_whisper_failing_with_custom_audio_has_no_estimate_fallback(task_dir):
    with (
        patch.object(subtitle_provider.subtitle, "create", return_value=None),
        patch.object(subtitle_provider.voice, "create_subtitle") as estimate,
        patch.object(subtitle_provider.logger, "error") as log_error,
    ):
        result = _build(None)
    assert result == ""
    assert estimate.call_count == 0
    log_error.assert_any_call(
        "no subtitle cues: whisper failed and no TTS timeline could replace it"
    )


def test_both_failing_returns_empty_and_logs_an_error(task_dir):
    with (
        patch.object(subtitle_provider.subtitle, "create", return_value=None),
        patch.object(subtitle_provider.voice, "create_subtitle"),
        patch.object(subtitle_provider.logger, "error") as log_error,
    ):
        assert _build(object()) == ""
    log_error.assert_any_call(
        "no subtitle cues: whisper failed and no TTS timeline could replace it"
    )


def test_whisper_subtitles_are_cleaned_of_punctuation(task_dir):
    dirty_srt = (
        "1\n00:00:00,000 --> 00:00:01,000\nHello, world - wait?\n\n"
        "2\n00:00:01,000 --> 00:00:02,000\nEspera...\n\n"
    )
    with (
        patch.object(
            subtitle_provider.subtitle, "create", side_effect=_write("subtitle_file", dirty_srt)
        ),
        patch.object(subtitle_provider.subtitle, "correct"),
    ):
        result = _build(object())
    assert Path(result).read_text(encoding="utf-8") == (
        "1\n00:00:00,000 --> 00:00:01,000\nHello world wait?\n\n"
        "2\n00:00:01,000 --> 00:00:02,000\nEspera\n\n"
    )


def test_cleanup_failure_ships_no_subtitles(task_dir):
    with (
        patch.object(subtitle_provider.subtitle, "create", side_effect=_write("subtitle_file")),
        patch.object(subtitle_provider.subtitle, "correct"),
        patch.object(subtitle_provider.subtitle_cleanup, "clean_subtitle_file", return_value=False),
        patch.object(subtitle_provider.logger, "error") as log_error,
    ):
        result = _build(object())
    assert result == ""
    log_error.assert_any_call("subtitle cleanup failed; shipping no subtitles")
