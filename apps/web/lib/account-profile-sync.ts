import type { SupabaseClient } from '@supabase/supabase-js';
import { updateSocialAccountMetadata, getSocialAccountTokens, type SocialAccountRecord } from './social-accounts';
import { PROFILE_SOURCES, type FetchedProfile } from './account-profile-sources';
import { pictureUrlExpired } from './account-display-diagnostics';
import { classifyAccountBreak } from './account-break';
import { reportProfileFetched, reportProfileFetchFailed } from './account-profile-telemetry';
import { logger } from './logger';
import { notifyAccountBreak } from './owner-alert-mail';

export const ACCOUNT_PROFILE_SYNC_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const ACCOUNT_PROFILE_SYNC_FAILURE_COOLDOWN_MS = 60 * 60 * 1000;

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'Error';
}

function reportOwnerAccountBreak(record: SocialAccountRecord, error: unknown): void {
  if (classifyAccountBreak(error) === null) return;
  const pending = notifyAccountBreak({
    userId: record.userId,
    provider: record.provider,
    accountId: record.providerAccountId,
    socialAccountId: record.id,
    accountName: record.accountName,
    error,
  });
  if (pending && typeof pending.catch === 'function') {
    void pending.catch((notifyError: unknown) => {
      logger.error('[ACCOUNT] Owner alert failed', new Error(errorName(notifyError)));
    });
  }
}

export interface AccountProfileSyncOptions {
  now?: () => Date;
}

function failureCooldownActive(record: SocialAccountRecord, now: Date): boolean {
  const failedAt = record.accountMetadata.profileSyncFailedAt;
  if (typeof failedAt !== 'string') return false;
  const failedAtMs = Date.parse(failedAt);
  return Number.isFinite(failedAtMs) && now.getTime() - failedAtMs < ACCOUNT_PROFILE_SYNC_FAILURE_COOLDOWN_MS;
}

const CREDENTIAL_FAILURE_REASONS: ReadonlySet<string> = new Set([
  'unauthorized',
  'token_undecryptable',
  'TokenDecryptError',
]);

function isHeldCredentialFailure(error: unknown): boolean {
  const reason = classifyAccountBreak(error);
  return reason !== null && CREDENTIAL_FAILURE_REASONS.has(reason);
}

export function credentialFailureHeld(record: SocialAccountRecord, now: Date): boolean {
  const reason = record.accountMetadata.profileSyncFailedReason;
  return failureCooldownActive(record, now) && typeof reason === 'string' && CREDENTIAL_FAILURE_REASONS.has(reason);
}

export function profileNeedsSync(record: SocialAccountRecord, pictureKey: string, now: Date): boolean {
  if (failureCooldownActive(record, now)) return false;
  const syncedAt = record.accountMetadata.profileSyncedAt;
  if (typeof syncedAt !== 'string') return true;
  const syncedAtMs = Date.parse(syncedAt);
  if (!Number.isFinite(syncedAtMs)) return true;
  if (now.getTime() - syncedAtMs > ACCOUNT_PROFILE_SYNC_MAX_AGE_MS) return true;
  const picture = record.accountMetadata[pictureKey];
  return typeof picture === 'string' && pictureUrlExpired(picture, now.getTime());
}

export function mergeProfileMetadata(
  stored: Record<string, unknown>,
  fetched: FetchedProfile,
  now: Date,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...stored };
  for (const [key, value] of Object.entries(fetched.metadata)) {
    if (value !== null && value !== undefined) merged[key] = value;
  }
  merged.profileSyncedAt = now.toISOString();
  delete merged.profileSyncFailedAt;
  delete merged.profileSyncFailedReason;
  return merged;
}

async function writeFailureMarker(
  supabase: SupabaseClient,
  userId: string,
  record: SocialAccountRecord,
  error: unknown,
  now: Date,
): Promise<void> {
  const metadata = {
    ...record.accountMetadata,
    profileSyncFailedAt: now.toISOString(),
    profileSyncFailedReason: classifyAccountBreak(error) ?? errorName(error),
  };
  try {
    await updateSocialAccountMetadata(supabase, userId, record.provider, record.providerAccountId, metadata);
  } catch (markerError) {
    logger.error('[ACCOUNT] Profile sync failure marker write failed', markerError, {
      recordId: record.id,
      provider: record.provider,
    });
  }
}

async function probeStoredCredential(
  supabase: SupabaseClient,
  userId: string,
  record: SocialAccountRecord,
  now: Date,
): Promise<void> {
  try {
    await getSocialAccountTokens(supabase, userId, record.provider, record.providerAccountId);
  } catch (error) {
    reportProfileFetchFailed(record.provider, 'sync', error);
    reportOwnerAccountBreak(record, error);
    if (isHeldCredentialFailure(error)) {
      await writeFailureMarker(supabase, userId, record, error, now);
    }
    throw error;
  }
}

export async function syncAccountProfile(
  supabase: SupabaseClient,
  userId: string,
  record: SocialAccountRecord,
  options: AccountProfileSyncOptions = {},
): Promise<SocialAccountRecord> {
  const source = PROFILE_SOURCES[record.provider];
  if (source === undefined) {
    return record;
  }
  const now = (options.now ?? (() => new Date()))();
  if (credentialFailureHeld(record, now)) {
    return record;
  }
  if (!source.applies(record) || !profileNeedsSync(record, source.pictureKey, now)) {
    await probeStoredCredential(supabase, userId, record, now);
    return record;
  }

  let fetched: FetchedProfile;
  try {
    fetched = await source.fetch(supabase, userId, record);
  } catch (error) {
    reportProfileFetchFailed(record.provider, 'sync', error);
    reportOwnerAccountBreak(record, error);
    await writeFailureMarker(supabase, userId, record, error, now);
    throw error;
  }

  if (record.provider === 'bluesky') {
    await probeStoredCredential(supabase, userId, record, now);
  }

  const previousPicture = record.accountMetadata[source.pictureKey];
  reportProfileFetched(record.provider, 'sync', fetched, {
    accountName: record.accountName,
    pictureUrl: typeof previousPicture === 'string' ? previousPicture : null,
  });

  const metadata = mergeProfileMetadata(record.accountMetadata, fetched, now);
  const accountName = fetched.accountName ?? record.accountName;
  await updateSocialAccountMetadata(
    supabase,
    userId,
    record.provider,
    record.providerAccountId,
    metadata,
    fetched.accountName ?? undefined,
  );

  logger.info('[ACCOUNT] Profile synced', {
    recordId: record.id,
    provider: record.provider,
    nameChanged: accountName !== record.accountName,
  });

  return { ...record, accountName, accountMetadata: metadata };
}
