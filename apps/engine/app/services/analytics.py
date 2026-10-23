"""PostHog product-analytics for the engine.

Tracks the video lifecycle funnel as PostHog events:
- video_generation_requested (funnel entry, before the pipeline starts)
- video_generation_started / video_generation_failed / video_generated
- video_generation_progress (50% and 70% milestones only)
- video_publish_started / video_published / video_publish_failed
- video_publish_partial_failure (some providers published, others failed)

Safety rules:
- Never raises: telemetry must never break video generation.
- No-op when POSTHOG_API_KEY is missing (warns once).
- Secret-bearing property keys are redacted before capture.
- Never log PII, credentials, or raw request bodies in properties.
- Configuration comes from environment variables only — never hardcode.

Deliberate exception (user-requested, 2026-10-01): the ai_request event
carries response_preview, up to 500 chars of truncated model output, so
LLM responses stay debuggable in PostHog. It is scrubbed of
credential-shaped fragments (scrub_secret_values) before capture and is
not a raw request body — prompts are never sent.

Deliberate exception (user-requested, PR #228): the publish_provider_failed
event carries response_body, up to 500 chars of the upstream provider's
error response, so publish failures are diagnosable in PostHog from both
publish paths (task_publish, fill_schedule). It is scrubbed with
scrub_error_text (secrets + machine-local paths) before capture and never
reaches Discord or the task error string.

Deliberate exception (PR #250): the script_angle_generated event carries
angle, LLM output derived from the user's own topic and already persisted
as product data on the task record (the user sees it in post detail). The
call site passes it through scrub_secret_values before capture.
"""

from __future__ import annotations

import logging
import os
import re
import tempfile
from typing import Any

logger = logging.getLogger(__name__)

# Property keys matching this pattern are redacted before capture.
_SECRET_KEY_PATTERN = re.compile(
    r"password|passwd|secret|token|authorization|auth\b|api[-_]?key|"
    r"bearer|credential|private[-_]?key|session",
    re.IGNORECASE,
)

# Values matching this pattern have the secret portion redacted.
# Catches `key=secret`, `key: secret`, `"key": "secret"` (JSON),
# `'key': 'secret'` (Python repr), and `Bearer <token>` in free text.
# The optional quotes matter: model output and SDK/HTTP errors often echo
# config blobs in JSON/dict shape, which the bare pattern missed.
_SECRET_VALUE_PATTERN = re.compile(
    r"(password|passwd|secret|token|api[-_]?key|credential|private[-_]?key|session)[\"']?\s*[:=]\s*[\"']?([^\s,;\"']+)"
    r"|(bearer)\s+([^\s,;\"']+)"
    # Hosted-provider keys are self-identifying by prefix (OpenRouter
    # `sk-or-v1-...`, OpenAI `sk-...`/`sk-proj-...`). They leak with no field
    # name in sight -- an upstream HTTP error body echoes the rejected key back
    # verbatim -- so the key-anchored branch above cannot see them. The length
    # floor keeps ordinary words starting with "sk" ("sketch", "sk-42") intact.
    r"|\b(sk-(?:or-v1-)?[A-Za-z0-9_-]{20,})",
    re.IGNORECASE,
)

_REDACTED = "[redacted]"


def scrub_secret_values(text: str) -> str:
    """Redact secret values from free-text strings (exception messages, stacktraces)."""
    def _replace(m: re.Match[str]) -> str:
        # Group 1/3 is the key name; preserve it, redact the value.
        key = m.group(1) or m.group(3)
        if key is None:
            # The bare provider-key branch: no key name to preserve.
            return _REDACTED
        sep = "=" if m.group(1) else " "
        return f"{key}{sep}{_REDACTED}"
    return _SECRET_VALUE_PATTERN.sub(_replace, text)


# Placeholders for machine-local roots in analytics error text.
_HOME_PLACEHOLDER = "<home>"
_STORAGE_PLACEHOLDER = "<storage>"
_PATH_PLACEHOLDER = "<path>"

# Matches absolute Unix paths. The negative lookbehind keeps URL schemes
# (https://host/...) intact — the slashes after ':' never match — and
# protects the <home>/, <storage>/, <path>/ placeholders this module
# inserts, whose slashes follow '>'.
_ABSOLUTE_PATH_PATTERN = re.compile(r"(?<![\w:/<>])(?:/[\w.\-~]+)+")

# Marks where the middle of a truncated multi-line error was dropped.
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
    # Longest root first so nested roots replace correctly.
    for root, placeholder in sorted(roots, key=lambda item: -len(item[0])):
        text = text.replace(root, placeholder)
    # <home>/a/b/file.mp4 -> <home>/file.mp4 (same for <storage>).
    text = re.sub(
        r"(<home>|<storage>)(?:/[^\s\"'/<>]+)+/([^\s\"'/<>]+)",
        r"\1/\2",
        text,
    )
    # Backstop for absolute paths from any other machine.
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
        # Single long line (or a very long first line): the diagnostic
        # detail lives at the end, so keep the tail.
        return cleaned[-max_chars:]
    return first_line + _TRUNCATION_MARKER + cleaned[-tail_budget:]

# Default PostHog ingest host. Change this constant if you self-host
# PostHog — every telemetry path in the engine reads it as the fallback
# when POSTHOG_HOST is not set. Keep in sync with the web
# (apps/web/lib/posthog-config.ts) and MCP (apps/mcp/src/analytics.ts)
# constants — apps/web/lib/__tests__/posthog-config.test.ts enforces it.
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


# Exact property names exempt from key-name redaction. "token" is a
# substring of _SECRET_KEY_PATTERN (to catch *_token secrets), so without
# this exemption the legitimate ai_request token-usage counters would be
# redacted before capture.
_REDACT_EXEMPT_KEYS = frozenset(
    {"prompt_tokens", "completion_tokens", "total_tokens"}
)


def _scrub_secrets(properties: dict[str, Any]) -> dict[str, Any]:
    scrubbed: dict[str, Any] = {}
    for key, value in properties.items():
        # Exempt names are legitimate telemetry counters — but only when the
        # value is actually a number. A secret is never an int, so a
        # non-numeric value under an exempt name is still redacted. This
        # keeps the exemption from becoming a global opt-out for every event.
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
    except Exception as exc:  # noqa: BLE001 - telemetry must never break
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
        # Origin tags: assigned after scrubbing and after any caller-supplied
        # values, so they can never be redacted or overridden — the origin of
        # an event is a pipeline fact, not caller input.
        props["source"] = "engine"
        props["environment"] = _get_environment()
        # Attribute the event to the real user when known so PostHog breaks
        # the funnel down per person; the engine pseudo-person is only the
        # fallback for events without a user (e.g. background jobs).
        raw_user_id = (properties or {}).get("user_id")
        distinct_id = (
            raw_user_id
            if isinstance(raw_user_id, str)
            and raw_user_id
            and raw_user_id != "unknown"
            else "post-engineer-engine"
        )
        client.capture(
            distinct_id=distinct_id,
            event=event_name,
            properties=props,
        )
        if immediate:
            client.flush()
    except Exception:  # noqa: BLE001 - telemetry must never break
        pass


def track_ai_request(properties: dict[str, Any]) -> None:
    """Track one AI backend call (LLM or Modal).

    Event name: ai_request. The caller builds the properties dict with a
    uniform schema: backend ("llm" | "modal"), duration_ms, success, plus
    backend-specific context (provider/model/primary_provider/fallback_used
    for llm; operation/job_id for modal) and, on failure, a pre-sanitized
    error. track_event redacts whole properties whose KEY names a secret
    as a backstop and never raises — free-text fields (error,
    response_preview) must be scrubbed by the caller first, which the
    llm/modal paths do via scrub_error_text.
    """
    track_event("ai_request", properties)


def reset_for_testing() -> None:
    """Reset cached client between tests. Not used in production."""
    global _client, _warned, _attempted
    _client = None
    _warned = False
    _attempted = False
