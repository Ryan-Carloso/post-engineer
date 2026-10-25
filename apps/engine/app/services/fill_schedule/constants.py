"""Shared constants for the batch scheduling pipeline."""

GENERATION_HORIZON_HOURS = 24
TICK_SECONDS = 60
SIGNED_URL_EXPIRES_SECONDS = 24 * 3600  # max gap until generation

SLOT_PENDING = "pending"
SLOT_GENERATING = "generating"
SLOT_READY = "ready"
SLOT_PUBLISHING = "publishing"
SLOT_PUBLISHED = "published"
SLOT_FAILED = "failed"

# Publish retries: a slot whose publish keeps failing (provider outage, R2
# misconfiguration) is retried on later ticks up to this many attempts, then
# auto-cancelled (failed) with the prepaid token refunded. Publish must never
# retry forever waiting on a human to cancel the slot.
MAX_PUBLISH_ATTEMPTS = 3

# Backoff between publish attempts (seconds, keyed by the attempt that just
# failed — attempt 1 waits 30s, attempt 2 waits 2min). The slot goes back to
# 'ready' with a `publish_not_before` timestamp so `ready_due_slots` skips it
# until the delay passes: without it every tick re-attempted immediately,
# hammering a failing upload endpoint beyond its recovery window.
PUBLISH_RETRY_DELAY_SECONDS = (30, 120, 600)

# Unified generate+schedule batches (POST /api/videos/generate-and-schedule):
# finite, user-requested, prepaid at request time. Their slots carry the
# topic chosen by the user.
