"""Idle unload of the Chatterbox Nano model in the local TTS server (no models)."""

import pytest

from local_tts import backends


@pytest.fixture(autouse=True)
def _reset_models(monkeypatch):
    monkeypatch.setattr(backends, "_models", {})
    monkeypatch.setattr(backends, "_nano_last_used", None)
    monkeypatch.setattr(backends, "_release_freed_memory", lambda: None)


def test_keeps_nano_while_recently_used(monkeypatch):
    backends._models["nano"] = object()
    monkeypatch.setattr(backends, "_nano_last_used", 1000.0)

    assert backends.unload_idle_nano(now=lambda: 1000.0 + 299, idle_seconds=300) is False
    assert "nano" in backends._models


def test_unloads_nano_after_idle_window(monkeypatch):
    backends._models["nano"] = object()
    backends._models["phonon"] = object()
    monkeypatch.setattr(backends, "_nano_last_used", 1000.0)

    assert backends.unload_idle_nano(now=lambda: 1000.0 + 300, idle_seconds=300) is True
    assert backends.loaded_models() == ["phonon"]
    assert backends._nano_last_used is None


def test_noop_when_nano_never_loaded():
    backends._models["kokoro_a"] = object()
    assert backends.unload_idle_nano(now=lambda: 10_000.0, idle_seconds=0) is False
    assert backends.loaded_models() == ["kokoro_a"]


def test_clone_marks_last_use_even_when_generation_fails(monkeypatch):
    def boom(_text, _ref):
        raise RuntimeError("generation failed")

    monkeypatch.setattr(backends, "_synth_nano", boom)
    monkeypatch.setattr(backends.time, "monotonic", lambda: 42.0)
    with pytest.raises(RuntimeError):
        backends.synthesize_clone(None, "hi")
    assert backends._nano_last_used == 42.0


def test_default_idle_window_is_five_minutes():
    assert backends.NANO_IDLE_SECONDS == 300
