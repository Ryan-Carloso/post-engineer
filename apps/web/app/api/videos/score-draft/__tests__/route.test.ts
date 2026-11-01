//---------------
// Tests for POST /api/videos/score-draft.
//
// Scoring is advisory and read-only: no token debit, no schedule, no
// engine call. The baseline is one capped post_metrics read (7d first,
// 24h fallback); the route test pins the query shape and the fallback.
//---------------

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/service', () => ({ createSupabaseServiceClient: vi.fn() }));
vi.mock('@/lib/request-auth', () => ({ requireSupabaseSession: vi.fn() }));
vi.mock('@/lib/rate-limit', () => ({
  applyRateLimit: vi.fn(async () => null),
  RATE_LIMITS: { draftScore: { name: 'draft-score', limit: 60, windowMs: 60_000 } },
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/posthog-server', () => ({
  getPostHogServer: vi.fn(() => ({ capture: vi.fn(), captureAs: vi.fn() })),
}));

import { POST } from '../route';
import { requireSupabaseSession } from '@/lib/request-auth';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { BASELINE_ROW_LIMIT, DRAFT_MAX_INPUT_CHARS, PUBLISH_NETWORKS } from '@/lib/draft-scoring';
import { findRepoRoot } from '@/test/repo-root';

const PERSONA = '11111111-2222-4333-8444-555555555555';

function strongDraft(): string {
  return [
    'The best Porto mornings start before the tourists wake up.',
    '',
    'Walk the riverside while the city is still quiet, order coffee where the locals order coffee, and let the day find you instead of planning every hour of it in advance.',
    '',
    'Slow mornings, real streets, no queues. #Porto #travel',
    '',
    'What is your morning ritual?',
  ].join('\n');
}

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    script_angle: 'Porto mornings', views: 100, likes: 10, comments: 5, saves: 0,
    ...overrides,
  };
}

// Records every chained filter; `limit` resolves the next queued result,
// so the 7d-then-24h fallback is pinned by queue order.
function mockQuery(
  results: Array<{ data: unknown; error: unknown }>,
  personaResult: { data: unknown; error: unknown } = { data: { id: PERSONA }, error: null },
) {
  const calls: Array<[string, ...unknown[]]> = [];
  const queue = [...results];
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'is', 'or', 'order']) {
    builder[method] = vi.fn((...args: unknown[]) => { calls.push([method, ...args]); return builder; });
  }
  builder.limit = vi.fn(async (...args: unknown[]) => {
    calls.push(['limit', ...args]);
    return queue.shift() ?? { data: [], error: null };
  });
  builder.single = vi.fn(async () => personaResult);
  const from = vi.fn((table: string) => { calls.push(['from', table]); return builder; });
  vi.mocked(createSupabaseServiceClient).mockReturnValue({ from } as never);
  return { calls, from };
}

function post(payload: unknown): Promise<Response> {
  return POST(new Request('https://post-engineer.com/api/videos/score-draft', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireSupabaseSession).mockResolvedValue({
    auth: { userId: 'user-1', accessToken: 't' },
    error: null,
  } as never);
});

describe('POST /api/videos/score-draft', () => {
  it('scores a strong draft 100 against the 7d baseline', async () => {
    const { calls, from } = mockQuery([{ data: [row(), row({ views: 50, likes: 0, comments: 0 })], error: null }]);
    const response = await post({ draft: strongDraft(), network: 'linkedin' });

    expect(response.status).toBe(200);
    expect(from).toHaveBeenCalledWith('post_metrics');
    expect(calls).toContainEqual(['eq', 'user_id', 'user-1']);
    expect(calls).toContainEqual(['eq', 'metrics_window', '7d']);
    const payload = (await response.json()) as Record<string, unknown>;
    expect(payload.success).toBe(true);
    expect(payload.score).toBe(100);
    expect(payload.publishCheck).toEqual({ network: 'linkedin', ok: true, failures: [], warnings: [] });
    const baseline = payload.baseline as Record<string, unknown>;
    expect(baseline.postsMeasured).toBe(2);
    expect(baseline.topAngles).toEqual([{ angle: 'Porto mornings', engagement: 165, posts: 2 }]);
  });

  it('falls back to the 24h window when 7d has no rows', async () => {
    const { calls } = mockQuery([
      { data: [], error: null },
      { data: [row()], error: null },
    ]);
    const response = await post({ draft: strongDraft() });

    expect(response.status).toBe(200);
    expect(calls).toContainEqual(['eq', 'metrics_window', '7d']);
    expect(calls).toContainEqual(['eq', 'metrics_window', '24h']);
    const payload = (await response.json()) as Record<string, unknown>;
    const baseline = payload.baseline as Record<string, unknown>;
    expect(baseline.postsMeasured).toBe(1);
  });

  it('applies the persona filter when personaId is given', async () => {
    const { calls } = mockQuery([{ data: [], error: null }, { data: [], error: null }]);
    await post({ draft: strongDraft(), personaId: PERSONA });
    expect(calls).toContainEqual(['eq', 'persona_id', PERSONA]);
    // Ownership is re-checked: the service role bypasses RLS.
    expect(calls).toContainEqual(['from', 'personas']);
    expect(calls).toContainEqual(['eq', 'id', PERSONA]);
    expect(calls).toContainEqual(['eq', 'user_id', 'user-1']);
  });

  it('skips the persona read when no personaId is given', async () => {
    const { calls } = mockQuery([{ data: [row()], error: null }]);
    await post({ draft: strongDraft() });
    expect(calls).not.toContainEqual(['from', 'personas']);
  });

  it('returns 404 for an unknown persona without reading metrics', async () => {
    const { calls } = mockQuery([], { data: null, error: { code: 'PGRST116', message: 'none' } });
    const response = await post({ draft: strongDraft(), personaId: PERSONA });
    expect(response.status).toBe(404);
    expect(calls).not.toContainEqual(['from', 'post_metrics']);
  });

  it('returns 500 when the persona read fails for any other reason', async () => {
    mockQuery([], { data: null, error: { code: '08006', message: 'down' } });
    const response = await post({ draft: strongDraft(), personaId: PERSONA });
    expect(response.status).toBe(500);
  });

  it('returns 403 when the key is scoped away from the persona, without any read', async () => {
    vi.mocked(requireSupabaseSession).mockResolvedValue({
      auth: { userId: 'user-1', accessToken: 't', isApiKey: true, personaIds: ['99999999-2222-4333-8444-555555555555'] },
      error: null,
    } as never);
    const { from } = mockQuery([]);
    const response = await post({ draft: strongDraft(), personaId: PERSONA });
    expect(response.status).toBe(403);
    expect(from).not.toHaveBeenCalled();
  });

  it('orders deterministically and reads one row past the cap', async () => {
    const { calls } = mockQuery([{ data: [row()], error: null }]);
    const response = await post({ draft: strongDraft() });
    expect(calls).toContainEqual(['order', 'collected_at', { ascending: false }]);
    expect(calls).toContainEqual(['order', 'id', { ascending: true }]);
    expect(calls).toContainEqual(['limit', BASELINE_ROW_LIMIT + 1]);
    const payload = (await response.json()) as { baseline: Record<string, unknown> };
    expect(payload.baseline.truncated).toBe(false);
  });

  it('flags a truncated baseline and scores only the capped rows', async () => {
    const rows = Array.from({ length: BASELINE_ROW_LIMIT + 1 }, () => row());
    mockQuery([{ data: rows, error: null }]);
    const response = await post({ draft: strongDraft() });
    const payload = (await response.json()) as { baseline: Record<string, unknown> };
    expect(payload.baseline.truncated).toBe(true);
    expect(payload.baseline.postsMeasured).toBe(BASELINE_ROW_LIMIT);
  });

  it('keeps the MCP schema caps and networks in sync with the route', () => {
    const mcpSource = readFileSync(
      join(findRepoRoot(import.meta.url), 'apps/mcp/src/tools-single-video.ts'),
      'utf8',
    );
    expect(mcpSource).toContain(`.max(${DRAFT_MAX_INPUT_CHARS}, 'draft must be at most ${DRAFT_MAX_INPUT_CHARS} characters')`);
    expect(mcpSource).toContain(`.enum([${PUBLISH_NETWORKS.map((network) => `'${network}'`).join(', ')}])`);
  });

  it('filters the baseline by network when network is given, and not otherwise', async () => {
    const { calls } = mockQuery([{ data: [row()], error: null }]);
    await post({ draft: strongDraft(), network: 'bluesky' });
    expect(calls).toContainEqual(['eq', 'provider', 'bluesky']);

    const unfiltered = mockQuery([{ data: [row()], error: null }]);
    await post({ draft: strongDraft() });
    expect(unfiltered.calls).not.toContainEqual(['eq', 'provider', 'bluesky']);
    expect(unfiltered.calls).not.toContainEqual(['eq', 'provider', 'linkedin']);
  });

  it('rejects an empty draft, an unknown network and a bad persona id', async () => {
    mockQuery([]);
    const empty = await post({ draft: '   ' });
    expect(empty.status).toBe(400);
    expect(((await empty.json()) as Record<string, unknown>).field).toBe('draft');

    const network = await post({ draft: strongDraft(), network: 'tiktok' });
    expect(network.status).toBe(400);
    expect(((await network.json()) as Record<string, unknown>).field).toBe('network');

    const persona = await post({ draft: strongDraft(), personaId: 'not-a-uuid' });
    expect(persona.status).toBe(400);
    expect(((await persona.json()) as Record<string, unknown>).field).toBe('personaId');
  });

  it('limits a persona-scoped API key to its personas plus persona-less rows', async () => {
    vi.mocked(requireSupabaseSession).mockResolvedValue({
      auth: { userId: 'user-1', accessToken: 't', isApiKey: true, personaIds: [PERSONA] },
      error: null,
    } as never);
    const { calls } = mockQuery([{ data: [row()], error: null }]);
    await post({ draft: strongDraft() });
    expect(calls).toContainEqual(['or', `persona_id.in.(${PERSONA}),persona_id.is.null`]);
  });

  it('limits a persona-scoped API key with no personas to persona-less rows', async () => {
    vi.mocked(requireSupabaseSession).mockResolvedValue({
      auth: { userId: 'user-1', accessToken: 't', isApiKey: true, personaIds: [] },
      error: null,
    } as never);
    const { calls } = mockQuery([{ data: [row()], error: null }]);
    await post({ draft: strongDraft() });
    expect(calls).toContainEqual(['is', 'persona_id', null]);
  });

  it('drops malformed stored persona ids before building the scope filter', async () => {
    vi.mocked(requireSupabaseSession).mockResolvedValue({
      auth: { userId: 'user-1', accessToken: 't', isApiKey: true, personaIds: ['bad,id)', PERSONA] },
      error: null,
    } as never);
    const { calls } = mockQuery([{ data: [row()], error: null }]);
    await post({ draft: strongDraft() });
    expect(calls).toContainEqual(['or', `persona_id.in.(${PERSONA}),persona_id.is.null`]);
  });

  it('returns 500 when the baseline query fails', async () => {
    mockQuery([{ data: null, error: { message: 'boom' } }]);
    const response = await post({ draft: strongDraft() });
    expect(response.status).toBe(500);
  });
});
