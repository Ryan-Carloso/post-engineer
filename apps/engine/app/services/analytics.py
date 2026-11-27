"""PostHog product-analytics for the engine.

Tracks the publish funnel as PostHog events:
- video_publish_started / video_published / video_publish_failed
- video_publish_partial_failure (some providers published, others failed)

Safety rules:
- Never raises: telemetry must never break publishing.
- No-op when POSTHOG_API_KEY is missing (warns once).
- Secret-bearing property keys are redacted before capture.
- Never log PII, credentials, or raw request bodies in properties.
- Configuration comes from environment variables only — never hardcode.

Deliberate exception (user-requested, PR #228): the publish_provider_failed
event carries response_body, up to 500 chars of the upstream provider's
error response, so publish failures are diagnosable in PostHog from the
publisher publish path. It is scrubbed with
scrub_error_text (secrets + machine-local paths) before capture and never
reaches Discord or the task error string.

Historical exception (PR #250, removed in Phase 5 PR 1): the
script_angle_generated event carried angle, LLM output derived from the
user's own topic and already persisted as product data on the task
record. The script angle was removed with LLM script generation, so no
new event carries model output; the scrubber itself stays in use
elsewhere.
"""

from __future__ import annotations

import logging
import os
import re
import tempfile
from typing import Any

logger = logging.getLogger(__name__)

_SECRET_KEY_PATTERN = re.compile(
    r"password|passwd|secret|token|authorization|auth\b|api[-_]?key|"
    r"bearer|credential|private[-_]?key|session",
    re.IGNORECASE,
)

_SECRET_VALUE_PATTERN = re.compile(
    r"(password|passwd|secret|token|api[-_]?key|credential|private[-_]?key|session)[\"']?\s*[:=]\s*[\"']?([^\s,;\"']+)"
    r"|(bearer)\s+([^\s,;\"']+)"
    r"|\b(sk-(?:or-v1-)?[A-Za-z0-9_-]{20,})",
    re.IGNORECASE,
)

_REDACTED = "[redacted]"


def scrub_secret_values(text: str) -> str:
    """Redact secret values from free-text strings (exception messages, stacktraces)."""
    def _replace(m: re.Match[str]) -> str:
        key = m.group(1) or m.group(3)
        if key is None:
            return _REDACTED
        sep = "=" if m.group(1) else " "
        return f"{key}{sep}{_REDACTED}"
    return _SECRET_VALUE_PATTERN.sub(_replace, text)


_HOME_PLACEHOLDER = "<home>"
_STORAGE_PLACEHOLDER = "<storage>"
_PATH_PLACEHOLDER = "<path>"

_ABSOLUTE_PATH_PATTERN = re.compile(r"(?<![\w:/<>])(?:/[\w.\-~]+)+")

_TRUNCATION_MARKER = "\n…\n"


def _replace_local_roots(text: str) -> str:
    """Swap machine-specific path roots for placeholders.

    The home directory becomes <home> and the local working-files root
    (tempfile.gettempdir()) becomes <storage>; subdirectories under them
    collapse to just the file name. Any other absolute path (e.g. from a
    Modal worker's filesystem) becomes <path>/basename, so no machine
    layout from any host reaches analytics.
    """
    roots: list[tuple[str, str]] = []
    home = os.path.expanduser("~")
    if home and home != "/":
        roots.append((home, _HOME_PLACEHOLDER))
    storage = tempfile.gettempdir()
    if storage and storage != "/" and storage != home:
        roots.append((storage, _STORAGE_PLACEHOLDER))
    for root, placeholder in sorted(roots, key=lambda item: -len(item[0])):
        text = text.replace(root, placeholder)
    text = re.sub(
        r"(<home>|<storage>)(?:/[^\s\"'/<>]+)+/([^\s\"'/<>]+)",
        r"\1/\2",
        text,
    )
    return _ABSOLUTE_PATH_PATTERN.sub(
        lambda m: f"{_PATH_PLACEHOLDER}/{m.group(0).rsplit('/', 1)[-1]}",
        text,
    )


def scrub_error_text(text: str, max_chars: int = 500) -> str:
    """Prepare free-text error output for analytics properties.

    Applies the existing secret scrubbing, replaces machine-local paths
    with placeholders (keeping only the file name), and — for multi-line
    tool output — keeps the first line (what failed) plus the LAST
    max_chars characters (the diagnostic detail) instead of the first
    max_chars characters (usually banner noise). Short single-line errors
    are returned unchanged.
    """
    if not text:
        return ""
    cleaned = _replace_local_roots(scrub_secret_values(text))
    if len(cleaned) <= max_chars:
        return cleaned
    first_line = cleaned.split("\n", 1)[0]
    tail_budget = max_chars - len(first_line) - len(_TRUNCATION_MARKER)
    if tail_budget <= 0:
        return cleaned[-max_chars:]
    return first_line + _TRUNCATION_MARKER + cleaned[-tail_budget:]

DEFAULT_POSTHOG_HOST = "https://eu.i.posthog.com"

_client: Any = None
_warned = False
_attempted = False


def _get_environment() -> str:
    """Deployment tag for PostHog: 'production' only when APP_ENV says so.

    The engine has no NODE_ENV convention (that belongs to the web/MCP);
    APP_ENV=production is set in the committed docker-compose.yml used by
    the VPS deploy. Unset anywhere else (local dev, CI) means 'development'.
    """
    return "production" if os.environ.get("APP_ENV") == "production" else "development"


_REDACT_EXEMPT_KEYS = frozenset(
    {"prompt_tokens", "completion_tokens", "total_tokens"}
)


def _scrub_secrets(properties: dict[str, Any]) -> dict[str, Any]:
    scrubbed: dict[str, Any] = {}
    for key, value in properties.items():
        if (
            key in _REDACT_EXEMPT_KEYS
            and isinstance(value, int)
            and not isinstance(value, bool)
        ):
            scrubbed[key] = value
        else:
            scrubbed[key] = _REDACTED if _SECRET_KEY_PATTERN.search(key) else value
    return scrubbed


def _get_client() -> Any:
    global _client, _warned, _attempted
    if _client is not None:
        return _client
    if _attempted:
        return None
    _attempted = True

    api_key = os.environ.get("POSTHOG_API_KEY")
    if not api_key:
        if not _warned:
            _warned = True
            logger.warning("POSTHOG_API_KEY not set — engine analytics disabled")
        return None

    try:
        from posthog import Posthog

        host = os.environ.get("POSTHOG_HOST", DEFAULT_POSTHOG_HOST)
        _client = Posthog(api_key, host=host)
        return _client
    except Exception as exc:
        if not _warned:
            _warned = True
            logger.warning("PostHog init failed — engine analytics disabled: %s", exc)
        return None


def warm_client() -> None:
    """Construct the PostHog client now (idempotent, never raises).

    The first ``track_event`` in a process pays the ``posthog`` import plus
    client construction. The ``on_accepted`` funnel callback runs under the
    task-manager lock, so call this once at server startup (asgi
    startup_event) to keep the lock hold short. With no API key it is a
    no-op (warn-once inside).
    """
    _get_client()


def _resolve_distinct_id(properties: dict[str, Any]) -> str:
    """Attribute the event to the real user when known so PostHog breaks
    the funnel down per person; the engine pseudo-person is only the
    fallback for events without a user (e.g. background jobs)."""
    raw_user_id = properties.get("user_id")
    return (
        raw_user_id
        if isinstance(raw_user_id, str)
        and raw_user_id
        and raw_user_id != "unknown"
        else "post-engineer-engine"
    )


def track_event(
    event_name: str,
    properties: dict[str, Any] | None = None,
    immediate: bool = False,
) -> None:
    """Track a product-analytics event.

    event_name should be snake_case. properties carries safe context only:
    ids, counts, validated enums — never credentials or raw bodies.
    Set immediate=True to flush right after capture: the client batches by
    default, so a lone event (e.g. a publish failure with nothing after it)
    would otherwise sit in the queue. Leave False on hot paths — flush()
    blocks until the queue drains.
    """
    try:
        client = _get_client()
        if client is None:
            return
        props = _scrub_secrets(dict(properties or {}))
        props["source"] = "engine"
        props["environment"] = _get_environment()
        distinct_id = _resolve_distinct_id(properties or {})
        client.capture(
            distinct_id=distinct_id,
            event=event_name,
            properties=props,
        )
        if immediate:
            client.flush()
    except Exception as exc:
        logger.warning("PostHog capture failed for %s: %s", event_name, type(exc).__name__)


def nonempty_error_reason(text: str, fallback: str, max_chars: int = 200) -> str:
    """Scrubbed failure why, never empty: empty text falls back to type name."""
    cleaned = scrub_error_text(text, max_chars=max_chars).strip()
    if cleaned:
        return cleaned
    fallback_clean = scrub_error_text(fallback, max_chars=max_chars).strip()
    return fallback_clean or "Error"


def reset_for_testing() -> None:
    """Reset cached client between tests. Not used in production."""
    global _client, _warned, _attempted
    _client = None
    _warned = False
    _attempted = False
