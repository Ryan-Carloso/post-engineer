import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import {
  PUBLISH_LEDGER_LEASE_SECONDS,
  publishLedgerKey,
  type PublishLedgerPartition,
} from '@/lib/upload/publish-ledger';

export const PUBLISH_LEDGER_HEARTBEAT_MS = 10 * 60 * 1000;

export interface TouchPublishLedgerInput {
  scopeKey: string;
  provider: string;
  accountId: string;
  claimToken: string;
}

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
