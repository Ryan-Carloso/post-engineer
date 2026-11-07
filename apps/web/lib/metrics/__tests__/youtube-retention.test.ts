import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/youtube-analytics', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/youtube-analytics')>();
  return { ...actual, queryVideoStats: vi.fn() };
});

import { analyticsEndDate, youtubeRetention } from '../youtube-retention';
import { queryVideoStats } from '@/lib/youtube-analytics';

const client = 'client' as never;
const target = { provider: 'youtube' as const, accountId: 'UC-own', externalId: 'vid1' };
const now = new Date('2026-11-07T12:00:00Z');
const ownVideo = { snippet: { channelId: 'UC-own', publishedAt: '2026-10-31T09:00:00Z' } };

beforeEach(() => {
  vi.mocked(queryVideoStats).mockReset();
});

describe('analyticsEndDate', () => {
  it('queries to the collection day for 24h/7d and to collection - 3 days for 28d (final data)', () => {
    expect(analyticsEndDate('24h', now)).toBe('2026-11-07');
    expect(analyticsEndDate('7d', now)).toBe('2026-11-07');
    expect(analyticsEndDate('28d', now)).toBe('2026-11-04');
  });
});

describe('youtubeRetention', () => {
  it('never calls Analytics for a video on another channel', async () => {
    const result = await youtubeRetention(client, { snippet: { channelId: 'UC-someone-else', publishedAt: '2026-10-31T09:00:00Z' } }, target, { window: '7d', now });
    expect(queryVideoStats).not.toHaveBeenCalled();
    expect(result.status).toBe('not_owned');
    expect(result.engagedViews).toBeNull();
  });

  it('queries publish date .. end date for the owned video and maps the stats', async () => {
    vi.mocked(queryVideoStats).mockResolvedValueOnce({
      kind: 'ok',
      stats: { views: 1000, engagedViews: 640, averageViewDurationSeconds: 21.4, averageViewPercentage: 78.2, contentType: 'SHORTS' },
    });
    const result = await youtubeRetention(client, ownVideo, target, { window: '28d', now });
    expect(queryVideoStats).toHaveBeenCalledWith(client, { videoId: 'vid1', startDate: '2026-10-31', endDate: '2026-11-04' });
    expect(result).toEqual({
      status: 'ok',
      analyticsViews: 1000,
      engagedViews: 640,
      averageViewDurationSeconds: 21.4,
      averageViewPercentage: 78.2,
      contentType: 'SHORTS',
      startDate: '2026-10-31',
      endDate: '2026-11-04',
    });
  });

  it('records scope_missing (reconnect) and no_data without numbers', async () => {
    vi.mocked(queryVideoStats).mockResolvedValueOnce({ kind: 'scope_missing' });
    const missing = await youtubeRetention(client, ownVideo, target, { window: '7d', now });
    expect(missing).toMatchObject({ status: 'scope_missing', engagedViews: null, analyticsViews: null, endDate: null });

    vi.mocked(queryVideoStats).mockResolvedValueOnce({ kind: 'no_data' });
    expect((await youtubeRetention(client, ownVideo, target, { window: '7d', now })).status).toBe('no_data');
  });

  it('skips the query when the publish date is missing or after the end date', async () => {
    expect((await youtubeRetention(client, { snippet: { channelId: 'UC-own' } }, target, { window: '7d', now })).status).toBe('no_data');
    const future = { snippet: { channelId: 'UC-own', publishedAt: '2026-11-06T00:00:00Z' } };
    expect((await youtubeRetention(client, future, target, { window: '28d', now })).status).toBe('no_data');
    expect(queryVideoStats).not.toHaveBeenCalled();
  });

  it('lets a transient Analytics error propagate so the snapshot retries', async () => {
    vi.mocked(queryVideoStats).mockRejectedValueOnce(new Error('503'));
    await expect(youtubeRetention(client, ownVideo, target, { window: '7d', now })).rejects.toThrow('503');
  });
});
