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

_REDACTED = "[redacted]"

_DEFAULT_HOST = "https://us.i.posthog.com"

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

        host = os.environ.get("POSTHOG_HOST", _DEFAULT_HOST)
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


def reset_for_testing() -> None:
    """Reset cached client between tests. Not used in production."""
    global _client, _warned, _attempted
    _client = None
    _warned = False
    _attempted = False
