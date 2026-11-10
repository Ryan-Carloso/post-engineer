"""build_subtitle: provider choice and the fallbacks between providers."""

import sys
from pathlib import Path
from unittest.mock import patch

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from app.models.schema import VideoParams
from app.services import subtitle_provider

_SRT = "1\n00:00:00,000 --> 00:00:01,000\nHello world.\n\n"


@pytest.fixture
def task_dir(tmp_path):
    with patch.object(subtitle_provider.utils, "task_dir", return_value=str(tmp_path)):
        yield tmp_path


def _params(enabled=True):
    return VideoParams(video_subject="s", video_script="Hello world.", subtitle_enabled=enabled)


def _write(path_arg):
    def writer(**kwargs):
        Path(kwargs[path_arg]).write_text(_SRT, encoding="utf-8")

    return writer


def _build(provider, sub_maker, params=None):
    with patch.object(subtitle_provider.config, "app", {"subtitle_provider": provider}):
        return subtitle_provider.build_subtitle(
            task_id="t",
            params=params or _params(),
            video_script="Hello world.",
            sub_maker=sub_maker,
            audio_file="audio.mp3",
        )


def test_disabled_subtitles_return_empty_and_call_nobody(task_dir):
    with patch.object(subtitle_provider.subtitle, "create") as whisper, patch.object(
        subtitle_provider.voice, "create_subtitle"
    ) as edge:
        assert _build("whisper", object(), _params(enabled=False)) == ""
    whisper.assert_not_called()
    edge.assert_not_called()


def test_whisper_success_creates_then_corrects(task_dir):
    with patch.object(
        subtitle_provider.subtitle, "create", side_effect=_write("subtitle_file")
    ) as create, patch.object(subtitle_provider.subtitle, "correct") as correct, patch.object(
        subtitle_provider.voice, "create_subtitle"
    ) as edge:
        result = _build("whisper", object())
    assert result == str(task_dir / "subtitle.srt")
    create.assert_called_once_with(audio_file="audio.mp3", subtitle_file=result)
    correct.assert_called_once_with(subtitle_file=result, video_script="Hello world.")
    edge.assert_not_called()


def test_whisper_without_a_file_falls_back_to_edge_and_logs_an_error(task_dir):
    with patch.object(subtitle_provider.subtitle, "create", return_value=None), patch.object(
        subtitle_provider.subtitle, "correct"
    ) as correct, patch.object(
        subtitle_provider.voice, "create_subtitle", side_effect=_write("subtitle_file")
    ) as edge, patch.object(subtitle_provider.logger, "error") as log_error:
        result = _build("whisper", object())
    assert result == str(task_dir / "subtitle.srt")
    edge.assert_called_once()
    correct.assert_not_called()
    assert log_error.called


def test_whisper_raising_falls_back_to_edge_and_logs_an_error(task_dir):
    with patch.object(
        subtitle_provider.subtitle, "create", side_effect=RuntimeError("model load failed")
    ), patch.object(
        subtitle_provider.voice, "create_subtitle", side_effect=_write("subtitle_file")
    ) as edge, patch.object(subtitle_provider.logger, "error") as log_error:
        result = _build("whisper", object())
    assert result == str(task_dir / "subtitle.srt")
    edge.assert_called_once()
    assert log_error.called


def test_whisper_failing_with_custom_audio_has_no_edge_fallback(task_dir):
    # No TTS timeline exists for custom audio, so there is nothing to fall back to.
    with patch.object(subtitle_provider.subtitle, "create", return_value=None), patch.object(
        subtitle_provider.voice, "create_subtitle"
    ) as edge, patch.object(subtitle_provider.logger, "error") as log_error:
        result = _build("whisper", None)
    assert result == ""
    edge.assert_not_called()
    assert log_error.called


def test_both_providers_failing_returns_empty_and_logs_an_error(task_dir):
    with patch.object(subtitle_provider.subtitle, "create", return_value=None), patch.object(
        subtitle_provider.voice, "create_subtitle"
    ), patch.object(subtitle_provider.logger, "error") as log_error:
        assert _build("whisper", object()) == ""
    assert log_error.called


def test_edge_success_does_not_touch_whisper(task_dir):
    with patch.object(
        subtitle_provider.voice, "create_subtitle", side_effect=_write("subtitle_file")
    ) as edge, patch.object(subtitle_provider.subtitle, "create") as whisper:
        result = _build("edge", object())
    assert result == str(task_dir / "subtitle.srt")
    edge.assert_called_once()
    whisper.assert_not_called()


def test_edge_without_a_file_falls_back_to_whisper(task_dir):
    with patch.object(subtitle_provider.voice, "create_subtitle"), patch.object(
        subtitle_provider.subtitle, "create", side_effect=_write("subtitle_file")
    ) as whisper, patch.object(subtitle_provider.subtitle, "correct"):
        result = _build("edge", object())
    assert result == str(task_dir / "subtitle.srt")
    whisper.assert_called_once()


def test_edge_with_custom_audio_is_skipped(task_dir):
    with patch.object(subtitle_provider.voice, "create_subtitle") as edge, patch.object(
        subtitle_provider.subtitle, "create"
    ) as whisper:
        assert _build("edge", None) == ""
    edge.assert_not_called()
    whisper.assert_not_called()


def test_an_empty_provider_generates_nothing(task_dir):
    with patch.object(subtitle_provider.voice, "create_subtitle") as edge, patch.object(
        subtitle_provider.subtitle, "create"
    ) as whisper:
        assert _build("", object()) == ""
    edge.assert_not_called()
    whisper.assert_not_called()
