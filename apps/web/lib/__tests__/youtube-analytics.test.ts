import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockQuery, mockYoutubeAnalytics, mockLoggerError } = vi.hoisted(() => {
  const mockQuery = vi.fn();
  const mockYoutubeAnalytics = vi.fn(() => ({ reports: { query: mockQuery } }));
  return { mockQuery, mockYoutubeAnalytics, mockLoggerError: vi.fn() };
});

vi.mock('server-only', () => ({}));
vi.mock('googleapis', () => ({ google: { youtubeAnalytics: mockYoutubeAnalytics } }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: mockLoggerError } }));

import {
  AnalyticsAuthError,
  aggregateVideoStats,
  analyticsDate,
  isInsufficientScopeError,
  queryRetentionCurve,
  queryVideoStats,
  reportTable,
} from '@/lib/youtube-analytics';

const client = {} as never;
const range = { videoId: 'abc_DEF-123', startDate: '2026-10-01', endDate: '2026-10-08' };

const statsHeaders = [
  { name: 'creatorContentType' },
  { name: 'views' },
  { name: 'engagedViews' },
  { name: 'averageViewDuration' },
  { name: 'averageViewPercentage' },
];

function gaxiosError(status: number, reason: string | null, message = 'Forbidden'): Error {
  const error = new Error(message);
  Object.assign(error, {
    code: status,
    errors: reason === null ? [] : [{ reason, message }],
    response: { status, data: { error: { code: status, message, errors: [] } } },
  });
  return error;
}

beforeEach(() => {
  mockQuery.mockReset();
  mockLoggerError.mockReset();
});

describe('youtube-analytics queryVideoStats', () => {
  it('queries channel==MINE for one video split by creatorContentType', async () => {
    mockQuery.mockResolvedValueOnce({ data: { columnHeaders: statsHeaders, rows: [['SHORTS', 1000, 640, 21.4, 78.2]] } });
    const result = await queryVideoStats(client, range);
    expect(mockQuery).toHaveBeenCalledWith({
      ids: 'channel==MINE',
      startDate: '2026-10-01',
      endDate: '2026-10-08',
      metrics: 'views,engagedViews,averageViewDuration,averageViewPercentage',
      dimensions: 'creatorContentType',
      filters: 'video==abc_DEF-123',
    });
    expect(result).toEqual({
      kind: 'ok',
      stats: { views: 1000, engagedViews: 640, averageViewDurationSeconds: 21.4, averageViewPercentage: 78.2, contentType: 'SHORTS' },
    });
  });

  it('reports no_data when Analytics returns no rows', async () => {
    mockQuery.mockResolvedValueOnce({ data: { columnHeaders: statsHeaders } });
    await expect(queryVideoStats(client, range)).resolves.toEqual({ kind: 'no_data' });
  });

  it('maps a 403 insufficient-scope error to scope_missing without logging an error', async () => {
    mockQuery.mockRejectedValueOnce(gaxiosError(403, 'insufficientPermissions', 'Request had insufficient authentication scopes.'));
    await expect(queryVideoStats(client, range)).resolves.toEqual({ kind: 'scope_missing' });
    expect(mockLoggerError).not.toHaveBeenCalled();
  });

  it('throws AnalyticsAuthError on any other 403 and logs it at error', async () => {
    const error = gaxiosError(403, 'forbidden');
    mockQuery.mockRejectedValueOnce(error);
    await expect(queryVideoStats(client, range)).rejects.toBeInstanceOf(AnalyticsAuthError);
    // The original error is the cause (its message carries the YouTube
    // reason); the status rides as metadata. Logging only { status } as the
    // cause made the logger synthesize "Non-error value reported" and hid
    // the reason from PostHog.
    expect(mockLoggerError).toHaveBeenCalledWith('[youtube-analytics] video stats rejected', error, { status: 403 });
  });

  it('throws AnalyticsAuthError on 401', async () => {
    mockQuery.mockRejectedValueOnce(gaxiosError(401, null, 'Invalid Credentials'));
    await expect(queryVideoStats(client, range)).rejects.toThrow('YouTube Analytics rejected the token (401)');
  });

  it('rethrows transient errors (5xx) unchanged so the hourly job retries', async () => {
    const transient = gaxiosError(503, 'backendError', 'Backend Error');
    mockQuery.mockRejectedValueOnce(transient);
    await expect(queryVideoStats(client, range)).rejects.toBe(transient);
    expect(mockLoggerError).not.toHaveBeenCalled();
  });

  it('never queries with a malformed video id', async () => {
    await expect(queryVideoStats(client, { ...range, videoId: 'x;views>0' })).rejects.toThrow('Invalid YouTube video id');
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe('youtube-analytics queryRetentionCurve', () => {
  it('queries elapsedVideoTimeRatio for one video and returns sorted points', async () => {
    mockQuery.mockResolvedValueOnce({
      data: {
        columnHeaders: [{ name: 'elapsedVideoTimeRatio' }, { name: 'audienceWatchRatio' }, { name: 'relativeRetentionPerformance' }],
        rows: [[0.02, 0.9, 0.6], [0.01, 1.1, 0.55], ['bad', 1, 1]],
      },
    });
    const result = await queryRetentionCurve(client, range);
    expect(mockQuery).toHaveBeenCalledWith({
      ids: 'channel==MINE',
      startDate: '2026-10-01',
      endDate: '2026-10-08',
      metrics: 'audienceWatchRatio,relativeRetentionPerformance',
      dimensions: 'elapsedVideoTimeRatio',
      filters: 'video==abc_DEF-123',
    });
    expect(result).toEqual({
      kind: 'ok',
      points: [
        { ratio: 0.01, audienceWatchRatio: 1.1, relativeRetentionPerformance: 0.55 },
        { ratio: 0.02, audienceWatchRatio: 0.9, relativeRetentionPerformance: 0.6 },
      ],
    });
  });

  it('maps the insufficient-scope 403 to scope_missing', async () => {
    mockQuery.mockRejectedValueOnce(gaxiosError(403, null, 'Request had insufficient authentication scopes.'));
    await expect(queryRetentionCurve(client, range)).resolves.toEqual({ kind: 'scope_missing' });
  });
});

describe('youtube-analytics helpers', () => {
  it('aggregates content-type rows: sums counts, weights averages by views, keeps the top type', () => {
    const stats = aggregateVideoStats([
      { creatorContentType: 'SHORTS', views: 300, engagedViews: 150, averageViewDuration: 10, averageViewPercentage: 50 },
      { creatorContentType: 'UNSPECIFIED', views: 100, engagedViews: 50, averageViewDuration: 30, averageViewPercentage: 90 },
    ]);
    expect(stats).toEqual({
      views: 400,
      engagedViews: 200,
      averageViewDurationSeconds: 15,
      averageViewPercentage: 60,
      contentType: 'SHORTS',
    });
  });

  it('returns null when no row has numeric counts', () => {
    expect(aggregateVideoStats([{ views: 'x', engagedViews: 1 }])).toBeNull();
  });

  it('reportTable ignores malformed reports', () => {
    expect(reportTable(null)).toEqual([]);
    expect(reportTable({ columnHeaders: [{ name: 'views' }], rows: [[1], 'bad'] })).toEqual([{ views: 1 }]);
  });

  it('detects the scope error from the API body reason too', () => {
    const error = new Error('Forbidden');
    Object.assign(error, {
      response: { status: 403, data: { error: { details: [{ reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' }] } } },
    });
    expect(isInsufficientScopeError(error)).toBe(true);
    expect(isInsufficientScopeError(gaxiosError(500, 'insufficientPermissions'))).toBe(false);
  });

  it('formats dates as UTC YYYY-MM-DD', () => {
    expect(analyticsDate(new Date('2026-11-07T23:30:00Z'))).toBe('2026-11-07');
  });
});
