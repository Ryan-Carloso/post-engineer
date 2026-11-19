import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { PUBLISH_ACCOUNT_FIELDS } from '@/lib/contracts/providers';
import type { SocialProvider } from '@/lib/providers/registry';
import { accountFailure } from '@/lib/upload/account-error';
import { getAccountIdsFromFormData } from '@/lib/upload/account-utils';
import type { ContentUploadAccountResult } from '@/lib/upload/content-upload-result';

export const PUBLISH_LEDGER_LEASE_SECONDS = 30 * 60;

export const PUBLISH_IN_PROGRESS_CODE = 'publish_in_progress';

export const PUBLISH_UNKNOWN_CODE = 'publish_unknown';

export const PUBLISH_LEDGER_STATUSES = ['in_progress', 'published', 'failed', 'unknown'] as const;

export type PublishLedgerOutcome = 'claimed' | 'published' | 'in_progress' | 'unknown';

export interface PublishLedgerClaim {
  outcome: PublishLedgerOutcome;
  claimToken: string | null;
  result: ContentUploadAccountResult | null;
}

export function publishLedgerKey(scopeKey: string, provider: string, accountId: string): string {
  return `publish:${scopeKey}:${provider}:${accountId}`;
}

const SCOPE_KEY_PATTERN = /^(slot:[^:\s]+:video:.+|direct:.+)$/;
export function isValidPublishScopeKey(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 200 && SCOPE_KEY_PATTERN.test(value);
}

// The multipart field each provider's accounts arrive under
// (PUBLISH_ACCOUNT_FIELDS, shared/contracts/providers.ts). Pinned to the
// handlers by publish-ledger.test.ts — a rename in a handler without a
// rename there would silently skip the ledger for that provider.

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

export const PUBLISH_LEDGER_RECORD_RETRY_DELAYS_MS = [100, 400];

export interface RecordAttemptOptions {
  maxAttempts?: number;
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
  error: string;
}

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

export function publishInProgressResult(accountId: string): ContentUploadAccountResult {
  return accountFailure(
    accountId,
    new Error('Publish still in progress from an earlier request.'),
    'publish_in_progress',
  );
}

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
  granted: Array<{ accountId: string; claimToken: string }>;
  replayed: ContentUploadAccountResult[];
  waiting: ContentUploadAccountResult[];
  unknown: ContentUploadAccountResult[];
  formData: FormData;
}

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

export function mergePartitionResults(
  partition: PublishLedgerPartition,
  results: unknown,
): ContentUploadAccountResult[] {
  const handlerResults = Array.isArray(results) ? results.filter(isAccountResult) : [];
  return [...partition.replayed, ...partition.waiting, ...partition.unknown, ...handlerResults];
}
