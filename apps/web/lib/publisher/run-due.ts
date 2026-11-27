import { cleanupExistingMedia, expiredSlotCleanup } from '@/lib/publisher/existing-media';
import { isConnectionFailure, type OutageLogger } from '@/lib/publisher/outage';
import { errorMessageOf, scrubErrorText } from '@/lib/publisher/scrub-error';
import type { PublisherStore } from '@/lib/publisher/store-types';
import type { PublishSlot } from '@/lib/publisher/types';

interface RunDueLogger extends OutageLogger {
  warn(message: string, metadata?: Record<string, unknown>): unknown;
}

export interface RunDueDeps {
  store: PublisherStore;
  publishSlot: (slot: PublishSlot) => Promise<boolean>;
  failSlot: (slot: PublishSlot, reason: string) => Promise<void>;
  clock: () => Date;
  logger: RunDueLogger;
  maxSlots: number;
  budgetMs: number;
  leaseSeconds: number;
}

export interface RunDueReport {
  claimed: number;
  published: number;
  expired: number;
  failed: number;
  stoppedBy: 'empty' | 'cap' | 'budget';
}

async function expireInactive(deps: RunDueDeps): Promise<number> {
  const expired = await deps.store.expireInactiveReadySlots(deps.clock());
  for (const slot of expired) {
    try {
      await cleanupExistingMedia(deps.store, slot.id, await expiredSlotCleanup(deps.store, slot));
    } catch (error) {
      if (isConnectionFailure(error)) throw error;
      deps.logger.error('[publisher] expired slot media cleanup failed', error, { slotId: slot.id });
    }
  }
  return expired.length;
}

async function publishClaimed(deps: RunDueDeps, slot: PublishSlot): Promise<'published' | 'done' | 'failed'> {
  try {
    return (await deps.publishSlot(slot)) ? 'published' : 'done';
  } catch (error) {
    if (isConnectionFailure(error)) throw error;
    deps.logger.error('[publisher] slot failed unexpectedly', error, { slotId: slot.id });
    try {
      await deps.failSlot(slot, `unexpected publish error: ${scrubErrorText(errorMessageOf(error), 200)}`);
    } catch (failError) {
      if (isConnectionFailure(failError)) throw failError;
      deps.logger.error('[publisher] could not fail the slot', failError, { slotId: slot.id });
    }
    return 'failed';
  }
}

export async function runPublishDue(deps: RunDueDeps): Promise<RunDueReport> {
  const startedAt = deps.clock().getTime();
  const report: RunDueReport = { claimed: 0, published: 0, expired: 0, failed: 0, stoppedBy: 'empty' };
  report.expired = await expireInactive(deps);

  for (;;) {
    if (report.claimed >= deps.maxSlots) {
      report.stoppedBy = 'cap';
      break;
    }
    if (deps.clock().getTime() - startedAt >= deps.budgetMs) {
      report.stoppedBy = 'budget';
      break;
    }
    const slot = await deps.store.claimNextSlot(deps.clock(), deps.leaseSeconds);
    if (slot === null) break;
    report.claimed += 1;
    const outcome = await publishClaimed(deps, slot);
    if (outcome === 'published') report.published += 1;
    if (outcome === 'failed') report.failed += 1;
  }

  if (report.claimed > 0 || report.expired > 0) {
    deps.logger.info('[publisher] tick counters', { ...report });
  }
  return report;
}
