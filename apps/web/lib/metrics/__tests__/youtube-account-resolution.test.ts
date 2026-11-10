import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/social-accounts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/social-accounts')>();
  return { ...actual, listSocialAccounts: vi.fn() };
});
vi.mock('@/lib/upload/handlers', () => ({ getAuthenticatedClient: vi.fn() }));
vi.mock('@/lib/youtube', () => ({ getYouTubeVideoInfo: vi.fn() }));
vi.mock('@/lib/supabase/service', () => ({ createSupabaseServiceClient: vi.fn(() => ({})) }));

import { resolveYouTubeMetricsTarget } from '../youtube-account-resolution';
import { listSocialAccounts } from '@/lib/social-accounts';
import { getAuthenticatedClient } from '@/lib/upload/handlers';
import { getYouTubeVideoInfo } from '@/lib/youtube';
import type { MetricsTarget } from '../post-metrics';

const TARGET: MetricsTarget = { provider: 'youtube', accountId: 'unknown', externalId: 'vid-1' };

function account(providerAccountId: string) {
  return {
    id: `row-${providerAccountId}`,
    userId: 'user-1',
    provider: 'youtube',
    providerAccountId,
    accountName: null,
    accountMetadata: {},
    tokenExpiresAt: null,
    createdAt: '',
    updatedAt: '',
    lastUsedAt: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('resolveYouTubeMetricsTarget', () => {
  it('returns a non-YouTube target unchanged without reading accounts', async () => {
    const target: MetricsTarget = { provider: 'instagram', accountId: 'unknown', externalId: 'media-9' };
    await expect(resolveYouTubeMetricsTarget('user-1', target)).resolves.toBe(target);
    expect(listSocialAccounts).not.toHaveBeenCalled();
  });

  it('returns a YouTube target with a real account id unchanged without reading accounts', async () => {
    const target: MetricsTarget = { provider: 'youtube', accountId: 'UC-real', externalId: 'vid-1' };
    await expect(resolveYouTubeMetricsTarget('user-1', target)).resolves.toBe(target);
    expect(listSocialAccounts).not.toHaveBeenCalled();
  });

  it('resolves a placeholder to the single connected YouTube account', async () => {
    vi.mocked(listSocialAccounts).mockResolvedValue([account('UC-real')] as never);

    const resolved = await resolveYouTubeMetricsTarget('user-1', TARGET);

    expect(resolved).toEqual({ provider: 'youtube', accountId: 'UC-real', externalId: 'vid-1' });
    expect(listSocialAccounts).toHaveBeenCalledWith({}, 'user-1', 'youtube');
    expect(getAuthenticatedClient).not.toHaveBeenCalled();
    expect(getYouTubeVideoInfo).not.toHaveBeenCalled();
  });

  it('treats a differently-cased placeholder as a placeholder', async () => {
    vi.mocked(listSocialAccounts).mockResolvedValue([account('UC-real')] as never);

    const resolved = await resolveYouTubeMetricsTarget('user-1', { ...TARGET, accountId: 'Unknown' });

    expect(resolved).toEqual({ provider: 'youtube', accountId: 'UC-real', externalId: 'vid-1' });
  });

  it('resolves a placeholder to the connected account that owns the video when several are connected', async () => {
    vi.mocked(listSocialAccounts).mockResolvedValue([account('UC-first'), account('UC-matched')] as never);
    vi.mocked(getAuthenticatedClient).mockResolvedValue('client-first' as never);
    vi.mocked(getYouTubeVideoInfo).mockResolvedValue({
      snippet: { channelId: 'UC-matched', publishedAt: '2026-11-08T10:00:00Z' },
      statistics: { viewCount: '10' },
    });

    const resolved = await resolveYouTubeMetricsTarget('user-1', TARGET);

    expect(resolved).toEqual({ provider: 'youtube', accountId: 'UC-matched', externalId: 'vid-1' });
    expect(getAuthenticatedClient).toHaveBeenCalledWith('user-1', 'UC-first');
    expect(getYouTubeVideoInfo).toHaveBeenCalledWith('client-first', 'vid-1');
  });

  it('skips the target when no connected account owns the video', async () => {
    vi.mocked(listSocialAccounts).mockResolvedValue([account('UC-a'), account('UC-b')] as never);
    vi.mocked(getAuthenticatedClient).mockResolvedValue('client-a' as never);
    vi.mocked(getYouTubeVideoInfo).mockResolvedValue({
      snippet: { channelId: 'UC-other', publishedAt: '2026-11-08T10:00:00Z' },
      statistics: { viewCount: '10' },
    });

    await expect(resolveYouTubeMetricsTarget('user-1', TARGET)).resolves.toBeNull();
  });

  it('skips the target when the video snippet carries no channel id', async () => {
    vi.mocked(listSocialAccounts).mockResolvedValue([account('UC-a'), account('UC-b')] as never);
    vi.mocked(getAuthenticatedClient).mockResolvedValue('client-a' as never);
    vi.mocked(getYouTubeVideoInfo).mockResolvedValue({ snippet: {}, statistics: { viewCount: '10' } });

    await expect(resolveYouTubeMetricsTarget('user-1', TARGET)).resolves.toBeNull();
  });

  it('skips the target when no YouTube account is connected', async () => {
    vi.mocked(listSocialAccounts).mockResolvedValue([]);

    await expect(resolveYouTubeMetricsTarget('user-1', TARGET)).resolves.toBeNull();
    expect(getAuthenticatedClient).not.toHaveBeenCalled();
    expect(getYouTubeVideoInfo).not.toHaveBeenCalled();
  });

  it('never resolves to a stored placeholder row', async () => {
    vi.mocked(listSocialAccounts).mockResolvedValue([account('unknown'), account('UC-real')] as never);

    const resolved = await resolveYouTubeMetricsTarget('user-1', TARGET);

    expect(resolved).toEqual({ provider: 'youtube', accountId: 'UC-real', externalId: 'vid-1' });
  });

  it('treats a list of only placeholder rows as no connected account', async () => {
    vi.mocked(listSocialAccounts).mockResolvedValue([account('unknown')] as never);

    await expect(resolveYouTubeMetricsTarget('user-1', TARGET)).resolves.toBeNull();
  });
});
