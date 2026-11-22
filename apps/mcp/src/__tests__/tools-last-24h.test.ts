import { describe, it, expect, vi } from 'vitest';
import { getLast24hMetrics } from '../client-posts.js';
import { GetLast24hMetricsSchema, handleGetLast24hMetrics } from '../tools-posts.js';
import { last24hSearchParams, parseLast24hQuery } from '../contracts/metrics.js';
import type { SocialProvider } from '../contracts/providers.js';
import { METRICS_NONE } from '../limits.js';
import type { PostEngineerClient } from '../client.js';
import type { McpToolResponse } from '../tools-call.js';

vi.mock('../analytics.js', () => ({
  mcpTelemetryHeaders: () => ({}),
  withTelemetryHeaders: (_headers: unknown, run: () => Promise<unknown>) => run(),
  withToolCall: (_tool: string, _action: string, run: () => Promise<unknown>) => run(),
  withTracking: (_toolName: string, handler: (args: unknown) => Promise<unknown>) => async (args: unknown) => handler(args),
}));

const HEADERS = { Authorization: 'Bearer test-token' };
const PERSONA = '0b7c2c55-4a3e-4c55-9d7e-1f2a3b4c5d6e';

const LAST_24H_ROW = {
  postId: 'p-1',
  personaId: PERSONA,
  provider: 'youtube',
  accountId: 'UC-1',
  externalId: 'abc',
  publishedAt: '2026-11-19T10:00:00Z',
  views: 300,
  likes: 6,
  comments: 0,
  saves: null,
  baseline: 'reading',
  collectedAt: '2026-11-22T11:00:00Z',
  baselineCollectedAt: '2026-11-21T11:00:00Z',
};

const LAST_24H_RESPONSE = {
  success: true,
  rows: [LAST_24H_ROW],
  totals: { views: 300, engagement: 6, videos: 1, measurements: 1 },
  skipped: { noBaseline: 2, stale: 0 },
  counterResets: 0,
  truncated: false,
  asOf: '2026-11-22T11:00:00Z',
};

function fakeClient(request: ReturnType<typeof vi.fn>): PostEngineerClient {
  return { request, getHeaders: vi.fn().mockReturnValue(HEADERS) } as unknown as PostEngineerClient;
}

function textOf(response: unknown): string {
  const content = (response as { content?: unknown }).content as McpToolResponse['content'];
  const block = content[0];
  if (!block || block.type !== 'text') throw new Error('expected a text content block');
  return block.text;
}

describe('getLast24hMetrics', () => {
  it('sends no query string and no window when no filter is set', async () => {
    const request = vi.fn().mockResolvedValue(LAST_24H_RESPONSE);
    await getLast24hMetrics(fakeClient(request), {});
    expect(request).toHaveBeenCalledWith(
      '/api/metrics/last-24h',
      { method: 'GET', headers: HEADERS },
      'get last 24 hours metrics',
    );
  });

  it('sends every filter under the route parameter names and never a window', async () => {
    const request = vi.fn().mockResolvedValue(LAST_24H_RESPONSE);
    await getLast24hMetrics(fakeClient(request), { persona: PERSONA, account: 'UC-1', provider: 'youtube' });
    const url = new URL((request.mock.calls[0] as [string])[0], 'https://api.test');
    expect(url.pathname).toBe('/api/metrics/last-24h');
    expect([...url.searchParams.entries()]).toEqual([
      ['persona', PERSONA],
      ['account', 'UC-1'],
      ['provider', 'youtube'],
    ]);
  });

  it('returns the parsed body', async () => {
    const request = vi.fn().mockResolvedValue(LAST_24H_RESPONSE);
    expect(await getLast24hMetrics(fakeClient(request), {})).toEqual(LAST_24H_RESPONSE);
  });

  it('rejects a malformed 200 body', async () => {
    const request = vi.fn().mockResolvedValue({ success: true, rows: [] });
    await expect(getLast24hMetrics(fakeClient(request), {})).rejects.toThrow(
      'Malformed response from GET /api/metrics/last-24h',
    );
  });

  it('rejects a row whose baseline is not a known kind', async () => {
    const request = vi.fn().mockResolvedValue({ ...LAST_24H_RESPONSE, rows: [{ ...LAST_24H_ROW, baseline: 'guess' }] });
    await expect(getLast24hMetrics(fakeClient(request), {})).rejects.toThrow(
      'Malformed response from GET /api/metrics/last-24h',
    );
  });
});

type FilterCase = { args: Record<string, string>; accept: boolean };

const FILTER_CASES: FilterCase[] = [
  { args: {}, accept: true },
  { args: { persona: PERSONA, account: 'UC-1', provider: 'youtube' }, accept: true },
  { args: { persona: METRICS_NONE }, accept: true },
  { args: { persona: 'not-a-uuid' }, accept: false },
  { args: { provider: 'tiktok' }, accept: false },
  { args: { account: '' }, accept: false },
  { args: { account: 'a'.repeat(201) }, accept: false },
];

describe('last_24h tool schema agrees with the shared contract', () => {
  it.each(FILTER_CASES)('tool and contract agree on $args', ({ args, accept }) => {
    const params = last24hSearchParams({
      personaId: args.persona ?? null,
      accountId: args.account ?? null,
      provider: (args.provider ?? null) as SocialProvider | null,
    });
    expect(GetLast24hMetricsSchema.safeParse(args).success).toBe(accept);
    expect(parseLast24hQuery(params).ok).toBe(accept);
  });

  it('the contract rejects a window and an angle that the tool does not offer', () => {
    expect(parseLast24hQuery(new URLSearchParams({ window: '24h' }))).toEqual({ ok: false, error: 'Unknown parameter: window.' });
    expect(parseLast24hQuery(new URLSearchParams({ angle: 'x' }))).toEqual({ ok: false, error: 'Unknown parameter: angle.' });
    expect(GetLast24hMetricsSchema.shape).not.toHaveProperty('window');
    expect(GetLast24hMetricsSchema.shape).not.toHaveProperty('angle');
  });

  it('parses a filtered query into the typed query', () => {
    expect(parseLast24hQuery(new URLSearchParams({ persona: PERSONA, account: 'a', provider: 'youtube' }))).toEqual({
      ok: true,
      query: { personaId: PERSONA, accountId: 'a', provider: 'youtube' },
    });
    expect(parseLast24hQuery(new URLSearchParams())).toEqual({
      ok: true,
      query: { personaId: null, accountId: null, provider: null },
    });
  });
});

describe('handleGetLast24hMetrics', () => {
  it('returns the totals, rows and skipped counts', async () => {
    const request = vi.fn().mockResolvedValue(LAST_24H_RESPONSE);
    const result = await handleGetLast24hMetrics(fakeClient(request), {});
    expect(JSON.parse(textOf(result))).toEqual(LAST_24H_RESPONSE);
  });

  it('maps failures to an error response', async () => {
    const request = vi.fn().mockRejectedValue(new Error('Failed to load metrics.'));
    const result = await handleGetLast24hMetrics(fakeClient(request), {});
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('Error getting last 24 hours metrics: Failed to load metrics.');
  });
});
