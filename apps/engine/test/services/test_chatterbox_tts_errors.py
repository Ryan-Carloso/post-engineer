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


def test_response_body_credentials_are_scrubbed(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    # CRITICAL review round: the upstream body goes into the stored error and
    # the log line untouched — a gateway echoing a rejected key, or the
    # caller's own "user:pass@host" base_url, would leak into video_generations
    # and the logs. Both consumer paths share _scrubbed_response_body.
    error = _run_with_responses(
        monkeypatch,
        [(
            500,
            "upstream rejected api_key=sk-real-secret-key-12345 bearer t0k3n "
            "https://user:pw@chatter.internal/v1",
        )] * 3,
        tmp_path,
    )
    assert "sk-real" not in error
    assert "t0k3n" not in error
    assert "user:pw@" not in error
    assert "api_key" in error  # the key NAME survives; the VALUE is redacted
    assert "***:***@chatter.internal" in error
    assert error == error.strip()


def test_scrub_helper_alone_scrubs_credentials_and_cap_at_200() -> None:
    from app.services.voice_providers import _scrubbed_response_body

    body = _scrubbed_response_body("api_key=leakverse-999 auth\nhttps://u:s@x.example/a")
    assert "leakverse-999" not in body
    assert "https://u:s@" not in body
    assert "***:***@x.example" in body
    long = _scrubbed_response_body("x" * 500)
    assert len(long) <= 200


def test_bubbled_exception_log_is_scrubbed(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    # Review nit round 2: the catch-path record carried the raw exception
    # ("chatterbox tts failed: {str(e)}") — a request exception can embed the
    # caller's credential-bearing base_url or an echoed key. The record must
    # carry the same scrubbed text the stored error does.
    import app.services.voice_providers as vp
    from types import SimpleNamespace

    records: list[str] = []
    fake_logger = SimpleNamespace(
        error=lambda msg, *a, **kw: records.append(str(msg)),
        success=lambda msg, *a, **kw: None,
        info=lambda msg, *a, **kw: None,
        bind=lambda **kw: SimpleNamespace(error=lambda msg, **kw: records.append(str(msg))),
    )
    monkeypatch.setattr(vp, "logger", fake_logger)
    config = SimpleNamespace(
        chatterbox={"base_url": "http://tts.test/v1", "api_key": "k", "model_id": "chatterbox"},
    )
    monkeypatch.setattr(vp, "config", config, raising=False)

    def boom(**_kwargs: object) -> None:
        raise RuntimeError("POST https://user:pw@chatter.internal/v1 failed api_key=sk-real")

    monkeypatch.setattr(vp.requests, "post", boom)
    result = vp.chatterbox_tts(
        "hello world",
        "kokoro_am_michael",
        str(tmp_path / "out.mp3"),
    )
    assert "Chatterbox TTS failed after 3 attempts" in (result.error or "")
    assert records, "the failure record must be logged"
    for record in records:
        assert "user:pw@" not in record
        assert "sk-real" not in record


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
