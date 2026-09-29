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

# Manual video batches (POST /api/schedule/batch): finite, user-requested,
# prepaid at request time. Their slots carry the topic chosen by the user.
# This is the only schedule kind the pipeline processes.
SCHEDULE_KIND_BATCH = "batch"
