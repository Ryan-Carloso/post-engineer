import { logger } from '@/lib/logger';
import { BINDING_RETRY_DELAY_SECONDS, SLOT_FAILED, SLOT_PUBLISHED, SLOT_PUBLISHING } from '@/lib/publisher/constants';
import {
  partialFailureProperties,
  providerFailedProperties,
  publishFailedProperties,
  publishTrackingContext,
} from '@/lib/publisher/events';
import {
  claimedUploadCleanup,
  cleanupExistingMedia,
  imageCleanup,
  resolveExistingMedia,
} from '@/lib/publisher/existing-media';
import { nextDelaySeconds } from '@/lib/publisher/outcomes';
import { PublishPlanError, validatePublishPlan } from '@/lib/publisher/plan';
import { publishSlotAccounts, type PublishFn } from '@/lib/publisher/publish-accounts';
import { errorMessageOf, scrubErrorText } from '@/lib/publisher/scrub-error';
import type { PublisherStore } from '@/lib/publisher/store-types';
import type { AccountOutcome, MediaCleanup, PublishSlot } from '@/lib/publisher/types';
import type { PublishFailedMail, PublishFailure, PublishPartialMail } from '@/lib/publisher/owner-mail';
import {
  partialPublishMessage,
  slotFailedMessage,
  slotPublishedMessage,
  userActionMessage,
} from '@/lib/publisher/discord';

export interface PublishSlotDeps {
  store: PublisherStore;
  publish: PublishFn;
  clock: () => Date;
  track: (event: string, properties: Record<string, unknown>) => void;
  discord: (message: string) => Promise<unknown>;
  mailFailed: (mail: PublishFailedMail) => Promise<void>;
  mailPartial: (mail: PublishPartialMail) => Promise<void>;
  newLogId: () => string;
}

interface FailOptions {
  attempts?: number;
  emitFailedEvent?: boolean;
  outcomes?: AccountOutcome[];
}

export function failedOutcomes(outcomes: AccountOutcome[] | undefined): PublishFailure[] {
  return (outcomes ?? [])
    .filter((outcome) => outcome.status === 'failed')
    .map((outcome) => ({ provider: outcome.provider, accountId: outcome.accountId, reason: outcome.error ?? '' }));
}

export async function failSlotPermanently(
  deps: PublishSlotDeps,
  slot: PublishSlot,
  error: string,
  options: FailOptions = {},
): Promise<void> {
  if (options.emitFailedEvent !== false) {
    deps.track('video_publish_failed', publishFailedProperties(slot, error, { retryable: false }));
  }
  const reason = scrubErrorText(error, 200);
  const fields: Record<string, unknown> = { status: SLOT_FAILED, error: reason, publish_not_before: null };
  if (options.attempts !== undefined) fields.publish_attempts = options.attempts;
  if (options.outcomes !== undefined) fields.publish_outcomes = options.outcomes;
  await deps.store.updateSlot(slot.id, fields);
  void deps.mailFailed({
    userId: slot.userId,
    slotId: slot.id,
    title: slot.title ?? '',
    reason,
    persona: slot.schedule.personaName,
    failures: failedOutcomes(options.outcomes),
  });
}

function soonestRetry(outcomes: AccountOutcome[], now: Date): string {
  const wakes = outcomes
    .flatMap((outcome) => (outcome.status === 'retrying' && outcome.retryAt !== null ? [outcome.retryAt] : []))
    .filter((wake) => !Number.isNaN(Date.parse(wake)))
    .sort((a, b) => Date.parse(a) - Date.parse(b));
  const [first] = wakes;
  if (first !== undefined) return first;
  return new Date(now.getTime() + (nextDelaySeconds(1) ?? 0) * 1000).toISOString();
}

async function validateBoundPlan(
  deps: PublishSlotDeps,
  slot: PublishSlot,
  title: string,
  description: string,
  now: Date,
): Promise<'ok' | 'deferred' | { failure: string }> {
  const personaId = slot.schedule.personaId;
  if (personaId === null) return 'ok';
  let bound: Record<string, string[]>;
  try {
    bound = await deps.store.personaBoundAccounts(personaId);
  } catch (error) {
    logger.warn('[publisher] binding read failed, leaving the slot for the next tick', {
      slotId: slot.id,
      reason: scrubErrorText(errorMessageOf(error), 200),
    });
    await deps.store.updateSlot(slot.id, {
      publish_not_before: new Date(now.getTime() + BINDING_RETRY_DELAY_SECONDS * 1000).toISOString(),
    });
    return 'deferred';
  }
  try {
    validatePublishPlan(slot.schedule, title, description, bound);
  } catch (error) {
    if (error instanceof PublishPlanError) return { failure: error.message };
    throw error;
  }
  return 'ok';
}

export async function publishSlot(deps: PublishSlotDeps, slot: PublishSlot): Promise<boolean> {
  const { store, clock } = deps;
  const now = clock();
  const title = slot.title ?? 'Scheduled post';
  const description = (slot.description ?? '').trim();
  const personaName = slot.schedule.personaName ?? 'Persona';
  const resumed = slot.resumed;
  let mediaCleanup: MediaCleanup = imageCleanup(slot) ?? (await claimedUploadCleanup(store, slot, resumed));

  const plan = await validateBoundPlan(deps, slot, title, description, now);
  if (plan === 'deferred') return false;
  if (plan !== 'ok') {
    await failSlotPermanently(deps, slot, plan.failure);
    await cleanupExistingMedia(store, slot.id, mediaCleanup);
    return false;
  }

  if (!resumed) deps.track('video_publish_started', publishTrackingContext(slot));
  if (slot.mediaKind !== 'upload' && slot.mediaKind !== 'image') {
    await failSlotPermanently(deps, slot, 'slot has no uploaded media');
    return false;
  }
  const resolved = await resolveExistingMedia(
    store,
    (reason) => failSlotPermanently(deps, slot, reason),
    slot,
    now,
    resumed,
  );
  if (resolved === null) return false;
  mediaCleanup = resolved.cleanup ?? mediaCleanup;

  const result = await publishSlotAccounts({
    slot,
    media: resolved.media,
    title,
    description,
    publish: deps.publish,
    persistOutcomes: (outcomes, fields) => store.updateSlot(slot.id, { publish_outcomes: outcomes, ...fields }),
    clock,
    logId: deps.newLogId(),
  });

  for (const failure of result.providerFailures) {
    deps.track('publish_provider_failed', providerFailedProperties(slot, failure));
  }
  for (const notice of result.newUserNotices) void deps.discord(userActionMessage(notice));

  const outcomeFields = { publish_outcomes: result.outcomes, publish_attempts: result.maxAttempts };
  if (result.anyRetrying) {
    await store.updateSlot(slot.id, {
      status: SLOT_PUBLISHING,
      publish_not_before: soonestRetry(result.outcomes, clock()),
      ...outcomeFields,
    });
    deps.track(
      'video_publish_failed',
      publishFailedProperties(slot, result.failureReason, { retryable: true, attempts: result.maxAttempts }),
    );
    return false;
  }

  if (result.anyPublished) {
    await store.updateSlot(slot.id, {
      status: SLOT_PUBLISHED,
      published_at: clock().toISOString(),
      publish_not_before: null,
      ...outcomeFields,
    });
    await cleanupExistingMedia(store, slot.id, mediaCleanup);
    deps.track('video_published', { ...publishTrackingContext(slot), providers: result.publishedProviders });
    void deps.discord(slotPublishedMessage(personaName, title, result.publishedProviders));
    if (result.failedProviders.length > 0) {
      deps.track(
        'video_publish_partial_failure',
        partialFailureProperties(slot, result.failedProviders, result.publishedProviders, result.firstError),
      );
      if (result.nonUserFailedProviders.length > 0) {
        void deps.discord(partialPublishMessage(slot.id, result.nonUserFailedProviders));
      }
      void deps.mailPartial({
        userId: slot.userId,
        slotId: slot.id,
        title,
        persona: slot.schedule.personaName,
        failures: failedOutcomes(result.outcomes),
      });
    }
    return true;
  }

  const reason = scrubErrorText(result.failureReason, 200);
  await failSlotPermanently(deps, slot, `publish failed after ${result.maxAttempts} attempts: ${reason}`, {
    attempts: result.maxAttempts,
    emitFailedEvent: false,
    outcomes: result.outcomes,
  });
  await cleanupExistingMedia(store, slot.id, mediaCleanup);
  deps.track(
    'video_publish_failed',
    publishFailedProperties(slot, result.failureReason, { retryable: false, attempts: result.maxAttempts }),
  );
  void deps.discord(slotFailedMessage(personaName, title, reason));
  return false;
}
