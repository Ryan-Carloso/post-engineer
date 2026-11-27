import 'server-only';

import { logger } from '@/lib/logger';
import { publishContent } from '@/lib/upload/publish-content';
import { ATTEMPT_LEASE_SECONDS, PUBLISH_DUE_MAX_SLOTS_PER_TICK, PUBLISH_DUE_TICK_BUDGET_MS } from '@/lib/publisher/constants';
import { schedulerStartedMessage, sendDiscord } from '@/lib/publisher/discord';
import { trackPublishEvent } from '@/lib/publisher/events';
import { createOutageTracker, isConnectionFailure } from '@/lib/publisher/outage';
import { notifyPublishFailed, notifyPublishPartial } from '@/lib/publisher/owner-mail';
import { failSlotPermanently, publishSlot, type PublishSlotDeps } from '@/lib/publisher/publish-slot';
import { runPublishDue } from '@/lib/publisher/run-due';
import { createPublisherStore } from '@/lib/publisher/store';

const outage = createOutageTracker(logger);

export async function runPublishDueTick(): Promise<void> {
  const clock = (): Date => new Date();
  const store = createPublisherStore();
  const deps: PublishSlotDeps = {
    store,
    publish: publishContent,
    clock,
    track: trackPublishEvent,
    discord: (message) => sendDiscord(message),
    mailFailed: (mail) => notifyPublishFailed(mail),
    mailPartial: (mail) => notifyPublishPartial(mail),
    newLogId: () => logger.generateLogId(),
  };
  try {
    await runPublishDue({
      store,
      publishSlot: (slot) => publishSlot(deps, slot),
      failSlot: (slot, reason) => failSlotPermanently(deps, slot, reason),
      clock,
      logger,
      maxSlots: PUBLISH_DUE_MAX_SLOTS_PER_TICK,
      budgetMs: PUBLISH_DUE_TICK_BUDGET_MS,
      leaseSeconds: ATTEMPT_LEASE_SECONDS,
    });
    outage.recovered(clock());
  } catch (error) {
    if (!isConnectionFailure(error)) throw error;
    outage.report(error, clock());
  }
}

export function announcePublishScheduler(): void {
  void sendDiscord(schedulerStartedMessage());
}
