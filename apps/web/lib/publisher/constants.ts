export const SLOT_PUBLISHING = 'publishing';
export const SLOT_PUBLISHED = 'published';
export const SLOT_FAILED = 'failed';

export const MAX_PUBLISH_ATTEMPTS = 3;
export const PUBLISH_RETRY_DELAY_SECONDS = [30, 120, 600] as const;
export const PUBLISH_IN_PROGRESS_DELAY_SECONDS = 60;
export const ATTEMPT_LEASE_SECONDS = 30 * 60;
export const MAX_IN_PROGRESS_WAIT_SECONDS = ATTEMPT_LEASE_SECONDS;
export const BINDING_RETRY_DELAY_SECONDS = 60;

export const PUBLISH_DUE_MAX_SLOTS_PER_TICK = 20;
export const PUBLISH_DUE_TICK_BUDGET_MS = 10 * 60 * 1000;
export const PUBLISH_CALL_TIMEOUT_MS = 25 * 60 * 1000;
export const OUTAGE_REMINDER_MS = 30 * 60 * 1000;
export const EXPIRE_BATCH_LIMIT = 100;

export const UPLOADS_BUCKET = 'uploads';
export const VIDEOS_BUCKET = 'videos';
