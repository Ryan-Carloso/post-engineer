import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

const getProfile = vi.fn();
vi.mock('@/lib/instagram', () => ({
  InstagramService: vi.fn().mockImplementation(function InstagramServiceMock() {
    return { getProfile };
  }),
}));

vi.mock('@/lib/social-accounts', () => ({
  getSocialAccountTokens: vi.fn(),
  updateSocialAccountMetadata: vi.fn(),
}));

import {
  INSTAGRAM_PROFILE_SYNC_MAX_AGE_MS,
  instagramPictureUrlExpired,
  instagramProfileNeedsSync,
  syncInstagramProfile,
} from '@/lib/instagram-profile-sync';
import { getSocialAccountTokens, updateSocialAccountMetadata, type SocialAccountRecord } from '@/lib/social-accounts';

const NOW = new Date('2026-11-06T12:00:00.000Z');
const supabase = {} as never;
// `oe` is the CDN expiry in hex Unix seconds.
const hexSeconds = (ms: number): string => Math.floor(ms / 1000).toString(16);
const FRESH_PIC = `https://scontent.cdninstagram.com/p.jpg?oe=${hexSeconds(NOW.getTime() + 86_400_000)}`;
const EXPIRED_PIC = `https://scontent.cdninstagram.com/p.jpg?oe=${hexSeconds(NOW.getTime() - 1000)}`;

function record(overrides: Partial<SocialAccountRecord> = {}, metadata: Record<string, unknown> = {}): SocialAccountRecord {
  return {
    id: 'rec-1',
    userId: 'u1',
    provider: 'instagram',
    providerAccountId: 'ig-1',
    accountName: 'old_handle',
    accountMetadata: {
      username: 'old_handle',
      profilePictureUrl: FRESH_PIC,
      profileSyncedAt: new Date(NOW.getTime() - 60_000).toISOString(),
      ...metadata,
    },
    tokenExpiresAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    lastUsedAt: null,
    ...overrides,
  };
}

describe('instagramPictureUrlExpired', () => {
  it('is true only when the oe timestamp is in the past', () => {
    expect(instagramPictureUrlExpired(EXPIRED_PIC, NOW)).toBe(true);
    expect(instagramPictureUrlExpired(FRESH_PIC, NOW)).toBe(false);
  });

  it('is false for URLs without oe or unparseable URLs', () => {
    expect(instagramPictureUrlExpired('https://x.test/p.jpg', NOW)).toBe(false);
    expect(instagramPictureUrlExpired('not a url', NOW)).toBe(false);
  });
});

describe('instagramProfileNeedsSync', () => {
  it('is false for a complete profile synced within the max age', () => {
    expect(instagramProfileNeedsSync(record(), NOW)).toBe(false);
  });

  it('is true once the last sync is older than the max age', () => {
    const stale = new Date(NOW.getTime() - INSTAGRAM_PROFILE_SYNC_MAX_AGE_MS - 1).toISOString();
    expect(instagramProfileNeedsSync(record({}, { profileSyncedAt: stale }), NOW)).toBe(true);
  });

  it('is false exactly at the max age boundary', () => {
    const edge = new Date(NOW.getTime() - INSTAGRAM_PROFILE_SYNC_MAX_AGE_MS).toISOString();
    expect(instagramProfileNeedsSync(record({}, { profileSyncedAt: edge }), NOW)).toBe(false);
  });

  it('is true when the account was never synced (legacy row)', () => {
    expect(instagramProfileNeedsSync(record({}, { profileSyncedAt: undefined }), NOW)).toBe(true);
    expect(instagramProfileNeedsSync(record({}, { profileSyncedAt: 'garbage' }), NOW)).toBe(true);
  });

  it('is true when the name is missing or the fallback', () => {
    expect(instagramProfileNeedsSync(record({ accountName: 'instagram_user' }), NOW)).toBe(true);
    expect(instagramProfileNeedsSync(record({ accountName: null }), NOW)).toBe(true);
    expect(instagramProfileNeedsSync(record({ accountName: '' }), NOW)).toBe(true);
  });

  it('is true when the picture is missing or expired', () => {
    expect(instagramProfileNeedsSync(record({}, { profilePictureUrl: undefined }), NOW)).toBe(true);
    expect(instagramProfileNeedsSync(record({}, { profilePictureUrl: '' }), NOW)).toBe(true);
    expect(instagramProfileNeedsSync(record({}, { profilePictureUrl: EXPIRED_PIC }), NOW)).toBe(true);
  });
});

describe('syncInstagramProfile', () => {
  beforeEach(() => {
    getProfile.mockReset();
    vi.mocked(getSocialAccountTokens).mockReset();
    vi.mocked(updateSocialAccountMetadata).mockReset();
    vi.mocked(getSocialAccountTokens).mockResolvedValue({ tokens: { access_token: 'tok' } } as never);
    vi.mocked(updateSocialAccountMetadata).mockResolvedValue(undefined);
  });

  it('returns the stored record untouched when no sync is needed', async () => {
    const rec = record();
    const result = await syncInstagramProfile(supabase, 'u1', rec, { now: () => NOW });
    expect(result).toBe(rec);
    expect(getProfile).not.toHaveBeenCalled();
    expect(updateSocialAccountMetadata).not.toHaveBeenCalled();
  });

  it('picks up a rename and a new picture on a stale profile', async () => {
    const stale = new Date(NOW.getTime() - INSTAGRAM_PROFILE_SYNC_MAX_AGE_MS - 1).toISOString();
    getProfile.mockResolvedValue({
      userdId: 'ig-1',
      username: 'new_handle',
      name: 'New Name',
      profilePictureUrl: 'https://scontent.cdninstagram.com/new.jpg',
      followersCount: 10,
      mediaCount: 3,
    });

    const result = await syncInstagramProfile(supabase, 'u1', record({}, { profileSyncedAt: stale }), { now: () => NOW });

    expect(getSocialAccountTokens).toHaveBeenCalledWith(supabase, 'u1', 'instagram', 'ig-1');
    expect(getProfile).toHaveBeenCalledWith('tok');
    const expectedMetadata = {
      username: 'new_handle',
      name: 'New Name',
      profilePictureUrl: 'https://scontent.cdninstagram.com/new.jpg',
      followersCount: 10,
      mediaCount: 3,
      profileSyncedAt: NOW.toISOString(),
    };
    expect(updateSocialAccountMetadata).toHaveBeenCalledWith(supabase, 'u1', 'instagram', 'ig-1', expectedMetadata, 'new_handle');
    expect(result.accountName).toBe('new_handle');
    expect(result.accountMetadata).toEqual(expectedMetadata);
  });

  it('never overwrites the stored name with the fallback when Instagram omits the username', async () => {
    getProfile.mockResolvedValue({ userdId: 'ig-1', username: 'instagram_user', profilePictureUrl: 'https://x.test/n.jpg' });

    const result = await syncInstagramProfile(supabase, 'u1', record({}, { profilePictureUrl: undefined }), { now: () => NOW });

    const call = vi.mocked(updateSocialAccountMetadata).mock.calls[0];
    expect(call[5]).toBeUndefined();
    expect(call[4]).toMatchObject({ username: 'old_handle', profilePictureUrl: 'https://x.test/n.jpg' });
    expect(result.accountName).toBe('old_handle');
  });

  it('keeps stored fields the Graph API did not return', async () => {
    getProfile.mockResolvedValue({ userdId: 'ig-1', username: 'old_handle' });

    const result = await syncInstagramProfile(
      supabase,
      'u1',
      record({}, { profileSyncedAt: undefined, name: 'Kept', followersCount: 5 }),
      { now: () => NOW },
    );

    expect(result.accountMetadata).toMatchObject({ name: 'Kept', followersCount: 5, profilePictureUrl: FRESH_PIC });
  });

  it('propagates Graph failures without writing', async () => {
    getProfile.mockRejectedValue(new Error('token revoked'));

    await expect(
      syncInstagramProfile(supabase, 'u1', record({ accountName: 'instagram_user' }), { now: () => NOW }),
    ).rejects.toThrow('token revoked');
    expect(updateSocialAccountMetadata).not.toHaveBeenCalled();
  });
});
