//---------------
// Keeps every stored social account's public profile (name, picture) in
// sync with its provider. Connect stores the profile once; without a resync
// a rename or a new picture never reaches the accounts page, and signed CDN
// picture URLs (Instagram/Threads `oe`) stop loading once they expire.
// GET /api/account calls this per row: it rereads the provider when the row
// was never synced, the last sync is older than ACCOUNT_PROFILE_SYNC_MAX_AGE_MS,
// or the stored picture URL expired. A failed read stamps profileSyncFailedAt
// and is not retried for ACCOUNT_PROFILE_SYNC_FAILED_BACKOFF_MS, so a row
// whose grant stays broken costs one provider read per hour, not one per
// list. Readers live in account-profile-sources.ts.
//---------------

import type { SupabaseClient } from '@supabase/supabase-js';
import { getSocialAccountTokens, updateSocialAccountMetadata, type SocialAccountRecord } from './social-accounts';
import { PROFILE_SOURCES, type FetchedProfile } from './account-profile-sources';
import { pictureUrlExpired } from './account-display-diagnostics';
import { reportProfileFetched, reportProfileFetchFailed } from './account-profile-telemetry';
import { logger } from './logger';

export const ACCOUNT_PROFILE_SYNC_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const ACCOUNT_PROFILE_SYNC_FAILED_BACKOFF_MS = 60 * 60 * 1000;

export interface AccountProfileSyncOptions {
  now?: () => Date;
}

//---------------
// profileNeedsSync — pure decision. A row that was synced recently is left
// alone even if it has no picture (the account may simply have none), so a
// picture-less account costs one provider read per day, not one per list.
// A recent failure suppresses the retry even for a never-synced or stale
// row: the failure stamp is the freshest signal, and a permanently broken
// grant must not pay a token refresh plus a provider call on every list.
//---------------
export function profileNeedsSync(record: SocialAccountRecord, pictureKey: string, now: Date): boolean {
  const failedAt = record.accountMetadata.profileSyncFailedAt;
  if (typeof failedAt === 'string') {
    const failedAtMs = Date.parse(failedAt);
    if (Number.isFinite(failedAtMs) && now.getTime() - failedAtMs < ACCOUNT_PROFILE_SYNC_FAILED_BACKOFF_MS) return false;
  }
  const syncedAt = record.accountMetadata.profileSyncedAt;
  if (typeof syncedAt !== 'string') return true;
  const syncedAtMs = Date.parse(syncedAt);
  if (!Number.isFinite(syncedAtMs)) return true;
  if (now.getTime() - syncedAtMs > ACCOUNT_PROFILE_SYNC_MAX_AGE_MS) return true;
  const picture = record.accountMetadata[pictureKey];
  return typeof picture === 'string' && pictureUrlExpired(picture, now.getTime());
}

//---------------
// mergeProfileMetadata — fetched fields over stored ones; a field the
// provider did not return (null/undefined) keeps the stored value.
// A successful sync clears the failure marker, so the next stale cycle
// retries instead of carrying a dead stamp.
//---------------
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
  return merged;
}

//---------------
// syncAccountProfile — returns the record to render: the updated one, or the
// original when no sync is needed. Throws on credential/provider/DB failure
// (reported to PostHog first); the failure time is persisted first, so the
// next list backs off instead of retrying the same broken grant — the
// caller logs and keeps the stored record. A marker write that itself
// fails is logged, never a second throw: the original error is the one
// the caller must see.
//---------------
export async function syncAccountProfile(
  supabase: SupabaseClient,
  userId: string,
  record: SocialAccountRecord,
  options: AccountProfileSyncOptions = {},
): Promise<SocialAccountRecord> {
  const source = PROFILE_SOURCES[record.provider];
  if (source === undefined) {
    // provider is check-constrained to SOCIAL_PROVIDERS (migration 037);
    // rows outside the registry can only predate it. The route's
    // registry mapping drops them with its own log — the resync leaves
    // the record untouched instead of throwing past its own try/catch.
    return record;
  }
  if (!source.applies(record)) return record;
  const now = (options.now ?? (() => new Date()))();
  if (!profileNeedsSync(record, source.pictureKey, now)) return record;

  let fetched: FetchedProfile;
  try {
    fetched = await source.fetch(supabase, userId, record);
  } catch (error) {
    reportProfileFetchFailed(record.provider, 'sync', error);
    try {
      // Re-read the row instead of spreading the pre-read snapshot: a
      // concurrent request may have repaired the row (or a reconnect may
      // have rewritten it) during the provider read, and writing the
      // snapshot back would revert that work and freeze the row for an
      // hour. The fresh metadata keeps any concurrent success; only the
      // failure marker is added. A re-read that itself fails is logged
      // below and the original error is still the one rethrown.
      const { account } = await getSocialAccountTokens(supabase, userId, record.provider, record.providerAccountId);
      await updateSocialAccountMetadata(supabase, userId, record.provider, record.providerAccountId, {
        ...account.accountMetadata,
        profileSyncFailedAt: now.toISOString(),
      });
    } catch (writeError) {
      logger.error(
        '[ACCOUNT] Profile sync failure marker not saved',
        writeError instanceof Error ? writeError.message : writeError,
        { recordId: record.id, provider: record.provider },
      );
    }
    throw error;
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
