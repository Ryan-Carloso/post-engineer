import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/youtube', () => ({ getYouTubeVideoInfo: vi.fn() }));
vi.mock('@/lib/upload/handlers', () => ({ getAuthenticatedClient: vi.fn() }));
vi.mock('@/lib/social-accounts', () => ({ getSocialAccountTokens: vi.fn() }));
vi.mock('@/lib/supabase/service', () => ({ createSupabaseServiceClient: vi.fn(() => ({})) }));
const { getMediaInsights } = vi.hoisted(() => ({ getMediaInsights: vi.fn() }));
vi.mock('@/lib/instagram', () => ({
  InstagramService: class {
    getMediaInsights = getMediaInsights;
  },
}));

import { fetchProviderCounters, instagramCounters, parseCount, youtubeCounters } from '../provider-counters';
import { getYouTubeVideoInfo } from '@/lib/youtube';
import { getAuthenticatedClient } from '@/lib/upload/handlers';
import { getSocialAccountTokens } from '@/lib/social-accounts';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('parseCount', () => {
  it('accepts numbers and decimal strings, rejects anything else', () => {
    expect(parseCount('1200')).toBe(1200);
    expect(parseCount(7)).toBe(7);
    expect(parseCount('12a')).toBeNull();
    expect(parseCount(undefined)).toBeNull();
    expect(parseCount(Number.NaN)).toBeNull();
  });
});

describe('youtubeCounters', () => {
  it('maps statistics and keeps hidden counters null', () => {
    expect(youtubeCounters({ statistics: { viewCount: '1200', commentCount: '9' } })).toEqual({
      views: 1200,
      likes: null,
      comments: 9,
      saves: null,
    });
    expect(youtubeCounters(null)).toEqual({ views: null, likes: null, comments: null, saves: null });
  });
});

describe('instagramCounters', () => {
  it('maps insights names, missing metrics stay null', () => {
    expect(instagramCounters({ views: 500, saved: 3 })).toEqual({ views: 500, likes: null, comments: null, saves: 3 });
  });
});

describe('fetchProviderCounters', () => {
  it('reads YouTube statistics with the owner account client', async () => {
    vi.mocked(getAuthenticatedClient).mockResolvedValue('client' as never);
    vi.mocked(getYouTubeVideoInfo).mockResolvedValue({ statistics: { viewCount: '10', likeCount: '2', commentCount: '1' } });

    const counters = await fetchProviderCounters('user-1', { provider: 'youtube', accountId: 'yt', externalId: 'vid' });

    expect(getAuthenticatedClient).toHaveBeenCalledWith('user-1', 'yt');
    expect(getYouTubeVideoInfo).toHaveBeenCalledWith('client', 'vid');
    expect(counters).toEqual({ views: 10, likes: 2, comments: 1, saves: null });
  });

  it('reads Instagram insights with the owner token', async () => {
    vi.mocked(getSocialAccountTokens).mockResolvedValue({ tokens: { access_token: 'tok' } } as never);
    getMediaInsights.mockResolvedValue({ views: 50, likes: 4, comments: 1, saved: 2 });

    const counters = await fetchProviderCounters('user-1', { provider: 'instagram', accountId: 'ig', externalId: 'm1' });

    expect(getSocialAccountTokens).toHaveBeenCalledWith({}, 'user-1', 'instagram', 'ig');
    expect(getMediaInsights).toHaveBeenCalledWith('m1', 'tok');
    expect(counters).toEqual({ views: 50, likes: 4, comments: 1, saves: 2 });
  });

  it('throws on a missing or expired Instagram token without calling the API', async () => {
    vi.mocked(getSocialAccountTokens).mockResolvedValueOnce({ tokens: {} } as never);
    await expect(
      fetchProviderCounters('user-1', { provider: 'instagram', accountId: 'ig', externalId: 'm1' }),
    ).rejects.toThrow('Instagram token not found');

    vi.mocked(getSocialAccountTokens).mockResolvedValueOnce({
      tokens: { access_token: 'tok', expiry_date: Date.now() - 1000 },
    } as never);
    await expect(
      fetchProviderCounters('user-1', { provider: 'instagram', accountId: 'ig', externalId: 'm1' }),
    ).rejects.toThrow('Instagram token expired');
    expect(getMediaInsights).not.toHaveBeenCalled();
  });
});
