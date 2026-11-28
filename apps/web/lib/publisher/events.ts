import { trackApiEvent, trackApiEventAs } from '@/lib/analytics';
import type { ProviderFailure } from '@/lib/publisher/publish-accounts';
import { nonEmptyErrorReason } from '@/lib/publisher/scrub-error';
import type { PublishSlot } from '@/lib/publisher/types';

export function trackPublishEvent(event: string, properties: Record<string, unknown>): void {
  const userId = properties.user_id;
  if (typeof userId === 'string' && userId !== '' && userId !== 'unknown') {
    trackApiEventAs(userId, event, properties);
    return;
  }
  trackApiEvent(event, properties);
}

export function publishTrackingContext(slot: PublishSlot): Record<string, unknown> {
  const context: Record<string, unknown> = { slotId: slot.id };
  if (slot.userId !== null) context.user_id = slot.userId;
  if (slot.schedule.id !== null) context.schedule_id = slot.schedule.id;
  if (slot.schedule.personaId !== null) context.persona_id = slot.schedule.personaId;
  return context;
}

export function providerFailedProperties(slot: PublishSlot, failure: ProviderFailure): Record<string, unknown> {
  return {
    ...publishTrackingContext(slot),
    provider: failure.provider === '' ? 'unknown' : failure.provider,
    status_code: failure.status,
    reason: nonEmptyErrorReason(failure.message, 'Error', 200),
  };
}

export function publishFailedProperties(
  slot: PublishSlot,
  reason: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ...publishTrackingContext(slot),
    reason: nonEmptyErrorReason(reason, 'Error', 200),
    ...extra,
  };
}

export function partialFailureProperties(
  slot: PublishSlot,
  failedProviders: string[],
  publishedProviders: string[],
  firstError: string,
): Record<string, unknown> {
  const why = firstError !== '' ? firstError : failedProviders.join(',') || 'partial_failure';
  return {
    ...publishTrackingContext(slot),
    failed_providers: failedProviders,
    published_providers: publishedProviders,
    reason: nonEmptyErrorReason(why, 'partial_failure', 200),
  };
}
