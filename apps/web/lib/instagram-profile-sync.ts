//---------------
// Keeps a stored Instagram account's public profile (username, name,
// picture, counters) in sync with Instagram. The OAuth callback stores the
// profile once; without a resync, a rename or a new profile picture on
// Instagram never reaches the accounts page, and the signed CDN picture URL
// stops loading after it expires. GET /api/account calls this per
// Instagram row: it refetches /me when the stored profile is stale (older
// than INSTAGRAM_PROFILE_SYNC_MAX_AGE_MS) or incomplete (fallback name,
// missing or expired picture).
//---------------

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  getSocialAccountTokens,
  updateSocialAccountMetadata,
  type SocialAccountRecord,
} from './social-accounts';
import { InstagramService } from './instagram';
import { INSTAGRAM_USERNAME_FALLBACK } from './providers/registry';
import { logger } from './logger';

export const INSTAGRAM_PROFILE_SYNC_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface InstagramProfileSyncOptions {
  now?: () => Date;
}

//---------------
// instagramPictureUrlExpired — Instagram CDN media URLs are signed and
// expire (param `oe` = Unix timestamp in hex).
//---------------
export function instagramPictureUrlExpired(url: string, now: Date): boolean {
  try {
    const oe = new URL(url).searchParams.get('oe');
    if (oe === null || oe === '') return false;
    const expiresAtMs = Number.parseInt(oe, 16) * 1000;
    return Number.isFinite(expiresAtMs) && expiresAtMs < now.getTime();
  } catch {
    return false;
  }
}

//---------------
// instagramProfileNeedsSync — pure decision: true when the stored profile is
// incomplete, has an expired picture, or was last synced too long ago.
//---------------
export function instagramProfileNeedsSync(record: SocialAccountRecord, now: Date): boolean {
  const accountName = record.accountName;
  if (accountName === null || accountName === undefined || accountName === '' || accountName === INSTAGRAM_USERNAME_FALLBACK) {
    return true;
  }
  const picture = record.accountMetadata.profilePictureUrl;
  if (typeof picture !== 'string' || picture === '' || instagramPictureUrlExpired(picture, now)) {
    return true;
  }
  const syncedAt = record.accountMetadata.profileSyncedAt;
  if (typeof syncedAt !== 'string') return true;
  const syncedAtMs = Date.parse(syncedAt);
  if (!Number.isFinite(syncedAtMs)) return true;
  return now.getTime() - syncedAtMs > INSTAGRAM_PROFILE_SYNC_MAX_AGE_MS;
}

//---------------
// syncInstagramProfile — refetches the profile when needed and persists it.
// Returns the record to render (the updated one, or the original when no sync
// was needed). Throws on token/Graph/DB failure; the caller logs and keeps
// the stored record. A username the Graph API did not return (fallback) never
// overwrites the stored account name.
//---------------
export async function syncInstagramProfile(
  supabase: SupabaseClient,
  userId: string,
  record: SocialAccountRecord,
  options: InstagramProfileSyncOptions = {},
): Promise<SocialAccountRecord> {
  const now = (options.now ?? (() => new Date()))();
  if (!instagramProfileNeedsSync(record, now)) return record;

  const { tokens } = await getSocialAccountTokens(supabase, userId, 'instagram', record.providerAccountId);
  const profile = await new InstagramService().getProfile(String(tokens.access_token));

  const usernameReturned = profile.username !== INSTAGRAM_USERNAME_FALLBACK;
  const accountName = usernameReturned ? profile.username : record.accountName;
  const metadata: Record<string, unknown> = {
    ...record.accountMetadata,
    profileSyncedAt: now.toISOString(),
  };
  if (usernameReturned) metadata.username = profile.username;
  if (profile.name !== undefined) metadata.name = profile.name;
  if (profile.profilePictureUrl !== undefined) metadata.profilePictureUrl = profile.profilePictureUrl;
  if (profile.followersCount !== undefined) metadata.followersCount = profile.followersCount;
  if (profile.mediaCount !== undefined) metadata.mediaCount = profile.mediaCount;

  await updateSocialAccountMetadata(
    supabase,
    userId,
    'instagram',
    record.providerAccountId,
    metadata,
    usernameReturned ? profile.username : undefined,
  );

  logger.info('[ACCOUNT] Instagram profile synced', {
    recordId: record.id,
    igUserId: record.providerAccountId,
    nameChanged: accountName !== record.accountName,
  });

  return { ...record, accountName, accountMetadata: metadata };
}
