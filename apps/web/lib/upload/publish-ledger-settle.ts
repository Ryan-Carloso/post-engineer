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

//---------------
// The two ways a ledger-claimed publish ends, shared by every route that
// publishes under a scope key (POST /api/upload-content and the ASAP path
// of POST /api/media/publish-existing): the handler threw, or it returned
// per-account results. Kept apart from publish-ledger.ts so that module
// stays under the file-size cap.
//---------------

/**
 * The handler threw (or the media for it could not be prepared): nothing
 * reached the provider, so release every granted claim as failed. The next
 * retry with the same key proceeds at once instead of waiting out the lease.
 */
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

/**
 * The handler returned: record each granted account's outcome, park a
 * success the ledger could not record as unknown (the post may already be
 * live, so no later retry may claim a fresh publish for it), release the
 * claims when the handler rejected the whole request before publishing,
 * and return one results list: replayed, in flight, unknown, then fresh.
 */
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
      // One const per field: v8 emits no line entries for properties
      // inside an object literal, so an inline argument object reads
      // as uncovered lines to Codecov even when the test runs it.
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
