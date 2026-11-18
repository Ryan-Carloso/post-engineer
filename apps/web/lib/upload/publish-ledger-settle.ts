import type { SupabaseClient } from '@supabase/supabase-js';

import { classifyUploadAccountError } from '@/lib/upload/account-error';
import type { ContentUploadAccountResult } from '@/lib/upload/content-upload-result';
import {
  markPublishUnknown,
  mergePartitionResults,
  recordPartitionResults,
  recordPublishAttempt,
  releaseClaimsForRequestRejection,
  type PublishLedgerPartition,
} from '@/lib/upload/publish-ledger';

export async function releaseGrantedClaims(
  supabase: SupabaseClient,
  partition: PublishLedgerPartition,
  error: unknown,
): Promise<void> {
  const failure = classifyUploadAccountError(error);
  await Promise.all(
    partition.granted.map((granted) =>
      recordPublishAttempt(supabase, {
        scopeKey: partition.scopeKey,
        provider: partition.provider,
        accountId: granted.accountId,
        claimToken: granted.claimToken,
        accountResult: {
          accountId: granted.accountId,
          success: false,
          error: failure.error,
          errorCode: failure.errorCode,
        },
      }),
    ),
  );
}

export async function settlePartition(
  supabase: SupabaseClient,
  partition: PublishLedgerPartition,
  results: ContentUploadAccountResult[] | undefined,
): Promise<ContentUploadAccountResult[]> {
  const unrecorded = await recordPartitionResults(supabase, partition, results);
  await Promise.all(
    unrecorded.map((accountId) => {
      const granted = partition.granted.find((item) => item.accountId === accountId);
      if (granted === undefined) return Promise.resolve(false);
      const scopeKey = partition.scopeKey;
      const provider = partition.provider;
      const claimToken = granted.claimToken;
      const error = 'publish record lost after a successful post';
      const args = { scopeKey, provider, accountId, claimToken, error };
      return markPublishUnknown(supabase, args);
    }),
  );
  await releaseClaimsForRequestRejection(supabase, partition, results);
  return mergePartitionResults(partition, results);
}
