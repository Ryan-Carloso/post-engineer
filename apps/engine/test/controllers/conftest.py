"""Test fixture for controller tests that exercise the API.

Auth is established via the shared API secret sent as
``Authorization: Bearer`` plus the ``x-user-id`` header — same contract the
web proxy uses in production.
"""

import pytest


@pytest.fixture
def auth_headers(monkeypatch: pytest.MonkeyPatch) -> dict[str, str]:
    monkeypatch.setenv("MONEYPRINT_API_SECRET", "test-shared-secret")
    return {
        "authorization": "Bearer test-shared-secret",
        "x-user-id": "test-user",
    }
