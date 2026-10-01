"""PostHog product-analytics for the engine.

Tracks the video lifecycle funnel as PostHog events:
- video_generation_started / video_generated / video_generation_failed
- video_publish_started / video_published / video_publish_failed

Safety rules:
- Never raises: telemetry must never break video generation.
- No-op when POSTHOG_API_KEY is missing (warns once).
- Secret-bearing property keys are redacted before capture.
- Never log PII, credentials, or raw request bodies in properties.
- Configuration comes from environment variables only — never hardcode.
"""

from __future__ import annotations

import logging
import os
import re
from typing import Any

logger = logging.getLogger(__name__)

# Property keys matching this pattern are redacted before capture.
_SECRET_KEY_PATTERN = re.compile(
    r"password|passwd|secret|token|authorization|auth\b|api[-_]?key|"
    r"bearer|credential|private[-_]?key|session",
    re.IGNORECASE,
)

# Values matching this pattern have the secret portion redacted.
# Catches `key=secret`, `key: secret`, `Bearer secret` in free text.
_SECRET_VALUE_PATTERN = re.compile(
    r"(password|passwd|secret|token|api[-_]?key|credential|private[-_]?key|session)\s*[:=]\s*([^\s,;\"']+)"
    r"|(bearer)\s+([^\s,;\"']+)",
    re.IGNORECASE,
)

_REDACTED = "[redacted]"


def scrub_secret_values(text: str) -> str:
    """Redact secret values from free-text strings (exception messages, stacktraces)."""
    def _replace(m: re.Match[str]) -> str:
        # Group 1/3 is the key name; preserve it, redact the value.
        key = m.group(1) or m.group(3)
        sep = "=" if m.group(1) else " "
        return f"{key}{sep}[redacted]"
    return _SECRET_VALUE_PATTERN.sub(_replace, text)

# Default PostHog ingest host. Change this constant if you self-host
# PostHog — every telemetry path in the engine reads it as the fallback
# when POSTHOG_HOST is not set. Keep in sync with the web
# (apps/web/lib/posthog-config.ts) and MCP (apps/mcp/src/analytics.ts)
# constants — apps/web/lib/__tests__/posthog-config.test.ts enforces it.
DEFAULT_POSTHOG_HOST = "https://eu.i.posthog.com"

_client: Any = None
_warned = False
_attempted = False


def _scrub_secrets(properties: dict[str, Any]) -> dict[str, Any]:
    scrubbed: dict[str, Any] = {}
    for key, value in properties.items():
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


def track_event(event_name: str, properties: dict[str, Any] | None = None) -> None:
    """Track a product-analytics event.

    event_name should be snake_case. properties carries safe context only:
    ids, counts, validated enums — never credentials or raw bodies.
    """
    try:
        client = _get_client()
        if client is None:
            return
        props = _scrub_secrets(dict(properties or {}))
        client.capture(
            distinct_id="post-engineer-engine",
            event=event_name,
            properties=props,
        )
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
    llm/modal paths do via scrub_secret_values.
    """
    track_event("ai_request", properties)


def reset_for_testing() -> None:
    """Reset cached client between tests. Not used in production."""
    global _client, _warned, _attempted
    _client = None
    _warned = False
    _attempted = False
