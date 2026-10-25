"""Unit tests for chatterbox_tts failure reporting (voice_providers.py)."""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from app.services import voice_providers
from app.services.voice_providers import chatterbox_tts


class _Response:
    def __init__(self, status: int, text: str) -> None:
        self.status_code = status
        self.text = text


def _run_with_responses(
    monkeypatch: pytest.MonkeyPatch,
    statuses: list[tuple[int, str]],
    tmp_path: Path,
) -> str:
    """Run chatterbox_tts against fake POST responses; returns the stored error."""
    config = SimpleNamespace(
        chatterbox={"base_url": "http://tts.test/v1", "api_key": "k", "model_id": "chatterbox"},
    )
    monkeypatch.setattr(voice_providers, "config", config, raising=False)

    responses = iter(statuses)

    def fake_post(url: str, **_kwargs: Any) -> _Response:
        status, text = next(responses)
        return _Response(status, text)

    monkeypatch.setattr(voice_providers.requests, "post", fake_post)

    result = chatterbox_tts(
        "hello world",
        "kokoro_am_michael",
        str(tmp_path / "out.mp3"),
    )
    return result.error or ""


def test_non_200_body_is_included_in_the_error(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    # Production evidence (2026-10): the bare "status 404" hid that a Modal
    # gateway answered ("modal-http: workspace ... is disabled") — days of
    # debugging would have been saved by surfacing the server's verdict in
    # the stored error_message.
    error = _run_with_responses(
        monkeypatch,
        [(404, "modal-http: workspace ac-X is disabled\n")] * 3,
        tmp_path,
    )
    assert error == (
        "Chatterbox TTS failed after 3 attempts (status 404: modal-http: workspace ac-X is disabled)"
    )


def test_blank_body_keeps_the_bare_status(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    error = _run_with_responses(monkeypatch, [(503, "")] * 3, tmp_path)
    assert error == "Chatterbox TTS failed after 3 attempts (status 503)"


def test_body_is_squeezed_to_one_line(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    error = _run_with_responses(monkeypatch, [(400, "bad\n  request ")] * 3, tmp_path)
    assert error == (
        "Chatterbox TTS failed after 3 attempts (status 400: bad request)"
    )
