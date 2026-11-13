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

# Backoff after a transient account failure (seconds, keyed by the attempt
# that just failed — attempt 1 waits 30s, attempt 2 waits 2min). The third
# try is terminal, so the 600s value is never scheduled. The slot stays
# `publishing` and `publish_not_before` is the next wake-up. It does not
# return to `ready` between tries.
PUBLISH_RETRY_DELAY_SECONDS = (30, 120, 600)

# Wake-up after the web route answers "publish_in_progress": the earlier
# request is still publishing this account, so the retry only re-asks for
# its recorded result. It spends no attempt (see account_outcomes), so the
# delay is short and independent of the transient backoff above. The wait
# is capped (MAX_IN_PROGRESS_WAIT_SECONDS in account_outcomes): past it
# the account fails terminally as publish_unknown, without refund.
PUBLISH_IN_PROGRESS_DELAY_SECONDS = 60

# Unified generate+schedule batches (POST /api/videos/generate-and-schedule):
# finite, user-requested, prepaid at request time. Their slots carry the
# title chosen by the user.
