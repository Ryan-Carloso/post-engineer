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
// attempt or an expired lease — claims a fresh attempt. A post whose
// record is lost after retries parks its claim as unknown instead: the
// post may already be live, so no retry may ever claim it again — the
// account waits for a human to verify it on the provider first. Only the
// request that holds the lease can record, so a first attempt whose lease
// was taken over cannot overwrite the winner's post.
//
// The key comes from the caller: the engine sends
// `slot:<slotId>:video:<name>` (deterministic across retries of the same
// slot/video); a direct caller sends `direct:<key>`. A request without a
// scope key publishes exactly as before, with no ledger.
//---------------

// The lease bounds how long a retry waits before taking over a claim.
// The holder renews it while it publishes (startLedgerHeartbeat in
// publish-ledger-heartbeat.ts), so a takeover only happens when the
// holder is gone — no heartbeat for a full lease. A publish that runs longer than the lease (Fanvue is
// unbounded: up to 256 parts at 10 min each) is never taken over while
// it is still alive. The 30 minutes matches the engine's slot park
// (ATTEMPT_LEASE_SECONDS in fill_schedule/account_outcomes.py): a retry
// inside the lease waits instead of posting again.
export const PUBLISH_LEDGER_LEASE_SECONDS = 30 * 60;

/** The web route is still publishing this account under an earlier request. */
export const PUBLISH_IN_PROGRESS_CODE = 'publish_in_progress';

/** The post may already be live, but its record was lost: never re-post it. */
export const PUBLISH_UNKNOWN_CODE = 'publish_unknown';

// The ledger rows' status values, mirroring the
// publish_ledger_status_check constraint in migration 061 (extended with
// 'unknown' by migration 062).
export const PUBLISH_LEDGER_STATUSES = ['in_progress', 'published', 'failed', 'unknown'] as const;

export type PublishLedgerOutcome = 'claimed' | 'published' | 'in_progress' | 'unknown';

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
  if (outcome === 'unknown') return { outcome, claimToken: null, result: null };
  if (outcome === 'in_progress') return { outcome, claimToken: null, result: null };
  if (outcome === 'forbidden') {
    throw new Error('claim_publish_ledger returned forbidden: scope key belongs to another user');
  }
  throw new Error(`claim_publish_ledger returned unknown outcome: ${String(outcome)}`);
}

export interface RecordPublishAttemptInput {
  scopeKey: string;
  provider: string;
  accountId: string;
  claimToken: string;
  accountResult: ContentUploadAccountResult;
}

// Delays between record attempts: a single transient RPC error must not
// park a publish as unknown. The budget stays under a second: the record
// is a local Postgres RPC, and the caller is already a long publish.
export const PUBLISH_LEDGER_RECORD_RETRY_DELAYS_MS = [100, 400];

export interface RecordAttemptOptions {
  /** Total attempts including the first (default: delays + 1). */
  maxAttempts?: number;
  /** Injectable for tests; defaults to a real setTimeout. */
  sleep?: (milliseconds: number) => Promise<void>;
}

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function recordOptions(options: RecordAttemptOptions): {
  maxAttempts: number;
  sleep: (milliseconds: number) => Promise<void>;
} {
  return {
    maxAttempts: options.maxAttempts ?? PUBLISH_LEDGER_RECORD_RETRY_DELAYS_MS.length + 1,
    sleep: options.sleep ?? defaultSleep,
  };
}

// Calls a ledger RPC with bounded retries. Only a transient RPC error is
// retried: a fencing rejection (data !== true — the claim is no longer
// held) is final at once, because no retry can re-win a lost claim.
// Returns true only when the RPC applied.
async function callLedgerRpcWithRetries(
  supabase: SupabaseClient,
  fn: string,
  args: Record<string, unknown>,
  logLabel: string,
  options: RecordAttemptOptions,
): Promise<boolean> {
  const { maxAttempts, sleep } = recordOptions(options);
  const key = typeof args.p_key === 'string' ? args.p_key : '';
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const { data, error } = await supabase.rpc(fn, args);
    if (error) {
      logger.error(`[publish-ledger] ${logLabel} failed`, error, { key });
      if (attempt < maxAttempts) {
        await sleep(PUBLISH_LEDGER_RECORD_RETRY_DELAYS_MS[attempt - 1] ?? 0);
        continue;
      }
      return false;
    }
    if (data !== true) {
      logger.error(`[publish-ledger] ${logLabel} lost: claim no longer held`, null, { key });
      return false;
    }
    return true;
  }
  return false;
}

// Records the outcome of a claimed attempt. Returns false instead of
// throwing when the record is lost: the publish already happened, so the
// result still goes back to the caller — and the engine's own recorded
// success (issue #500) keeps that account from retrying. A lost record
// only matters if the caller also times out, so it is logged loudly.
export async function recordPublishAttempt(
  supabase: SupabaseClient,
  input: RecordPublishAttemptInput,
  options: RecordAttemptOptions = {},
): Promise<boolean> {
  return callLedgerRpcWithRetries(
    supabase,
    'record_publish_ledger',
    {
      p_key: publishLedgerKey(input.scopeKey, input.provider, input.accountId),
      p_token: input.claimToken,
      p_status: input.accountResult.success ? 'published' : 'failed',
      p_result: input.accountResult.success ? input.accountResult : null,
      p_error: input.accountResult.success ? null : (input.accountResult.error ?? 'upload failed'),
      p_error_code: input.accountResult.success ? null : (input.accountResult.errorCode ?? null),
    },
    'record',
    options,
  );
}

export interface MarkPublishUnknownInput {
  scopeKey: string;
  provider: string;
  accountId: string;
  claimToken: string;
  /** Why the outcome is unknown; stored on the row for the human check. */
  error: string;
}

// Parks a claim whose post succeeded but whose record is lost, even after
// retries: the post may already be live, so no later retry may claim a
// fresh publish for this key. Only the token holder can park, and only
// from in_progress — a row the winner already recorded is untouched.
// Returns false instead of throwing when the park itself is lost: the row
// stays in_progress, and the lease expiry remains the (unsafe) recovery.
export async function markPublishUnknown(
  supabase: SupabaseClient,
  input: MarkPublishUnknownInput,
  options: RecordAttemptOptions = {},
): Promise<boolean> {
  return callLedgerRpcWithRetries(
    supabase,
    'mark_publish_unknown',
    {
      p_key: publishLedgerKey(input.scopeKey, input.provider, input.accountId),
      p_token: input.claimToken,
      p_error: input.error,
    },
    'mark unknown',
    options,
  );
}

/** The per-account answer while an earlier request is still publishing it. */
export function publishInProgressResult(accountId: string): ContentUploadAccountResult {
  return accountFailure(
    accountId,
    new Error('Publish still in progress from an earlier request.'),
    'publish_in_progress',
  );
}

/** The per-account answer when the post may already be live but its record was lost. */
export function publishUnknownResult(accountId: string): ContentUploadAccountResult {
  return accountFailure(
    accountId,
    new Error(
      'Publish result could not be recorded — this account may already have published. ' +
        'Check the provider before posting again.',
    ),
    'publish_unknown',
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
  /** Accounts parked as unknown: possibly published, never re-posted. */
  unknown: ContentUploadAccountResult[];
  /** FormData carrying only the granted accounts, for the handler. */
  formData: FormData;
}

// Splits one upload-content call into the accounts this request may
// publish, the ones already published (replayed from the ledger), the
// ones still in flight, and the ones parked as unknown. The handler only
// ever sees granted accounts: a replayed, waiting, or unknown account
// never reaches the provider again.
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
  const unknown: ContentUploadAccountResult[] = [];
  try {
    for (const accountId of accountIds) {
      const claim = await claimPublishAttempt(supabase, { scopeKey, provider, accountId, userId });
      if (claim.outcome === 'claimed' && claim.claimToken !== null) {
        granted.push({ accountId, claimToken: claim.claimToken });
      } else if (claim.outcome === 'published' && claim.result !== null) {
        replayed.push(claim.result);
      } else if (claim.outcome === 'unknown') {
        unknown.push(publishUnknownResult(accountId));
      } else {
        waiting.push(publishInProgressResult(accountId));
      }
    }
  } catch (error) {
    // Nothing was published yet: release what this request already
    // granted so the next retry proceeds at once instead of waiting out
    // the 30-minute lease with no heartbeat. The release never throws
    // (recordPublishAttempt returns false on a lost record), so the
    // original claim error still surfaces.
    await Promise.all(
      granted.map((item) =>
        recordPublishAttempt(supabase, {
          scopeKey,
          provider,
          accountId: item.accountId,
          claimToken: item.claimToken,
          accountResult: {
            accountId: item.accountId,
            success: false,
            error: 'claim phase failed',
            errorCode: 'transient',
          },
        }),
      ),
    );
    throw error;
  }
  const next = new FormData();
  formData.forEach((value, key) => {
    if (key !== field) next.append(key, value);
  });
  for (const { accountId } of granted) next.append(field, accountId);
  return { scopeKey, provider, granted, replayed, waiting, unknown, formData: next };
}

function isAccountResult(value: unknown): value is ContentUploadAccountResult {
  return (
    isRecord(value) && typeof value.accountId === 'string' && typeof value.success === 'boolean'
  );
}

// Records the handler's outcome for every account this request claimed.
// Returns the accounts whose SUCCESS result could not be recorded, even
// after retries: the post may already be live, so the caller parks them
// as unknown instead of letting a later retry claim a fresh publish.
// A failed result that could not be recorded is not returned: nothing
// was published, so the lease expiry stays the safe recovery.
// An account the handler never reported keeps its claim: the outcome is
// unknown, so the lease expiry — not a recorded failure — is the recovery.
export async function recordPartitionResults(
  supabase: SupabaseClient,
  partition: PublishLedgerPartition,
  results: unknown,
): Promise<string[]> {
  if (!Array.isArray(results)) return [];
  const byAccount = new Map<string, ContentUploadAccountResult>();
  for (const item of results) {
    if (isAccountResult(item)) byAccount.set(item.accountId, item);
  }
  const unrecorded: string[] = [];
  for (const granted of partition.granted) {
    const result = byAccount.get(granted.accountId);
    if (result === undefined) continue;
    const recorded = await recordPublishAttempt(supabase, {
      scopeKey: partition.scopeKey,
      provider: partition.provider,
      accountId: granted.accountId,
      claimToken: granted.claimToken,
      accountResult: result,
    });
    if (!recorded && result.success === true) unrecorded.push(granted.accountId);
  }
  return unrecorded;
}

// A request-level rejection (a failure carrying no accountId) means the
// handler validated the request before publishing anything: every
// `accountFailure('', ...)` / `rejected(...)` site is a pre-publish check
// (missing account ids, caption, title, video file, overlong text, non-MP4).
// Nothing was published, so release the granted claims as failed — like the
// handler-throw path — instead of parking them for the full lease: a
// same-key retry after fixing the request proceeds at once.
// An account the handler never reported keeps its claim (see above): its
// outcome is unknown, so only the explicit empty-accountId rejection
// releases claims here.
export async function releaseClaimsForRequestRejection(
  supabase: SupabaseClient,
  partition: PublishLedgerPartition,
  results: unknown,
): Promise<void> {
  if (!Array.isArray(results)) return;
  const rejection = results.find(
    (item) => isAccountResult(item) && item.accountId === '' && item.success === false,
  );
  if (rejection === undefined) return;
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
          error:
            typeof rejection.error === 'string'
              ? rejection.error
              : 'request rejected before publish',
          errorCode:
            typeof rejection.errorCode === 'string' ? rejection.errorCode : 'publish_rejected',
        },
      }),
    ),
  );
}

// One results list for the caller: replayed posts first, then accounts
// still in flight, then accounts parked as unknown, then what the handler
// just published.
export function mergePartitionResults(
  partition: PublishLedgerPartition,
  results: unknown,
): ContentUploadAccountResult[] {
  const handlerResults = Array.isArray(results) ? results.filter(isAccountResult) : [];
  return [...partition.replayed, ...partition.waiting, ...partition.unknown, ...handlerResults];
}
