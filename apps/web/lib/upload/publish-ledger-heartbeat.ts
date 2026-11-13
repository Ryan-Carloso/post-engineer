import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import {
  PUBLISH_LEDGER_LEASE_SECONDS,
  publishLedgerKey,
  type PublishLedgerPartition,
} from '@/lib/upload/publish-ledger';

//---------------
// publish-ledger heartbeat — extracted from publish-ledger.ts (file-size
// ratchet). While a request publishes, it renews its claims on a timer so
// a publish longer than the 30-minute lease is never taken over while it
// is still alive; a takeover only happens when the holder is gone (no
// heartbeat for a full lease).
//---------------

// The holder touches its lease every 10 minutes — a third of the lease,
// so two consecutive failed touches still fit inside it.
export const PUBLISH_LEDGER_HEARTBEAT_MS = 10 * 60 * 1000;

export interface TouchPublishLedgerInput {
  scopeKey: string;
  provider: string;
  accountId: string;
  claimToken: string;
}

// Renews one claim's lease. Returns false instead of throwing when the
// touch is lost: a missed heartbeat is not fatal — the next one retries,
// and only a full lease without any touch lets a retry take over. A
// heartbeat failure must never fail the publish it protects.
export async function touchPublishLedger(
  supabase: SupabaseClient,
  input: TouchPublishLedgerInput,
): Promise<boolean> {
  const { data, error } = await supabase.rpc('touch_publish_ledger', {
    p_key: publishLedgerKey(input.scopeKey, input.provider, input.accountId),
    p_token: input.claimToken,
    p_lease_seconds: PUBLISH_LEDGER_LEASE_SECONDS,
  });
  if (error) {
    logger.error('[publish-ledger] touch failed', error, {
      key: publishLedgerKey(input.scopeKey, input.provider, input.accountId),
    });
    return false;
  }
  if (data !== true) {
    logger.error('[publish-ledger] touch lost: claim no longer held', null, {
      key: publishLedgerKey(input.scopeKey, input.provider, input.accountId),
    });
    return false;
  }
  return true;
}

// Renews every granted claim on a heartbeat while the holder publishes,
// so a long upload is never taken over while it is still alive. Returns
// a stop function the route calls in a finally once the handler finished
// and the outcomes are recorded. The timer is unref'd: it must never
// hold the process open after the request is done.
export function startLedgerHeartbeat(
  supabase: SupabaseClient,
  partition: PublishLedgerPartition,
): () => void {
  const timer = setInterval(() => {
    void Promise.all(
      partition.granted.map((granted) =>
        touchPublishLedger(supabase, {
          scopeKey: partition.scopeKey,
          provider: partition.provider,
          accountId: granted.accountId,
          claimToken: granted.claimToken,
        }),
      ),
    );
  }, PUBLISH_LEDGER_HEARTBEAT_MS);
  timer.unref();
  return () => clearInterval(timer);
}
