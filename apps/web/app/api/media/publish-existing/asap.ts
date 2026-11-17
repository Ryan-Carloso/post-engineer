//---------------
// ASAP branch of POST /api/media/publish-existing: publish existing media
// now, once per (provider, account) even when the caller retries.
//
// A caller-supplied idempotency key becomes the publish-ledger scope key
// `direct:existing:<id>` (the same ledger POST /api/upload-content uses):
// before any media is loaded, every account is claimed; a retry of a call
// that already published replays the recorded posts instead of posting
// again, an account still publishing under the first call answers
// publish_in_progress, and only accounts with no recorded success publish.
// A call with no key publishes without the ledger.
//---------------

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

import { apiErrorResponse } from '@/lib/api-error';
import { trackApiEvent } from '@/lib/analytics';
import { logger } from '@/lib/logger';
import { accountFailure } from '@/lib/upload/account-error';
import type { ContentUploadAccountResult } from '@/lib/upload/content-upload-result';
import { buildUploadErrorResponse } from '@/lib/upload/handlers';
import {
  PUBLISH_ACCOUNT_FIELDS,
  createPublishLedgerClient,
  mergePartitionResults,
  partitionPublishAccounts,
  type PublishLedgerPartition,
} from '@/lib/upload/publish-ledger';
import { startLedgerHeartbeat } from '@/lib/upload/publish-ledger-heartbeat';
import { releaseGrantedClaims, settlePartition } from '@/lib/upload/publish-ledger-settle';
import { dispatchPublish } from '@/lib/videos/publish-uploaded';
import {
  VideoUploadError,
  claimUploadForPublish,
  createSupabaseVideoUploadStorage,
  createSupabaseVideoUploadStore,
} from '@/lib/videos/signed-upload';
import type { Provider } from '../../videos/generate-and-schedule/providers-validation';
import { fieldsFor, type PublishExistingContext } from './context';
import { ExistingMediaError, downloadEngineTaskVideo } from './media-resolve';
import { buildExistingMediaForm } from './publish-form';
import type { PublishExistingRequest } from './schema';

export interface AsapLedger {
  client: SupabaseClient;
  partitions: Map<Provider, PublishLedgerPartition>;
}

interface ProviderPublish {
  provider: string;
  success: boolean;
  results: ContentUploadAccountResult[];
}

/** The ledger scope key for an ASAP call: user-bound through the id. */
export function asapScopeKey(idempotencyId: string): string {
  return `direct:existing:${idempotencyId}`;
}

/**
 * Releases the claims this call still holds: the media could not be
 * prepared, so nothing reached a provider.
 */
export async function releaseAsapLedger(ledger: AsapLedger, error: unknown): Promise<void> {
  await Promise.all([...ledger.partitions.values()].map((partition) => releaseGrantedClaims(ledger.client, partition, error)));
}

/**
 * Claims every (provider, account) of the call. A claim failure throws
 * after releasing what was granted: publishing without the ledger could
 * post twice, so the caller answers 500 and the retry claims again.
 */
export async function claimAsapLedger(
  scopeKey: string,
  userId: string,
  providers: Provider[],
  accountIds: Record<Provider, string[]>,
): Promise<AsapLedger> {
  const ledger: AsapLedger = { client: createPublishLedgerClient(), partitions: new Map() };
  try {
    for (const provider of providers) {
      const form = new FormData();
      for (const accountId of accountIds[provider] ?? []) form.append(PUBLISH_ACCOUNT_FIELDS[provider], accountId);
      ledger.partitions.set(provider, await partitionPublishAccounts(ledger.client, scopeKey, provider, userId, form));
    }
  } catch (error) {
    await releaseAsapLedger(ledger, error);
    throw error;
  }
  return ledger;
}

export function hasGrantedAccounts(ledger: AsapLedger): boolean {
  return [...ledger.partitions.values()].some((partition) => partition.granted.length > 0);
}

function asapResponse(
  input: PublishExistingRequest,
  userId: string,
  logId: string,
  publishes: ProviderPublish[],
  replayed: boolean,
): NextResponse {
  // YouTube and Instagram handlers report success: true no matter how
  // many accounts failed — their per-account outcomes live in results —
  // so derive each provider's outcome from its account results. The
  // response must never claim a publish that never happened.
  const derived = publishes.map((publish) => ({ ...publish, success: publish.results.some((result) => result.success) }));
  const success = derived.every((publish) => publish.success);
  trackApiEvent('publish_existing_asap', {
    userId,
    mediaKind: input.media.kind,
    providers: input.publishing.providers,
    success,
    replayed,
  });
  return NextResponse.json({ success, mode: 'asap', mediaKind: input.media.kind, replayed, publishes: derived, logId });
}

/** A retry whose every account is already recorded: answer from the ledger, load no media. */
export function asapReplayResponse(
  input: PublishExistingRequest,
  userId: string,
  logId: string,
  ledger: AsapLedger,
): NextResponse {
  const publishes = [...ledger.partitions.entries()].map(([provider, partition]) => ({
    provider,
    success: false,
    results: mergePartitionResults(partition, []),
  }));
  return asapResponse(input, userId, logId, publishes, true);
}

async function publishToProvider(
  provider: Provider,
  media: { buffer: Buffer; contentType: string },
  ctx: PublishExistingContext,
  ledger: AsapLedger | null,
): Promise<ProviderPublish> {
  const partition = ledger?.partitions.get(provider) ?? null;
  const accountIds = partition !== null ? partition.granted.map((granted) => granted.accountId) : (ctx.accountIds[provider] ?? []);
  if (ledger !== null && partition !== null && accountIds.length === 0) {
    // Every account of this provider is already recorded or in flight.
    return { provider, success: false, results: mergePartitionResults(partition, []) };
  }
  const stopHeartbeat = ledger !== null && partition !== null ? startLedgerHeartbeat(ledger.client, partition) : null;
  try {
    const form = buildExistingMediaForm(provider, fieldsFor(ctx.input, provider, accountIds), media.buffer, media.contentType);
    let response;
    try {
      response = await dispatchPublish(provider, form, ctx.userId, ctx.logId, ctx.startTime);
    } catch (error) {
      // A handler throw must not discard the providers that already
      // published: record the failure per account and keep going, so the
      // response always carries every provider's outcome.
      logger.error('[publish-existing] provider publish threw', error, { provider, logId: ctx.logId, userId: ctx.userId });
      if (ledger !== null && partition !== null) await releaseGrantedClaims(ledger.client, partition, error);
      const failures = accountIds.length > 0 ? accountIds.map((accountId) => accountFailure(accountId, error)) : [accountFailure('', error)];
      return { provider, success: false, results: partition !== null ? mergePartitionResults(partition, failures) : failures };
    }
    const results = ledger !== null && partition !== null ? await settlePartition(ledger.client, partition, response.results) : response.results;
    return { provider, success: response.success, results };
  } finally {
    stopHeartbeat?.();
  }
}

function mediaErrorResponse(error: unknown, ctx: PublishExistingContext): NextResponse {
  if (error instanceof ExistingMediaError || error instanceof VideoUploadError) {
    return apiErrorResponse(error.status, error.message, { route: ctx.route, code: error.code });
  }
  return buildUploadErrorResponse(error, ctx.logId, ctx.startTime);
}

export async function publishExistingMediaAsap(ctx: PublishExistingContext, ledger: AsapLedger | null): Promise<NextResponse> {
  const { userId, input, logId } = ctx;
  // An image reaches only IMAGE_PROVIDERS: the semantics check (inline
  // image) and verifyMedia (an image upload) already rejected the rest.
  const providers: Provider[] = input.publishing.providers;
  const publishes: ProviderPublish[] = [];

  if (ctx.uploadRow !== null) {
    const store = createSupabaseVideoUploadStore();
    const storage = createSupabaseVideoUploadStorage();
    let claimed;
    try {
      claimed = await claimUploadForPublish(store, storage, userId, ctx.uploadRow.id, new Date(), providers);
    } catch (error) {
      if (ledger !== null) await releaseAsapLedger(ledger, error);
      return mediaErrorResponse(error, ctx);
    }
    try {
      for (const provider of providers) {
        publishes.push(await publishToProvider(provider, { buffer: claimed.buffer, contentType: claimed.contentType }, ctx, ledger));
      }
    } finally {
      // Single-use claim: the bytes are gone once dispatched, published
      // or not — exactly like publish-by-id.
      const { error: removeError } = await storage.remove([claimed.row.storage_path]);
      if (removeError) {
        logger.error('[publish-existing] claimed upload cleanup failed', removeError, { uploadId: ctx.uploadRow.id, userId });
      }
    }
    return asapResponse(input, userId, logId, publishes, false);
  }

  let media: { buffer: Buffer; contentType: string };
  try {
    if (ctx.image !== null) {
      media = ctx.image;
    } else if (ctx.taskRecord !== null) {
      media = await downloadEngineTaskVideo(ctx.taskRecord, userId);
    } else {
      throw new Error('publish-existing reached the ASAP branch without verified media');
    }
  } catch (error) {
    if (ledger !== null) await releaseAsapLedger(ledger, error);
    return mediaErrorResponse(error, ctx);
  }
  for (const provider of providers) {
    publishes.push(await publishToProvider(provider, media, ctx, ledger));
  }
  return asapResponse(input, userId, logId, publishes, false);
}
