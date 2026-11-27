"""Shared constants for the batch scheduling pipeline."""

import requests

TICK_SECONDS = 60

SLOT_READY = "ready"
SLOT_PUBLISHING = "publishing"
SLOT_PUBLISHED = "published"
SLOT_FAILED = "failed"
SLOT_EXPIRED = "expired"

MAX_PUBLISH_ATTEMPTS = 3

PUBLISH_RETRY_DELAY_SECONDS = (30, 120, 600)

PUBLISH_IN_PROGRESS_DELAY_SECONDS = 60

CONNECTION_FAILURES = (
    requests.exceptions.ConnectionError,
    requests.exceptions.Timeout,
    ConnectionError,
    TimeoutError,
)
