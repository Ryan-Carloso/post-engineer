import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import type { SocialProvider } from '@/lib/providers/registry';
import { accountFailure } from '@/lib/upload/account-error';
import { getAccountIdsFromFormData } from '@/lib/upload/account-utils';
import type { ContentUploadAccountResult } from '@/lib/upload/content-upload-result';

//---------------
// publish-ledger — one recorded publish per (scope key, provider, account).
//
// The engine's 600s upload timeout can fire while this route is still
// publishing: the scheduler marks the account transient and retries 30s
// later, and the retry would post a second identical video. The ledger
// makes the retry answer from recorded state instead of posting again.
// The first request claims the key (in_progress, 30-min lease, fenced by
// a random token) and records its result when it finishes; a retry replays
// the recorded post, waits for the in-flight attempt, or — after a failed
// attempt or an expired lease — claims a fresh attempt. Only the request
// that holds the lease can record, so a first attempt whose lease was
// taken over cannot overwrite the winner's post.
//
// The key comes from the caller: the engine sends
// `slot:<slotId>:video:<name>` (deterministic across retries of the same
// slot/video); a direct caller sends `direct:<key>`. A request without a
// scope key publishes exactly as before, with no ledger.
//---------------

// The lease bounds how long a retry waits before taking over a claim.
// The holder renews it while it publishes (startLedgerHeartbeat below),
// so a takeover only happens when the holder is gone — no heartbeat for
// a full lease. A publish that runs longer than the lease (Fanvue is
// unbounded: up to 256 parts at 10 min each) is never taken over while
// it is still alive. The 30 minutes matches the engine's slot park
// (ATTEMPT_LEASE_SECONDS in fill_schedule/account_outcomes.py): a retry
// inside the lease waits instead of posting again.
export const PUBLISH_LEDGER_LEASE_SECONDS = 30 * 60;

// The holder touches its lease every 10 minutes — a third of the lease,
// so two consecutive failed touches still fit inside it.
export const PUBLISH_LEDGER_HEARTBEAT_MS = 10 * 60 * 1000;

/** The web route is still publishing this account under an earlier request. */
export const PUBLISH_IN_PROGRESS_CODE = 'publish_in_progress';

// The ledger rows' status values, mirroring the
// publish_ledger_status_check constraint in migration 059.
export const PUBLISH_LEDGER_STATUSES = ['in_progress', 'published', 'failed'] as const;

export type PublishLedgerOutcome = 'claimed' | 'published' | 'in_progress';

export interface PublishLedgerClaim {
  outcome: PublishLedgerOutcome;
  /** Fencing token for the claim; null unless this request holds the lease. */
  claimToken: string | null;
  /** The recorded post, when a retry replays an already-published account. */
  result: ContentUploadAccountResult | null;
}

export function publishLedgerKey(scopeKey: string, provider: string, accountId: string): string {
  return `publish:${scopeKey}:${provider}:${accountId}`;
}

// Scope keys come from the engine (`slot:<slotId>:video:<name>`) or a
// direct caller (`direct:<key>`). Anything else is not a key the ledger
// can trust: the caller publishes without dedup, exactly as before.
const SCOPE_KEY_PATTERN = /^(slot:[^:\s]+:video:.+|direct:.+)$/;
export function isValidPublishScopeKey(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 200 && SCOPE_KEY_PATTERN.test(value);
}

// The multipart field each provider's accounts arrive under. Pinned to the
// handlers by publish-ledger.test.ts — a rename in a handler without a
// rename here would silently skip the ledger for that provider.
export const PUBLISH_ACCOUNT_FIELDS: Record<SocialProvider, string> = {
  youtube: 'accountIds',
  instagram: 'igAccountIds',
  bluesky: 'did',
  linkedin: 'linkedinAccountIds',
  threads: 'threadsAccountIds',
  facebook: 'facebookAccountIds',
  pinterest: 'pinterestAccountIds',
  fanvue: 'fanvueAccountIds',
  '3speak': 'threespeakAccountIds',
  rumble: 'rumbleAccountIds',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toAccountResult(value: unknown, accountId: string): ContentUploadAccountResult {
  if (!isRecord(value) || value.success !== true) {
    throw new Error('claim_publish_ledger returned a malformed recorded result');
  }
  return { ...value, accountId } as ContentUploadAccountResult;
}

export interface ClaimPublishAttemptInput {
  scopeKey: string;
  provider: string;
  accountId: string;
  userId: string;
}

export async function claimPublishAttempt(
  supabase: SupabaseClient,
  input: ClaimPublishAttemptInput,
): Promise<PublishLedgerClaim> {
  const token = randomUUID();
  const { data, error } = await supabase.rpc('claim_publish_ledger', {
    p_key: publishLedgerKey(input.scopeKey, input.provider, input.accountId),
    p_provider: input.provider,
    p_account_id: input.accountId,
    p_user_id: input.userId,
    p_lease_seconds: PUBLISH_LEDGER_LEASE_SECONDS,
    p_token: token,
  });
  // supabase-js rpc() never throws — always check the error.
  if (error) throw new Error(`claim_publish_ledger failed: ${error.message}`);
  if (!isRecord(data)) throw new Error('claim_publish_ledger returned no result');
  const outcome = data.outcome;
  if (outcome === 'claimed') return { outcome, claimToken: token, result: null };
  if (outcome === 'published') {
    return { outcome, claimToken: null, result: toAccountResult(data.result, input.accountId) };
  }
  if (outcome === 'in_progress') return { outcome, claimToken: null, result: null };
  throw new Error(`claim_publish_ledger returned unknown outcome: ${String(outcome)}`);
}

export interface RecordPublishAttemptInput {
  scopeKey: string;
  provider: string;
  accountId: string;
  claimToken: string;
  accountResult: ContentUploadAccountResult;
}

// Records the outcome of a claimed attempt. Returns false instead of
// throwing when the record is lost: the publish already happened, so the
// result still goes back to the caller — and the engine's own recorded
// success (issue #500) keeps that account from retrying. A lost record
// only matters if the caller also times out, so it is logged loudly.
export async function recordPublishAttempt(
  supabase: SupabaseClient,
  input: RecordPublishAttemptInput,
): Promise<boolean> {
  const { data, error } = await supabase.rpc('record_publish_ledger', {
    p_key: publishLedgerKey(input.scopeKey, input.provider, input.accountId),
    p_token: input.claimToken,
    p_status: input.accountResult.success ? 'published' : 'failed',
    p_result: input.accountResult.success ? input.accountResult : null,
    p_error: input.accountResult.success ? null : (input.accountResult.error ?? 'upload failed'),
    p_error_code: input.accountResult.success ? null : (input.accountResult.errorCode ?? null),
  });
  if (error) {
    logger.error('[publish-ledger] record failed', error, {
      key: publishLedgerKey(input.scopeKey, input.provider, input.accountId),
    });
    return false;
  }
  if (data !== true) {
    logger.error('[publish-ledger] record lost: claim no longer held', null, {
      key: publishLedgerKey(input.scopeKey, input.provider, input.accountId),
    });
    return false;
  }
  return true;
}

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

/** The per-account answer while an earlier request is still publishing it. */
export function publishInProgressResult(accountId: string): ContentUploadAccountResult {
  return accountFailure(
    accountId,
    new Error('Publish still in progress from an earlier request.'),
    'publish_in_progress',
  );
}

export function createPublishLedgerClient(): SupabaseClient {
  return createSupabaseServiceClient();
}

export interface PublishLedgerPartition {
  scopeKey: string;
  provider: SocialProvider;
  /** Accounts this request may publish (claim held, fenced by the token). */
  granted: Array<{ accountId: string; claimToken: string }>;
  /** Already-published accounts with their recorded results. */
  replayed: ContentUploadAccountResult[];
  /** Accounts still publishing under an earlier request. */
  waiting: ContentUploadAccountResult[];
  /** FormData carrying only the granted accounts, for the handler. */
  formData: FormData;
}

// Splits one upload-content call into the accounts this request may
// publish, the ones already published (replayed from the ledger), and the
// ones still in flight. The handler only ever sees granted accounts: a
// replayed or waiting account never reaches the provider again.
export async function partitionPublishAccounts(
  supabase: SupabaseClient,
  scopeKey: string,
  provider: SocialProvider,
  userId: string,
  formData: FormData,
): Promise<PublishLedgerPartition> {
  const field = PUBLISH_ACCOUNT_FIELDS[provider];
  const accountIds = getAccountIdsFromFormData(formData, field);
  const granted: PublishLedgerPartition['granted'] = [];
  const replayed: ContentUploadAccountResult[] = [];
  const waiting: ContentUploadAccountResult[] = [];
  for (const accountId of accountIds) {
    const claim = await claimPublishAttempt(supabase, { scopeKey, provider, accountId, userId });
    if (claim.outcome === 'claimed' && claim.claimToken !== null) {
      granted.push({ accountId, claimToken: claim.claimToken });
    } else if (claim.outcome === 'published' && claim.result !== null) {
      replayed.push(claim.result);
    } else {
      waiting.push(publishInProgressResult(accountId));
    }
  }
  const next = new FormData();
  formData.forEach((value, key) => {
    if (key !== field) next.append(key, value);
  });
  for (const { accountId } of granted) next.append(field, accountId);
  return { scopeKey, provider, granted, replayed, waiting, formData: next };
}

function isAccountResult(value: unknown): value is ContentUploadAccountResult {
  return (
    isRecord(value) && typeof value.accountId === 'string' && typeof value.success === 'boolean'
  );
}

// Records the handler's outcome for every account this request claimed.
// An account the handler never reported keeps its claim: the outcome is
// unknown, so the lease expiry — not a recorded failure — is the recovery.
export async function recordPartitionResults(
  supabase: SupabaseClient,
  partition: PublishLedgerPartition,
  results: unknown,
): Promise<void> {
  if (!Array.isArray(results)) return;
  const byAccount = new Map<string, ContentUploadAccountResult>();
  for (const item of results) {
    if (isAccountResult(item)) byAccount.set(item.accountId, item);
  }
  for (const granted of partition.granted) {
    const result = byAccount.get(granted.accountId);
    if (result === undefined) continue;
    await recordPublishAttempt(supabase, {
      scopeKey: partition.scopeKey,
      provider: partition.provider,
      accountId: granted.accountId,
      claimToken: granted.claimToken,
      accountResult: result,
    });
  }
}

// One results list for the caller: replayed posts first, then accounts
// still in flight, then what the handler just published.
export function mergePartitionResults(
  partition: PublishLedgerPartition,
  results: unknown,
): ContentUploadAccountResult[] {
  const handlerResults = Array.isArray(results) ? results.filter(isAccountResult) : [];
  return [...partition.replayed, ...partition.waiting, ...handlerResults];
}
