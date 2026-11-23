"""Boot triage must not refund a live Modal call, and must recover a dead one."""

from __future__ import annotations

from typing import Any

import pytest

from app.services import cpu_worker_dispatch as dispatch


def _status(monkeypatch: pytest.MonkeyPatch, outcome: BaseException | None) -> str:
    import modal

    class _Call:
        def get(self, timeout: float | None = None) -> None:
            assert timeout == 0
            if outcome is not None:
                raise outcome

    def from_id(call_id: str) -> Any:
        assert call_id == "fc-status"
        return _Call()

    monkeypatch.setattr(modal.FunctionCall, "from_id", from_id)
    return dispatch.modal_call_status("fc-status")


def test_client_and_transport_errors_stay_running(monkeypatch: pytest.MonkeyPatch) -> None:
    from grpclib.exceptions import StreamTerminatedError
    from modal.exception import AuthError, ConnectionError, InternalError, InternalFailure

    assert _status(monkeypatch, TimeoutError()) == "running"
    assert _status(monkeypatch, ConnectionError("down")) == "running"
    assert _status(monkeypatch, InternalError("5xx")) == "running"
    assert _status(monkeypatch, AuthError("token")) == "running"
    assert _status(monkeypatch, InternalFailure("retry")) == "running"
    assert _status(monkeypatch, StreamTerminatedError()) == "running"


def test_a_finished_call_is_finished(monkeypatch: pytest.MonkeyPatch) -> None:
    from modal.exception import FunctionTimeoutError, NotFoundError, OutputExpiredError, RemoteError

    assert _status(monkeypatch, None) == "finished"
    assert _status(monkeypatch, RuntimeError("render failed")) == "finished"
    assert _status(monkeypatch, FileNotFoundError("reference.wav")) == "finished"
    assert _status(monkeypatch, RemoteError("container")) == "finished"
    assert _status(monkeypatch, FunctionTimeoutError("slow")) == "finished"
    assert _status(monkeypatch, OutputExpiredError("expired")) == "finished"
    assert _status(monkeypatch, NotFoundError("missing")) == "finished"
