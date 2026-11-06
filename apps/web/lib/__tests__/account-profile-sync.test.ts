import { describe, it, expect, vi, beforeEach } from 'vitest';

const { sources } = vi.hoisted(() => ({
  sources: {} as Record<string, { pictureKey: string; applies: ReturnType<typeof vi.fn>; fetch: ReturnType<typeof vi.fn> }>,
}));
vi.mock('@/lib/account-profile-sources', () => ({ PROFILE_SOURCES: sources }));
vi.mock('@/lib/social-accounts', () => ({ updateSocialAccountMetadata: vi.fn(), getSocialAccountTokens: vi.fn() }));
vi.mock('@/lib/account-profile-telemetry', () => ({
  reportProfileFetched: vi.fn(),
  reportProfileFetchFailed: vi.fn(),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), error: vi.fn() } }));

import {
  ACCOUNT_PROFILE_SYNC_FAILED_BACKOFF_MS,
  ACCOUNT_PROFILE_SYNC_MAX_AGE_MS,
  mergeProfileMetadata,
  profileNeedsSync,
  syncAccountProfile,
} from '@/lib/account-profile-sync';
import { logger } from '@/lib/logger';
import { pictureUrlExpired } from '@/lib/account-display-diagnostics';
import { updateSocialAccountMetadata, getSocialAccountTokens, type SocialAccountRecord } from '@/lib/social-accounts';
import { reportProfileFetched, reportProfileFetchFailed } from '@/lib/account-profile-telemetry';

const NOW = new Date('2026-11-06T12:00:00.000Z');
const supabase = {} as never;
const hexSeconds = (ms: number): string => Math.floor(ms / 1000).toString(16);
const FRESH_PIC = `https://scontent.cdninstagram.com/p.jpg?oe=${hexSeconds(NOW.getTime() + 86_400_000)}`;
const EXPIRED_PIC = `https://scontent.cdninstagram.com/p.jpg?oe=${hexSeconds(NOW.getTime() - 1000)}`;
const RECENT = new Date(NOW.getTime() - 60_000).toISOString();
const STALE = new Date(NOW.getTime() - ACCOUNT_PROFILE_SYNC_MAX_AGE_MS - 1).toISOString();
const FAILED_RECENT = new Date(NOW.getTime() - 60_000).toISOString();
const FAILED_OLD = new Date(NOW.getTime() - ACCOUNT_PROFILE_SYNC_FAILED_BACKOFF_MS - 1).toISOString();

function record(overrides: Partial<SocialAccountRecord> = {}, metadata: Record<string, unknown> = {}): SocialAccountRecord {
  return {
    id: 'rec-1',
    userId: 'u1',
    provider: 'instagram',
    providerAccountId: 'ig-1',
    accountName: 'old_handle',
    accountMetadata: { profilePictureUrl: FRESH_PIC, profileSyncedAt: RECENT, ...metadata },
    tokenExpiresAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    lastUsedAt: null,
    ...overrides,
  };
}

describe('pictureUrlExpired', () => {
  it('is true only when the oe timestamp is in the past', () => {
    const nowMs = NOW.getTime();
    expect(pictureUrlExpired(EXPIRED_PIC, nowMs)).toBe(true);
    expect(pictureUrlExpired(FRESH_PIC, nowMs)).toBe(false);
  });

  it('is false for URLs without oe or unparseable URLs', () => {
    const nowMs = NOW.getTime();
    expect(pictureUrlExpired('https://cdn.bsky.app/a.jpg', nowMs)).toBe(false);
    expect(pictureUrlExpired('https://x.test/p.jpg?oe=', nowMs)).toBe(false);
    expect(pictureUrlExpired('not a url', nowMs)).toBe(false);
  });
});

describe('profileNeedsSync', () => {
  it('is false for a row synced within the max age with a valid picture', () => {
    expect(profileNeedsSync(record(), 'profilePictureUrl', NOW)).toBe(false);
  });

  it('is false for a recently synced row without a picture (the account may have none)', () => {
    expect(profileNeedsSync(record({}, { profilePictureUrl: undefined }), 'profilePictureUrl', NOW)).toBe(false);
  });

  it('is true when the row was never synced or the stamp is unparseable', () => {
    expect(profileNeedsSync(record({}, { profileSyncedAt: undefined }), 'profilePictureUrl', NOW)).toBe(true);
    expect(profileNeedsSync(record({}, { profileSyncedAt: 'garbage' }), 'profilePictureUrl', NOW)).toBe(true);
  });

  it('is true past the max age and false exactly at it', () => {
    expect(profileNeedsSync(record({}, { profileSyncedAt: STALE }), 'profilePictureUrl', NOW)).toBe(true);
    const edge = new Date(NOW.getTime() - ACCOUNT_PROFILE_SYNC_MAX_AGE_MS).toISOString();
    expect(profileNeedsSync(record({}, { profileSyncedAt: edge }), 'profilePictureUrl', NOW)).toBe(false);
  });

  it('is true when the picture under the given key expired', () => {
    expect(profileNeedsSync(record({}, { profilePictureUrl: EXPIRED_PIC }), 'profilePictureUrl', NOW)).toBe(true);
    expect(profileNeedsSync(record({}, { avatar: EXPIRED_PIC }), 'profilePictureUrl', NOW)).toBe(false);
  });

  it('is false when the last sync failed within the backoff window', () => {
    const failed = { profileSyncFailedAt: FAILED_RECENT };
    expect(profileNeedsSync(record({}, { profileSyncedAt: undefined, ...failed }), 'profilePictureUrl', NOW)).toBe(false);
    expect(profileNeedsSync(record({}, { profileSyncedAt: STALE, ...failed }), 'profilePictureUrl', NOW)).toBe(false);
    expect(profileNeedsSync(record({}, { profilePictureUrl: EXPIRED_PIC, ...failed }), 'profilePictureUrl', NOW)).toBe(false);
  });

  it('is true when the last sync failure is older than the backoff window', () => {
    expect(
      profileNeedsSync(record({}, { profileSyncedAt: STALE, profileSyncFailedAt: FAILED_OLD }), 'profilePictureUrl', NOW),
    ).toBe(true);
  });

  it('is true exactly at the backoff edge', () => {
    const edge = new Date(NOW.getTime() - ACCOUNT_PROFILE_SYNC_FAILED_BACKOFF_MS).toISOString();
    expect(
      profileNeedsSync(record({}, { profileSyncedAt: undefined, profileSyncFailedAt: edge }), 'profilePictureUrl', NOW),
    ).toBe(true);
  });

  it('ignores an unparseable failure stamp', () => {
    expect(
      profileNeedsSync(record({}, { profileSyncedAt: undefined, profileSyncFailedAt: 'garbage' }), 'profilePictureUrl', NOW),
    ).toBe(true);
  });
});

describe('mergeProfileMetadata', () => {
  it('overwrites only returned fields and stamps the sync time', () => {
    const merged = mergeProfileMetadata(
      { name: 'Kept', profilePictureUrl: 'old', other: 1 },
      { accountName: 'x', pictureUrl: 'new', metadata: { name: null, profilePictureUrl: 'new', followersCount: undefined } },
      NOW,
    );
    expect(merged).toEqual({ name: 'Kept', profilePictureUrl: 'new', other: 1, profileSyncedAt: NOW.toISOString() });
  });

  it('clears the failure marker on success', () => {
    const merged = mergeProfileMetadata(
      { other: 1, profileSyncFailedAt: FAILED_RECENT },
      { accountName: 'x', pictureUrl: null, metadata: {} },
      NOW,
    );
    expect(merged).toEqual({ other: 1, profileSyncedAt: NOW.toISOString() });
  });
});

describe('syncAccountProfile', () => {
  beforeEach(() => {
    for (const key of Object.keys(sources)) delete sources[key];
    sources.instagram = { pictureKey: 'profilePictureUrl', applies: vi.fn(() => true), fetch: vi.fn() };
    vi.mocked(updateSocialAccountMetadata).mockReset();
    vi.mocked(updateSocialAccountMetadata).mockResolvedValue(undefined);
    vi.mocked(getSocialAccountTokens).mockReset();
    vi.mocked(reportProfileFetched).mockReset();
    vi.mocked(reportProfileFetchFailed).mockReset();
    vi.mocked(logger.info).mockClear();
    vi.mocked(logger.error).mockClear();
  });

  it('returns the record untouched when no sync is needed', async () => {
    const rec = record();
    expect(await syncAccountProfile(supabase, 'u1', rec, { now: () => NOW })).toBe(rec);
    expect(sources.instagram.fetch).not.toHaveBeenCalled();
  });

  it('skips rows the source does not apply to, even when stale', async () => {
    sources.instagram.applies.mockReturnValue(false);
    const rec = record({}, { profileSyncedAt: STALE });
    expect(await syncAccountProfile(supabase, 'u1', rec, { now: () => NOW })).toBe(rec);
    expect(sources.instagram.fetch).not.toHaveBeenCalled();
  });

  it('returns an unknown-provider row untouched without consulting the sources map', async () => {
    // social_accounts.provider is an unconstrained text column; the route's
    // registry drop+log owns these rows, not the resync.
    const rec = record({ provider: 'mastodon' as never }, { profileSyncedAt: STALE });
    expect(await syncAccountProfile(supabase, 'u1', rec, { now: () => NOW })).toBe(rec);
    expect(sources.instagram.applies).not.toHaveBeenCalled();
    expect(sources.instagram.fetch).not.toHaveBeenCalled();
  });

  it('persists a rename and a new picture on a stale row and reports the change', async () => {
    sources.instagram.fetch.mockResolvedValue({
      accountName: 'new_handle',
      pictureUrl: 'https://x.test/new.jpg',
      metadata: { username: 'new_handle', profilePictureUrl: 'https://x.test/new.jpg' },
    });
    const rec = record({}, { profileSyncedAt: STALE });

    const result = await syncAccountProfile(supabase, 'u1', rec, { now: () => NOW });

    expect(sources.instagram.fetch).toHaveBeenCalledWith(supabase, 'u1', rec);
    const metadata = { username: 'new_handle', profilePictureUrl: 'https://x.test/new.jpg', profileSyncedAt: NOW.toISOString() };
    expect(updateSocialAccountMetadata).toHaveBeenCalledWith(supabase, 'u1', 'instagram', 'ig-1', metadata, 'new_handle');
    expect(result).toEqual({ ...rec, accountName: 'new_handle', accountMetadata: metadata });
    expect(reportProfileFetched).toHaveBeenCalledWith(
      'instagram',
      'sync',
      { accountName: 'new_handle', pictureUrl: 'https://x.test/new.jpg', metadata: expect.any(Object) },
      { accountName: 'old_handle', pictureUrl: FRESH_PIC },
    );
  });

  it('keeps the stored name when the provider returns none', async () => {
    sources.instagram.fetch.mockResolvedValue({ accountName: null, pictureUrl: null, metadata: {} });
    const result = await syncAccountProfile(supabase, 'u1', record({}, { profileSyncedAt: undefined }), { now: () => NOW });
    expect(vi.mocked(updateSocialAccountMetadata).mock.calls[0][5]).toBeUndefined();
    expect(result.accountName).toBe('old_handle');
  });

  it('reports and rethrows a provider failure after persisting the failure marker', async () => {
    const failure = new Error('token revoked');
    sources.instagram.fetch.mockRejectedValue(failure);
    const rec = record({}, { profileSyncedAt: STALE });
    vi.mocked(getSocialAccountTokens).mockResolvedValue({ tokens: { access_token: 'tok' }, account: rec });
    await expect(
      syncAccountProfile(supabase, 'u1', rec, { now: () => NOW }),
    ).rejects.toBe(failure);
    expect(reportProfileFetchFailed).toHaveBeenCalledWith('instagram', 'sync', failure);
    expect(updateSocialAccountMetadata).toHaveBeenCalledWith(supabase, 'u1', 'instagram', 'ig-1', {
      ...rec.accountMetadata,
      profileSyncFailedAt: NOW.toISOString(),
    });
  });

  it('writes the failure marker over fresh metadata when a concurrent request repaired the row', async () => {
    const failure = new Error('token revoked');
    sources.instagram.fetch.mockRejectedValue(failure);
    const rec = record({}, { profileSyncedAt: STALE });
    // A concurrent GET repaired the row while our provider read was in
    // flight: fresh name, fresh picture, fresh sync stamp, no marker.
    const fresh = record(
      { accountName: 'repaired_handle' },
      { profilePictureUrl: 'https://x.test/repaired.jpg', profileSyncedAt: NOW.toISOString() },
    );
    vi.mocked(getSocialAccountTokens).mockResolvedValue({ tokens: { access_token: 'tok' }, account: fresh });
    await expect(
      syncAccountProfile(supabase, 'u1', rec, { now: () => NOW }),
    ).rejects.toBe(failure);
    expect(reportProfileFetchFailed).toHaveBeenCalledWith('instagram', 'sync', failure);
    // The stale snapshot (old picture, STALE stamp) must not come back:
    // the repair survives, only the failure marker is added.
    expect(updateSocialAccountMetadata).toHaveBeenCalledWith(supabase, 'u1', 'instagram', 'ig-1', {
      ...fresh.accountMetadata,
      profileSyncFailedAt: NOW.toISOString(),
    });
  });

  it('skips the marker write when the row cannot be re-read and still rethrows the original error', async () => {
    const failure = new Error('token revoked');
    sources.instagram.fetch.mockRejectedValue(failure);
    vi.mocked(getSocialAccountTokens).mockRejectedValue(new Error('row gone'));
    await expect(
      syncAccountProfile(supabase, 'u1', record({}, { profileSyncedAt: STALE }), { now: () => NOW }),
    ).rejects.toBe(failure);
    expect(reportProfileFetchFailed).toHaveBeenCalledWith('instagram', 'sync', failure);
    expect(updateSocialAccountMetadata).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();
  });

  it('skips the provider read while the failure backoff is active', async () => {
    const rec = record({}, { profileSyncedAt: undefined, profileSyncFailedAt: FAILED_RECENT });
    expect(await syncAccountProfile(supabase, 'u1', rec, { now: () => NOW })).toBe(rec);
    expect(sources.instagram.fetch).not.toHaveBeenCalled();
    expect(updateSocialAccountMetadata).not.toHaveBeenCalled();
  });

  it('still rethrows the original error when the failure marker cannot be saved', async () => {
    const failure = new Error('token revoked');
    sources.instagram.fetch.mockRejectedValue(failure);
    const rec = record({}, { profileSyncedAt: STALE });
    vi.mocked(getSocialAccountTokens).mockResolvedValue({ tokens: { access_token: 'tok' }, account: rec });
    vi.mocked(updateSocialAccountMetadata).mockRejectedValueOnce(new Error('db down'));
    await expect(
      syncAccountProfile(supabase, 'u1', rec, { now: () => NOW }),
    ).rejects.toBe(failure);
    expect(reportProfileFetchFailed).toHaveBeenCalledWith('instagram', 'sync', failure);
    expect(logger.error).toHaveBeenCalled();
  });
});
