"""failed_before_anything_was_sent classifies a ConnectionError by phase.

Only a connect-phase failure (nothing transmitted) may be retried for a
POST. A failure after transmission means the server may already have the
webhook, so retrying would double-deliver it.
"""

import requests
from urllib3.exceptions import (
    ConnectTimeoutError,
    MaxRetryError,
    NewConnectionError,
    ProtocolError,
    ReadTimeoutError,
)

from app.utils.ssrf_retry import failed_before_anything_was_sent


def _wrapped(reason):
    """ConnectionError shaped like requests raises it around a urllib3 error."""
    return requests.exceptions.ConnectionError(
        MaxRetryError(None, "https://pinned.invalid/hook", reason=reason)
    )


def test_a_refused_connect_is_a_connect_phase_failure():
    assert failed_before_anything_was_sent(
        _wrapped(NewConnectionError(None, "Failed to establish a new connection"))
    )


def test_a_bare_new_connection_error_is_a_connect_phase_failure():
    assert failed_before_anything_was_sent(
        requests.exceptions.ConnectionError(NewConnectionError(None, "refused"))
    )


def test_a_connect_timeout_is_a_connect_phase_failure():
    assert failed_before_anything_was_sent(
        _wrapped(ConnectTimeoutError(None, "https://pinned.invalid/hook", "timed out"))
    )


def test_an_aborted_response_read_is_not_a_connect_phase_failure():
    assert not failed_before_anything_was_sent(
        requests.exceptions.ConnectionError(ProtocolError("Connection aborted."))
    )


def test_a_read_timeout_is_not_a_connect_phase_failure():
    assert not failed_before_anything_was_sent(
        _wrapped(ReadTimeoutError(None, "https://pinned.invalid/hook", "timed out"))
    )


def test_an_error_with_no_urllib3_cause_is_not_a_connect_phase_failure():
    assert not failed_before_anything_was_sent(requests.exceptions.ConnectionError("boom"))
