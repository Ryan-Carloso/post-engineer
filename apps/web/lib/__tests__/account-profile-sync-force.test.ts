import { describe, it, expect, vi, beforeEach } from 'vitest';

const { sources } = vi.hoisted(() => ({
  sources: {} as Record<string, { pictureKey: string; applies: ReturnType<typeof vi.fn>; fetch: ReturnType<typeof vi.fn> }>,
}));
vi.mock('@/lib/account-profile-sources', () => ({ PROFILE_SOURCES: sources }));
vi.mock('@/lib/social-accounts', () => ({
  updateSocialAccountMetadata: vi.fn(),
  getSocialAccountTokens: vi.fn(),
}));
vi.mock('@/lib/account-profile-telemetry', () => ({
  reportProfileFetched: vi.fn(),
  reportProfileFetchFailed: vi.fn(),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/owner-alert-mail', () => ({ notifyAccountBreak: vi.fn(() => Promise.resolve()) }));

import { syncAccountProfile, ACCOUNT_PROFILE_SYNC_FAILURE_COOLDOWN_MS } from '@/lib/account-profile-sync';
import { updateSocialAccountMetadata, getSocialAccountTokens, type SocialAccountRecord } from '@/lib/social-accounts';

const NOW = new Date(Date.now());
const supabase = {} as never;
const RECENT = new Date(NOW.getTime() - 60_000).toISOString();
const TEN_MINUTES_AGO = new Date(NOW.getTime() - 10 * 60_000).toISOString();
const OLD_PIC = 'https://scontent.cdninstagram.com/old.jpg';
const NEW_PIC = 'https://scontent.cdninstagram.com/new.jpg';

function record(metadata: Record<string, unknown> = {}): SocialAccountRecord {
  return {
    id: 'rec-1',
    userId: 'u1',
    provider: 'instagram',
    providerAccountId: 'ig-1',
    accountName: 'handle',
    accountMetadata: { profilePictureUrl: OLD_PIC, profileSyncedAt: RECENT, ...metadata },
    tokenExpiresAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    lastUsedAt: null,
    needsReconnect: false,
  };
}

describe('syncAccountProfile with force', () => {
  beforeEach(() => {
    vi.mocked(updateSocialAccountMetadata).mockReset();
    vi.mocked(getSocialAccountTokens).mockReset();
    sources.instagram = {
      pictureKey: 'profilePictureUrl',
      applies: vi.fn(() => true),
      fetch: vi.fn(async () => ({ accountName: 'handle', pictureUrl: NEW_PIC, metadata: { profilePictureUrl: NEW_PIC } })),
    };
  });

  it('keeps a profile synced a minute ago when not forced', async () => {
    const result = await syncAccountProfile(supabase, 'u1', record(), { now: () => NOW });
    expect(sources.instagram.fetch).not.toHaveBeenCalled();
    expect(result.accountMetadata.profilePictureUrl).toBe(OLD_PIC);
  });

  it('fetches a profile synced a minute ago when forced and stores the new picture', async () => {
    const result = await syncAccountProfile(supabase, 'u1', record(), { now: () => NOW, force: true });
    expect(sources.instagram.fetch).toHaveBeenCalledTimes(1);
    expect(result.accountMetadata.profilePictureUrl).toBe(NEW_PIC);
    expect(updateSocialAccountMetadata).toHaveBeenCalledWith(
      supabase,
      'u1',
      'instagram',
      'ig-1',
      expect.objectContaining({ profilePictureUrl: NEW_PIC, profileSyncedAt: NOW.toISOString() }),
      'handle',
    );
  });

  it('retries inside the generic failure cooldown when forced', async () => {
    await syncAccountProfile(
      supabase,
      'u1',
      record({ profileSyncFailedAt: TEN_MINUTES_AGO, profileSyncFailedReason: 'rate_limited' }),
      { now: () => NOW, force: true },
    );
    expect(sources.instagram.fetch).toHaveBeenCalledTimes(1);
    expect(ACCOUNT_PROFILE_SYNC_FAILURE_COOLDOWN_MS).toBeGreaterThan(10 * 60_000);
  });

  it('still holds a credential failure when forced, so a dead token is not hammered', async () => {
    const held = record({ profileSyncFailedAt: TEN_MINUTES_AGO, profileSyncFailedReason: 'unauthorized' });
    const result = await syncAccountProfile(supabase, 'u1', held, { now: () => NOW, force: true });
    expect(sources.instagram.fetch).not.toHaveBeenCalled();
    expect(result).toBe(held);
  });

  it('does not fetch an account the source does not apply to, even when forced', async () => {
    sources.instagram.applies.mockReturnValue(false);
    await syncAccountProfile(supabase, 'u1', record(), { now: () => NOW, force: true });
    expect(sources.instagram.fetch).not.toHaveBeenCalled();
    expect(getSocialAccountTokens).toHaveBeenCalledTimes(1);
  });
});
