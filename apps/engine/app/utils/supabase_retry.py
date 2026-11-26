"""Shared ``requests`` session that retries Supabase connect failures.

Both Supabase clients in the engine (the publisher store and the
task-state backend) hit the same PostgREST host from the same tick, so a
transient DNS/connect blip fails both. They share one retry policy here so
the two cannot drift apart.

Why connect-phase failures only: a connect failure happens before the
request reaches Supabase, so retrying it is safe even for the non-idempotent
token RPC POSTs. A read failure can come after Supabase already applied the
POST, so it is never retried.
"""

from __future__ import annotations

from typing import Any

CONNECT_RETRIES = 2
CONNECT_RETRY_BACKOFF_SECONDS = 0.5


def retry_sleep_seconds(count: int = CONNECT_RETRIES) -> float:
    """Total time urllib3 sleeps between attempts under this policy.

    ``backoff_factor * (2 ** 1 + ... + 2 ** (count - 1))``: measured against
    urllib3 2.x, count=2 sleeps 0 then 1.0 (not 0.5) for a 1.0 total.
    """
    return CONNECT_RETRY_BACKOFF_SECONDS * sum(2**k for k in range(1, max(count, 1)))


def worst_case_seconds(connect_timeout: float, read_timeout: float) -> float:
    """Upper bound on one request's wall time under this policy.

    ``count`` retries means ``count + 1`` ATTEMPTS, each able to burn the full
    connect timeout, plus the backoff sleeps: a blackholed network pays that,
    a healthy one is bounded by the single read timeout (read errors are never
    retried, so the read timeout is paid once). Callers that hold a lock across
    a request rely on this staying small.
    """
    return max(
        (CONNECT_RETRIES + 1) * connect_timeout + retry_sleep_seconds(),
        read_timeout,
    )


def connect_retry(count: int = CONNECT_RETRIES) -> Any:
    """``urllib3.Retry`` policy: *count* connect retries, nothing else.

    ``count=0`` is the disarmed policy the scheduler uses for the rest of a
    tick after a stage fails.
    """
    from urllib3.util.retry import Retry

    return Retry(
        total=count,
        connect=count,
        read=False,
        other=0,
        backoff_factor=CONNECT_RETRY_BACKOFF_SECONDS,
    )


def mount_retry_adapter(session: Any, count: int = CONNECT_RETRIES) -> Any:
    """Mount a fresh retry policy for both schemes; return the session.

    Only for session CONSTRUCTION. Changing the budget mid-run must use
    set_retry_budget: mounting a new HTTPAdapter runs HTTPAdapter.__init__,
    which builds a NEW PoolManager and drops every pooled connection.
    """
    from requests.adapters import HTTPAdapter

    adapter = HTTPAdapter(max_retries=connect_retry(count))
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    return session


_MOUNTED_PREFIXES = ("https://", "http://")


def set_retry_budget(session: Any, count: int = CONNECT_RETRIES) -> Any:
    """Re-point the mounted adapters at a new budget, keeping the pool.

    Assigning ``adapter.max_retries`` in place is what preserves the pooled
    connections; re-mounting would replace the adapter and its PoolManager,
    forcing a fresh TCP+TLS handshake on every call after each re-arm.
    """
    for prefix in _MOUNTED_PREFIXES:
        adapter = session.adapters.get(prefix)
        if adapter is None:
            session.mount(prefix, _adapter(count))
            continue
        adapter.max_retries = connect_retry(count)
    return session


def _adapter(count: int) -> Any:
    from requests.adapters import HTTPAdapter

    return HTTPAdapter(max_retries=connect_retry(count))


def build_retrying_session() -> Any:
    """``requests.Session`` retrying connect-phase failures to Supabase.

    Takes no timeout arguments: the callers pass ``timeout`` per request,
    matching how the store and the task-state backend already call. Neither
    value is configured here, so accepting them would imply otherwise.
    """
    import requests

    return mount_retry_adapter(requests.Session(), CONNECT_RETRIES)
