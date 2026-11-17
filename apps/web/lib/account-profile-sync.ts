//---------------
// Keeps every stored social account's public profile (name, picture) in
// sync with its provider. Connect stores the profile once; without a resync
// a rename or a new picture never reaches the accounts page, and signed CDN
// picture URLs (Instagram/Threads `oe`) stop loading once they expire.
// GET /api/account calls this per row: it rereads the provider when the row
// was never synced, the last sync is older than ACCOUNT_PROFILE_SYNC_MAX_AGE_MS,
// or the stored picture URL expired. A failed read is reported, records a
// failure marker (profileSyncFailedAt in account_metadata), and is rethrown:
// the next list skips the row while the marker is younger than
// ACCOUNT_PROFILE_SYNC_FAILURE_COOLDOWN_MS, so a broken account costs at most
// one provider read per cooldown window instead of one per list. A successful
// sync clears the marker.
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
export const ACCOUNT_PROFILE_SYNC_FAILURE_COOLDOWN_MS = 60 * 60 * 1000;

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
// failureCooldownActive — true while the row's last failed fetch is younger
// than ACCOUNT_PROFILE_SYNC_FAILURE_COOLDOWN_MS. An unparseable marker is
// ignored and never blocks a sync.
//---------------
function failureCooldownActive(record: SocialAccountRecord, now: Date): boolean {
  const failedAt = record.accountMetadata.profileSyncFailedAt;
  if (typeof failedAt !== 'string') return false;
  const failedAtMs = Date.parse(failedAt);
  return Number.isFinite(failedAtMs) && now.getTime() - failedAtMs < ACCOUNT_PROFILE_SYNC_FAILURE_COOLDOWN_MS;
}

// Marker reasons that mean a dead credential: the same failures the
// accounts route flags as 'error' (isUnauthorizedError -> 'unauthorized',
// TokenDecryptError -> 'token_undecryptable', or its name when the break
// classifier skips a key misconfiguration).
const CREDENTIAL_FAILURE_REASONS: ReadonlySet<string> = new Set([
  'unauthorized',
  'token_undecryptable',
  'TokenDecryptError',
]);

//---------------
// credentialFailureHeld — true while a row sits in the failure cooldown
// because its last fetch hit a dead credential. Inside the cooldown no
// fetch runs and nothing throws, so without this the accounts route would
// show a dead account as healthy until the cooldown expires.
//---------------
export function credentialFailureHeld(record: SocialAccountRecord, now: Date): boolean {
  const reason = record.accountMetadata.profileSyncFailedReason;
  return failureCooldownActive(record, now) && typeof reason === 'string' && CREDENTIAL_FAILURE_REASONS.has(reason);
}

//---------------
// profileNeedsSync — pure decision. A row that was synced recently is left
// alone even if it has no picture (the account may simply have none), so a
// picture-less account costs one provider read per day, not one per list.
// A row whose last fetch failed inside the failure cooldown is also left
// alone, even if it was never synced or its picture expired: retrying it on
// every list buys nothing until the provider recovers. An unparseable
// marker is ignored and never blocks a sync.
//---------------
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

//---------------
// mergeProfileMetadata — fetched fields over stored ones; a field the
// provider did not return (null/undefined) keeps the stored value. A
// successful sync clears the failure marker, so the row is not held in
// cooldown by an older failure.
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
  delete merged.profileSyncFailedReason;
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
// writeFailureMarker — best-effort failure marker in account_metadata.
// The reason is a stable short class (the account-break class, else the
// error name): never raw provider text or tokens. A failed marker write is
// logged and swallowed so it can never replace the original fetch error.
//---------------
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

//---------------
// syncAccountProfile — returns the record to render: the updated one, or the
// original when no sync is needed. Throws on credential/provider/DB failure
// (reported to PostHog first); on failure only the failure marker is written,
// so the next list backs off instead of retrying immediately — the caller
// logs and keeps the stored record.
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
    await writeFailureMarker(supabase, userId, record, error, now);
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
