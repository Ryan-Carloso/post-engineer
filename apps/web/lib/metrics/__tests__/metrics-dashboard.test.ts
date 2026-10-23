import { afterEach, describe, expect, it, vi } from 'vitest';
import { distinctAngles, fetchMetrics, groupMetrics, isGroupKey, isMetricKey } from '../metrics-dashboard';
import { METRICS_FILTER_MAX_LENGTH, METRICS_NONE, metricsSearchParams, parseMetricsQuery, type MetricsRowView } from '../metrics-query';
import { accountOption, PROVIDER_LABELS } from '@/lib/account-options';
import { SOCIAL_PROVIDERS } from '@/lib/providers/registry';

function view(overrides: Partial<MetricsRowView> = {}): MetricsRowView {
  return {
    postId: 'p', personaId: 'persona-a', provider: 'youtube', accountId: 'yt', externalId: 'v',
    scriptAngle: 'myth', views: 100, likes: null, comments: 3, saves: null, collectedAt: '2026-10-21T12:00:00Z',
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('groupMetrics', () => {
  it('averages a metric per group, highest first, rounding', () => {
    const rows = [
      view({ scriptAngle: 'myth', views: 100 }),
      view({ scriptAngle: 'myth', views: 201 }),
      view({ scriptAngle: 'tutorial', views: 400 }),
      view({ scriptAngle: null, views: 50 }),
    ];
    expect(groupMetrics(rows, 'angle', 'views')).toEqual([
      { key: 'tutorial', average: 400, count: 1 },
      { key: 'myth', average: 151, count: 2 },
      { key: METRICS_NONE, average: 50, count: 1 },
    ]);
  });

  it('leaves null values out of the average instead of counting them as 0', () => {
    const rows = [view({ provider: 'bluesky', views: null }), view({ provider: 'youtube', views: 10 })];
    expect(groupMetrics(rows, 'provider', 'views')).toEqual([{ key: 'youtube', average: 10, count: 1 }]);
  });

  it('returns an empty array for empty rows or all-null metric values', () => {
    expect(groupMetrics([], 'angle', 'views')).toEqual([]);
    expect(groupMetrics([view({ views: null }), view({ views: null })], 'angle', 'views')).toEqual([]);
  });

  it('groups by persona and account', () => {
    const rows = [view({ personaId: null, accountId: 'a' }), view({ personaId: 'x', accountId: 'b', comments: 9 })];
    expect(groupMetrics(rows, 'persona', 'comments').map((g) => g.key)).toEqual(['x', METRICS_NONE]);
    expect(groupMetrics(rows, 'account', 'comments').map((g) => g.key)).toEqual(['b', 'a']);
  });
});

describe('distinctAngles', () => {
  it('lists each non-null angle once, sorted', () => {
    expect(distinctAngles([view({ scriptAngle: 'b' }), view({ scriptAngle: 'a' }), view({ scriptAngle: 'b' }), view({ scriptAngle: null })]))
      .toEqual(['a', 'b']);
  });
});

describe('isMetricKey / isGroupKey', () => {
  it('accept only the known keys', () => {
    expect(isMetricKey('saves')).toBe(true);
    expect(isMetricKey('shares')).toBe(false);
    expect(isGroupKey('angle')).toBe(true);
    expect(isGroupKey('date')).toBe(false);
  });
});

describe('fetchMetrics', () => {
  const query = { window: '24h' as const, personaId: null, accountId: 'yt', provider: null, angle: null };

  it('returns rows on success and sends the filters', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ success: true, rows: [view()], truncated: false })));
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchMetrics(query)).resolves.toEqual({ success: true, rows: [view()], truncated: false });
    expect(fetchMock).toHaveBeenCalledWith('/api/metrics?window=24h&account=yt');
  });

  it('never throws: non-2xx, HTML bodies and network errors become failures', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })));
    await expect(fetchMetrics(query)).resolves.toEqual({ success: false, error: 'status 500' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>', { status: 200 })));
    await expect(fetchMetrics(query)).resolves.toEqual({ success: false, error: 'unexpected response' });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    await expect(fetchMetrics(query)).resolves.toEqual({ success: false, error: 'offline' });
  });
});

describe('parseMetricsQuery / metricsSearchParams', () => {
  it('round-trips a full query', () => {
    const query = { window: '7d' as const, personaId: METRICS_NONE, accountId: 'a', provider: 'linkedin' as const, angle: 'x' };
    expect(parseMetricsQuery(metricsSearchParams(query))).toEqual({ ok: true, query });
  });

  it('treats a literal none angle as an angle, not as the null sentinel', () => {
    const parsed = parseMetricsQuery(new URLSearchParams({ window: '24h', angle: 'none' }));
    expect(parsed).toEqual({
      ok: true,
      query: { window: '24h', personaId: null, accountId: null, provider: null, angle: 'none' },
    });
  });

  it('rejects over-length filters', () => {
    const params = new URLSearchParams({ window: '24h', angle: 'a'.repeat(METRICS_FILTER_MAX_LENGTH + 1) });
    expect(parseMetricsQuery(params)).toEqual({ ok: false, error: 'angle is too long.' });
  });
});

describe('accountOption', () => {
  it('maps every provider shape to the id post_metrics stores', () => {
    expect(accountOption({ provider: 'youtube', recordId: 'r', channelId: 'UC1', channelName: 'Chan' } as never))
      .toEqual({ id: 'UC1', provider: 'youtube', label: 'Chan' });
    expect(accountOption({ provider: 'instagram', recordId: 'r', igUserId: 'ig1', username: 'me' } as never))
      .toEqual({ id: 'ig1', provider: 'instagram', label: '@me' });
    expect(accountOption({ provider: 'bluesky', recordId: 'r', did: 'did:plc:x', handle: 'me.bsky.social', connectedAt: 0, lastUsed: 0 }))
      .toEqual({ id: 'did:plc:x', provider: 'bluesky', label: '@me.bsky.social' });
    expect(accountOption({ provider: 'linkedin', recordId: 'r', providerAccountId: 'li1', accountName: null, connectedAt: 0, lastUsed: 0 }))
      .toEqual({ id: 'li1', provider: 'linkedin', label: 'li1' });
  });

  it('has a label for every provider', () => {
    expect(Object.keys(PROVIDER_LABELS).sort()).toEqual([...SOCIAL_PROVIDERS].sort());
  });
});
