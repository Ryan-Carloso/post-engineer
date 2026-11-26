"""Best-effort display names for owner-alert emails.

Provider labels come from ``app.providers`` (PROVIDER_LABELS, the same as
``apps/web/lib/account-options.ts``, pinned by ``test_owner_alert_lookups.py``). Account and persona names come
from Supabase over the same service-role REST the claim uses. Every failure
degrades to the raw id or label, never to an exception, and no HTTP happens
under the engine test suite unless the caller injects a session.
"""

from __future__ import annotations

import os
from typing import Any

from loguru import logger

from app.providers import PROVIDER_LABELS
from app.services.notify import running_under_test

TIMEOUT_SECONDS = 10



def provider_label(provider: str) -> str:
    return PROVIDER_LABELS.get(provider, provider)


def supabase_rest() -> tuple[str, dict[str, str]] | None:
    base = os.getenv("SUPABASE_URL", "").strip().rstrip("/")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    if not base or not key:
        logger.warning("owner alert skipped: supabase is not configured")
        return None
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    return base, headers


def _rest_session(session: Any) -> tuple[Any, bool]:
    """Session for a lookup: the injected one, or a fresh one in production.

    Under the test suite without an injected session this returns
    ``(None, False)`` so no HTTP happens — same rule as the sender.
    """
    if session is None and running_under_test():
        return None, False
    if session is not None:
        return session, False
    import requests

    return requests.Session(), True


def _get(session: Any, url: str, headers: dict[str, str], params: dict[str, str]) -> Any:
    response = session.request(
        "GET", url, headers=headers, params=params, timeout=TIMEOUT_SECONDS
    )
    if response.status_code >= 400:
        logger.warning(f"owner alert lookup status {response.status_code}")
        return None
    return response.json()


def lookup_account_names(
    session: Any, user_id: str
) -> dict[tuple[str, str], str]:
    """Map (provider, provider_account_id) to the account display name."""
    if not user_id:
        return {}
    rest, own = _rest_session(session)
    if rest is None:
        return {}
    try:
        supabase = supabase_rest()
        if supabase is None:
            return {}
        base, headers = supabase
        rows = _get(
            rest,
            f"{base}/rest/v1/social_accounts",
            headers,
            {
                "select": "provider,provider_account_id,account_name",
                "user_id": f"eq.{user_id}",
            },
        )
        if not isinstance(rows, list):
            return {}
        names: dict[tuple[str, str], str] = {}
        for row in rows:
            if not isinstance(row, dict):
                continue
            provider = row.get("provider")
            account = row.get("provider_account_id")
            name = row.get("account_name")
            if (
                isinstance(provider, str)
                and isinstance(account, str)
                and isinstance(name, str)
                and name.strip()
            ):
                names[(provider, account)] = name.strip()
        return names
    except Exception as exc:
        logger.warning(f"owner alert account lookup failed: {type(exc).__name__}")
        return {}
    finally:
        if own:
            rest.close()
