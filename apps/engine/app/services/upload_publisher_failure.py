"""Discord-safe reason for a 2xx upload response that published nothing.

Extracted from ``app.services.upload_publisher`` so that module stays under
the 500-line file-size cap.
"""

from __future__ import annotations

from typing import Any


def application_failure_reason(result: dict[str, Any]) -> str | None:
    """Discord-safe reason when a 2xx body did not publish anything.

    Returns None when the body is a real success (including a provider
    that posted to at least one account). The reason never includes
    ``error``, ``errorType``, or per-account text: those fields are
    remote-controlled and the reason reaches Discord via the task error.
    """
    if result.get("success") is False:
        return "upload API reported failure"
    accounts = result.get("results")
    if (
        isinstance(accounts, list)
        and len(accounts) > 0
        and all(
            isinstance(account, dict) and account.get("success") is False for account in accounts
        )
    ):
        return "upload API reported failure for every account"
    return None
