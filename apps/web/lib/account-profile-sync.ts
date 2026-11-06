//---------------
// Keeps every stored social account's public profile (name, picture) in
// sync with its provider. Connect stores the profile once; without a resync
// a rename or a new picture never reaches the accounts page, and signed CDN
// picture URLs (Instagram/Threads `oe`) stop loading once they expire.
// GET /api/account calls this per row: it rereads the provider when the row
// was never synced, the last sync is older than ACCOUNT_PROFILE_SYNC_MAX_AGE_MS,
// or the stored picture URL expired. Readers live in account-profile-sources.ts.
//---------------

import type { SupabaseClient } from '@supabase/supabase-js';
import { updateSocialAccountMetadata, type SocialAccountRecord } from './social-accounts';
import { PROFILE_SOURCES, type FetchedProfile } from './account-profile-sources';
import { pictureUrlExpired } from './account-display-diagnostics';
import { reportProfileFetched, reportProfileFetchFailed } from './account-profile-telemetry';
import { logger } from './logger';

export const ACCOUNT_PROFILE_SYNC_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface AccountProfileSyncOptions {
  now?: () => Date;
}

//---------------
// profileNeedsSync — pure decision. A row that was synced recently is left
// alone even if it has no picture (the account may simply have none), so a
// picture-less account costs one provider read per day, not one per list.
//---------------
export function profileNeedsSync(record: SocialAccountRecord, pictureKey: string, now: Date): boolean {
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
  return merged;
}

//---------------
// syncAccountProfile — returns the record to render: the updated one, or the
// original when no sync is needed. Throws on credential/provider/DB failure
// (reported to PostHog first); the caller logs and keeps the stored record.
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
