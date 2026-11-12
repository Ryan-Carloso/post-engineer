//---------------
// Keeps every stored social account's public profile (name, picture) in
// sync with its provider. Connect stores the profile once; without a resync
// a rename or a new picture never reaches the accounts page, and signed CDN
// picture URLs (Instagram/Threads `oe`) stop loading once they expire.
// GET /api/account calls this per row: it rereads the provider when the row
// was never synced, the last sync is older than ACCOUNT_PROFILE_SYNC_MAX_AGE_MS,
// or the stored picture URL expired. A failed read is reported and rethrown
// with no write and no backoff: the next list retries the row immediately,
// so a fixed account shows up on the next page load.
// Readers live in account-profile-sources.ts.
//---------------

import type { SupabaseClient } from '@supabase/supabase-js';
import { updateSocialAccountMetadata, getSocialAccountTokens, type SocialAccountRecord } from './social-accounts';
import { PROFILE_SOURCES, type FetchedProfile } from './account-profile-sources';
import { pictureUrlExpired } from './account-display-diagnostics';
import { classifyAccountBreak } from './account-break';
import { reportProfileFetched, reportProfileFetchFailed } from './account-profile-telemetry';
import { logger } from './logger';
import { notifyAccountBreak } from './owner-alert-mail';

export const ACCOUNT_PROFILE_SYNC_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'Error';
}

//---------------
// reportOwnerAccountBreak — email the owner when this sync failure is one
// of the three account-break classes. Anything else (5xx, a revoked-token
// string that is not a 401, a network blip) stays telemetry-only. A mail
// failure is logged by name and never replaces the original error.
//---------------
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
// probeStoredCredential — decrypts the stored tokens without using them.
// Throws on an undecryptable blob, so the caller flags the card. A missing
// row also throws (AccountNotFoundError), but the route treats that as
// transient and keeps the card 'ok': the row is gone, not broken. Used on
// the paths whose fetch never reads the token: the ones that skip the fetch
// entirely, and Bluesky's fetch path (its public-profile fetch never
// touches the stored token).
//---------------
async function probeStoredCredential(
  supabase: SupabaseClient,
  userId: string,
  record: SocialAccountRecord,
): Promise<void> {
  try {
    await getSocialAccountTokens(supabase, userId, record.provider, record.providerAccountId);
  } catch (error) {
    // Same structured event as a failed profile fetch, so undecryptable
    // tokens show up in account_profile_fetch_failed (the route's logger
    // still reports the $exception as well, like the fetch path).
    reportProfileFetchFailed(record.provider, 'sync', error);
    reportOwnerAccountBreak(record, error);
    throw error;
  }
}

//---------------
// syncAccountProfile — returns the record to render: the updated one, or the
// original when no sync is needed. Throws on credential/provider/DB failure
// (reported to PostHog first); nothing is written on failure, so the next
// list retries the row — the caller logs and keeps the stored record.
// Rows that skip the fetch still probe the stored credential, and so does
// the Bluesky fetch path (its public-profile fetch never reads the token):
// an undecryptable token throws so the caller flags the card.
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
  if (!source.applies(record)) {
    // No profile fetch applies (Rumble, 3Speak, LinkedIn org pages), but
    // the stored credential is still probed: an undecryptable token throws
    // so the caller flags the card instead of showing it as healthy.
    await probeStoredCredential(supabase, userId, record);
    return record;
  }
  const now = (options.now ?? (() => new Date()))();
  if (!profileNeedsSync(record, source.pictureKey, now)) {
    // The profile is still fresh, so no fetch runs — but a token corrupted
    // since the last sync, or a Bluesky token (its public-profile fetch
    // never reads it), would render green without the probe.
    await probeStoredCredential(supabase, userId, record);
    return record;
  }

  let fetched: FetchedProfile;
  try {
    fetched = await source.fetch(supabase, userId, record);
  } catch (error) {
    reportProfileFetchFailed(record.provider, 'sync', error);
    reportOwnerAccountBreak(record, error);
    throw error;
  }

  // Bluesky's public-profile fetch never reads the stored token, so a
  // corrupted blob would pass the fetch and render green on every resync
  // due: probe it after the fetch succeeds, before anything is written.
  // Every other source decrypts inside its fetch, so no second probe.
  if (record.provider === 'bluesky') {
    await probeStoredCredential(supabase, userId, record);
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
