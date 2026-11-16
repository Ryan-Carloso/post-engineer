"""Unit tests for subtitle.transcribe_text (issue #539).

The post-TTS validation transcribes the synthesized narration with the
same faster-whisper model the subtitle path already uses. These tests
pin the plain-text transcription helper: it shares the subtitle
model (and its load) instead of building a second one, and it returns
None — never raises — when transcription is unavailable, so the caller
can decide whether to ship, retry, or fail.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest

from app.services import subtitle


class _FakeSegments:
    """Fake faster-whisper transcription result."""

    def __init__(self, texts: list[str]) -> None:
        self._texts = texts

    def __iter__(self):  # type: ignore[no-untyped-def]
        return iter(SimpleNamespace(text=text) for text in self._texts)


class _FakeModel:
    """Fake WhisperModel returning fixed segments."""

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        pass

    def transcribe(self, audio_file: str, **kwargs: Any):  # type: ignore[no-untyped-def]
        info = SimpleNamespace(language="en", language_probability=0.99)
        return _FakeSegments(["hello ", "world"]), info


class _FailingModel:
    """Fake WhisperModel that fails to load."""

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        raise RuntimeError("could not load model")


def _install_fake_model(monkeypatch: pytest.MonkeyPatch, model_cls: Any) -> None:
    monkeypatch.setattr(subtitle, "WhisperModel", model_cls)
    monkeypatch.setattr(subtitle, "model", None)


def test_transcribe_text_joins_segments(monkeypatch: pytest.MonkeyPatch) -> None:
    _install_fake_model(monkeypatch, _FakeModel)
    assert subtitle.transcribe_text("/tmp/audio.mp3") == "hello world"


def test_transcribe_text_returns_none_when_library_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(subtitle, "WhisperModel", None)
    monkeypatch.setattr(subtitle, "model", None)
    assert subtitle.transcribe_text("/tmp/audio.mp3") is None


def test_transcribe_text_returns_none_when_model_fails_to_load(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _install_fake_model(monkeypatch, _FailingModel)
    assert subtitle.transcribe_text("/tmp/audio.mp3") is None


def test_transcribe_text_returns_none_when_transcribe_raises(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class _ExplodingModel(_FakeModel):
        def transcribe(self, audio_file: str, **kwargs: Any):  # type: ignore[no-untyped-def]
            raise RuntimeError("transcription crashed")

    _install_fake_model(monkeypatch, _ExplodingModel)
    assert subtitle.transcribe_text("/tmp/audio.mp3") is None


def test_transcribe_text_returns_none_when_generator_raises_mid_iteration(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """faster-whisper transcribe() returns a lazy segment generator: the
    inference runs while it is consumed, so a failure mid-stream must also
    yield None instead of raising out of this helper (OpenCode review)."""

    def _raising_segments():  # type: ignore[no-untyped-def]
        yield SimpleNamespace(text="hello ")
        raise RuntimeError("inference crashed mid-stream")

    class _LazyFailingModel(_FakeModel):
        def transcribe(self, audio_file: str, **kwargs: Any):  # type: ignore[no-untyped-def]
            info = SimpleNamespace(language="en", language_probability=0.99)
            return _raising_segments(), info

    _install_fake_model(monkeypatch, _LazyFailingModel)
    assert subtitle.transcribe_text("/tmp/audio.mp3") is None


def test_transcribe_text_reuses_the_loaded_model(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The subtitle path and the validation share one model load."""
    created: list[_FakeModel] = []

    class _CountingModel(_FakeModel):
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            super().__init__(*args, **kwargs)
            created.append(self)

    _install_fake_model(monkeypatch, _CountingModel)
    assert subtitle.transcribe_text("/tmp/audio.mp3") == "hello world"
    assert subtitle.transcribe_text("/tmp/audio.mp3") == "hello world"
    assert len(created) == 1


def test_create_still_returns_empty_when_library_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The model-load refactor must not change create()'s contract."""
    monkeypatch.setattr(subtitle, "WhisperModel", None)
    monkeypatch.setattr(subtitle, "model", None)
    assert subtitle.create("/tmp/audio.mp3", "/tmp/sub.srt") == ""
