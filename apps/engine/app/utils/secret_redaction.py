"""Redact secrets and sensitive URL parameters from log output.

Log lines must never contain API keys, tokens, or signed-URL credentials
(e.g. Pixabay ``key=``, ``token=`` / ``access_token=`` on signed asset URLs).
All helpers are pure and never mutate their input.
"""

import re
from typing import Any
from urllib.parse import parse_qsl, quote, urlsplit, urlunsplit

# Query parameter names whose values must never appear in logs.
SENSITIVE_QUERY_PARAMS = frozenset(
    {
        "key",
        "api_key",
        "apikey",
        "token",
        "access_token",
        "auth_token",
        "id_token",
        "refresh_token",
        "signature",
        "sig",
        "secret",
        "client_secret",
    }
)

_REDACTED = "***"

# Rough matcher for http(s) URLs embedded in free text (log lines).
_URL_RE = re.compile(r"https?://[^\s\"'<>]+")


def redact_url(url: str) -> str:
    """Return *url* with sensitive query-parameter values replaced by ``***``.

    Non-URL strings and URLs without sensitive parameters are returned
    unchanged.
    """
    if not isinstance(url, str) or "://" not in url:
        return url
    try:
        parts = urlsplit(url)
    except ValueError:
        return url
    if not parts.scheme or not parts.netloc:
        return url
    query_pairs = parse_qsl(parts.query, keep_blank_values=True)
    if not any(name.lower() in SENSITIVE_QUERY_PARAMS for name, _ in query_pairs):
        return url
    redacted_pairs = [
        (name, _REDACTED if name.lower() in SENSITIVE_QUERY_PARAMS else value)
        for name, value in query_pairs
    ]
    # Build the query manually so the "***" marker stays human-readable
    # instead of being percent-encoded to %2A%2A%2A.
    redacted_query = "&".join(
        f"{quote(name, safe='')}={quote(value, safe='*')}"
        for name, value in redacted_pairs
    )
    return urlunsplit(
        (parts.scheme, parts.netloc, parts.path, redacted_query, parts.fragment)
    )


def redact_text(text: str) -> str:
    """Redact sensitive query parameters in every URL found in *text*."""
    if not isinstance(text, str):
        return text
    return _URL_RE.sub(lambda match: redact_url(match.group(0)), text)


def redact_value(value: Any) -> Any:
    """Recursively redact sensitive URL parameters and dict keys in nested structures.

    Dicts, lists, tuples and sets are walked; strings are passed through
    :func:`redact_text`; dict keys matching :data:`SENSITIVE_QUERY_PARAMS`
    (case-insensitive) have their value replaced with ``***``; every other
    value is returned as-is. The input is never mutated.
    """
    if isinstance(value, dict):
        return {
            key: (
                _REDACTED
                if isinstance(key, str) and key.lower() in SENSITIVE_QUERY_PARAMS
                else redact_value(item)
            )
            for key, item in value.items()
        }
    if isinstance(value, (list, tuple)):
        return [redact_value(item) for item in value]
    if isinstance(value, (set, frozenset)):
        return {redact_value(item) for item in value}
    if isinstance(value, str):
        return redact_text(value)
    return value
