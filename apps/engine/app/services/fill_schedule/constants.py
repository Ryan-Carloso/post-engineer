"""Shared constants for the batch scheduling pipeline."""

import requests

GENERATION_HORIZON_HOURS = 24
TICK_SECONDS = 60
SIGNED_URL_EXPIRES_SECONDS = 24 * 3600

SLOT_PENDING = "pending"
SLOT_GENERATING = "generating"
SLOT_READY = "ready"
SLOT_PUBLISHING = "publishing"
SLOT_PUBLISHED = "published"
SLOT_FAILED = "failed"

MAX_PUBLISH_ATTEMPTS = 3

PUBLISH_RETRY_DELAY_SECONDS = (30, 120, 600)

PUBLISH_IN_PROGRESS_DELAY_SECONDS = 60

CONNECTION_FAILURES = (
    requests.exceptions.ConnectionError,
    requests.exceptions.Timeout,
    ConnectionError,
    TimeoutError,
)
