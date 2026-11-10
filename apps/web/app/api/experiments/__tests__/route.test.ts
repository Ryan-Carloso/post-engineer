import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/service', () => ({ createSupabaseServiceClient: vi.fn() }));
vi.mock('@/lib/request-auth', () => ({ requireSupabaseSession: vi.fn() }));
vi.mock('@/lib/rate-limit', () => ({
  applyRateLimit: vi.fn(async () => null),
  RATE_LIMITS: {
    experimentCreate: { name: 'experiment-create', limit: 10, windowMs: 60_000 },
    experimentRead: { name: 'experiment-read', limit: 60, windowMs: 60_000 },
  },
}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock('@/lib/engine-tasks', () => ({ fetchEnginePostMetricsSource: vi.fn() }));
vi.mock('@/lib/metrics/provider-counters', () => ({ fetchProviderCounters: vi.fn() }));

import { GET as LIST, POST } from '../route';
import { GET as DETAIL } from '../[id]/route';
import { requireSupabaseSession } from '@/lib/request-auth';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import { LIST_LIMIT } from '@/lib/experiments/read';
import { clearLiveExperimentCache } from '@/lib/experiments/live';
import { fetchEnginePostMetricsSource } from '@/lib/engine-tasks';
import { fetchProviderCounters } from '@/lib/metrics/provider-counters';

//---------------
// /api/experiments (issue #476). The Supabase mock answers per table and
// records every chained call; a query resolves at limit(), maybeSingle()
// or when awaited, like supabase-js.
//---------------

const USER = 'user-1';
const PERSONA = '11111111-2222-4333-8444-555555555555';
const EXPERIMENT_ID = '7b0e6c1e-0000-4000-8000-000000000001';

type Answer = { data: unknown; error: unknown };

function mockDb(answers: Record<string, Answer>, rpc: Answer = { data: EXPERIMENT_ID, error: null }) {
  const calls: Array<[string, string, ...unknown[]]> = [];
  const from = vi.fn((table: string) => {
    const answer = answers[table] ?? { data: null, error: null };
    const builder: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'is', 'in', 'or', 'order']) {
      builder[method] = (...args: unknown[]) => {
        calls.push([table, method, ...args]);
        return builder;
      };
    }
    builder.limit = async (...args: unknown[]) => {
      calls.push([table, 'limit', ...args]);
      return answer;
    };
    builder.maybeSingle = async () => answer;
    builder.then = (resolve: (value: Answer) => unknown) => Promise.resolve(answer).then(resolve);
    return builder;
  });
  const rpcFn = vi.fn(async () => rpc);
  vi.mocked(createSupabaseServiceClient).mockReturnValue({ from, rpc: rpcFn } as never);
  return { calls, from, rpc: rpcFn };
}

function auth(overrides: Record<string, unknown> = {}) {
  vi.mocked(requireSupabaseSession).mockResolvedValue({ auth: { userId: USER, ...overrides }, error: null } as never);
}

const VARIANTS = [
  { variantId: 'hook-calm', name: 'Calm', description: 'Calm, curious opening.' },
  { variantId: 'hook-aggressive', name: 'Aggressive', description: 'Direct, provocative opening.' },
];

function createBody(overrides: Record<string, unknown> = {}) {
  return { name: 'Hook test', variable: 'hook', personaId: PERSONA, targetPairs: 6, variants: VARIANTS, ...overrides };
}

function post(body: unknown): Promise<Response> {
  return POST(new Request('http://localhost/api/experiments', { method: 'POST', body: JSON.stringify(body) }));
}

function detail(id: string, query = ''): Promise<Response> {
  return DETAIL(new Request(`http://localhost/api/experiments/${id}${query}`), { params: Promise.resolve({ id }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  clearLiveExperimentCache();
  auth();
});

describe('POST /api/experiments', () => {
  it('creates the experiment and both variants through the atomic RPC', async () => {
    const db = mockDb({ personas: { data: { id: PERSONA }, error: null } });
    const response = await post(createBody());
    expect(response.status).toBe(200);
    expect(applyRateLimit).toHaveBeenCalledWith(expect.any(Request), RATE_LIMITS.experimentCreate, USER);
    expect(db.calls).toContainEqual(['personas', 'eq', 'user_id', USER]);
    expect(db.rpc).toHaveBeenCalledWith('create_experiment', {
      p_user_id: USER,
      p_name: 'Hook test',
      p_variable: 'hook',
      p_persona_id: PERSONA,
      p_target_pairs: 6,
      p_variants: [
        { variant_id: 'hook-calm', name: 'Calm', description: 'Calm, curious opening.' },
        { variant_id: 'hook-aggressive', name: 'Aggressive', description: 'Direct, provocative opening.' },
      ],
    });
    await expect(response.json()).resolves.toMatchObject({ success: true, experiment: { id: EXPERIMENT_ID, personaId: PERSONA, targetPairs: 6 } });
  });

  it('a faceless experiment skips the persona lookup and stores null', async () => {
    const db = mockDb({});
    const response = await post(createBody({ personaId: null }));
    expect(response.status).toBe(200);
    expect(db.from).not.toHaveBeenCalledWith('personas');
    expect(db.rpc.mock.calls[0]).toEqual(['create_experiment', expect.objectContaining({ p_persona_id: null })]);
  });

  it.each([
    ['a third variant', { variants: [...VARIANTS, { variantId: 'hook-x', name: 'X', description: 'x' }] }],
    ['duplicate variant ids', { variants: [VARIANTS[0], { ...VARIANTS[1], variantId: 'hook-calm' }] }],
    ['a letter label', { variants: [{ ...VARIANTS[0], variantId: 'A' }, VARIANTS[1]] }],
    ['too few pairs', { targetPairs: 2 }],
    ['too many pairs', { targetPairs: 21 }],
    ['an unknown variable', { variable: 'cta' }],
    ['a blank name', { name: '   ' }],
    ['an over-length name', { name: 'x'.repeat(121) }],
    ['an unknown key', { extra: true }],
  ])('400 for %s, before any write', async (_label, overrides) => {
    const db = mockDb({});
    const response = await post(createBody(overrides));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it('400 for a non-JSON body', async () => {
    mockDb({});
    const response = await POST(new Request('http://localhost/api/experiments', { method: 'POST', body: 'nope' }));
    expect(response.status).toBe(400);
  });

  it('403 for a persona outside the API key scope; 404 for a foreign persona', async () => {
    auth({ isApiKey: true, personaIds: ['other'] });
    const scoped = mockDb({});
    expect((await post(createBody())).status).toBe(403);
    expect(scoped.rpc).not.toHaveBeenCalled();
    auth();
    const foreign = mockDb({ personas: { data: null, error: null } });
    expect((await post(createBody())).status).toBe(404);
    expect(foreign.rpc).not.toHaveBeenCalled();
  });

  it('500 (logged) when the persona lookup or the RPC fails', async () => {
    mockDb({ personas: { data: null, error: { message: 'down' } } });
    expect((await post(createBody())).status).toBe(500);
    mockDb({ personas: { data: { id: PERSONA }, error: null } }, { data: null, error: { message: 'check violation' } });
    expect((await post(createBody())).status).toBe(500);
    expect(logger.error).toHaveBeenCalledWith('[api/experiments] persona lookup failed', expect.anything(), { personaId: PERSONA });
    expect(logger.error).toHaveBeenCalledWith('[api/experiments] create_experiment failed', expect.anything(), { userId: USER });
  });
});

const EXPERIMENT_ROW = { id: EXPERIMENT_ID, name: 'Hook test', variable: 'hook', persona_id: PERSONA, target_pairs: 3, created_at: '2026-11-07T00:00:00Z' };
const VARIANT_ROWS = [
  { experiment_id: EXPERIMENT_ID, variant_id: 'hook-calm', name: 'Calm', description: 'calm', position: 0 },
  { experiment_id: EXPERIMENT_ID, variant_id: 'hook-aggressive', name: 'Aggressive', description: 'direct', position: 1 },
];

describe('GET /api/experiments', () => {
  it('lists the caller experiments with their variants', async () => {
    const db = mockDb({ experiments: { data: [EXPERIMENT_ROW], error: null }, experiment_variants: { data: VARIANT_ROWS, error: null } });
    const response = await LIST(new Request('http://localhost/api/experiments'));
    expect(response.status).toBe(200);
    expect(db.calls).toContainEqual(['experiments', 'eq', 'user_id', USER]);
    expect(db.calls).toContainEqual(['experiments', 'limit', LIST_LIMIT + 1]);
    const json = await response.json();
    expect(json.truncated).toBe(false);
    expect(json.experiments[0]).toMatchObject({ id: EXPERIMENT_ID, targetPairs: 3, variants: [{ variantId: 'hook-calm' }, { variantId: 'hook-aggressive' }] });
  });

  it('a scoped API key filters by its personas plus persona-less rows', async () => {
    auth({ isApiKey: true, personaIds: [PERSONA, 'not-a-uuid'] });
    const db = mockDb({ experiments: { data: [], error: null } });
    await LIST(new Request('http://localhost/api/experiments'));
    expect(db.calls).toContainEqual(['experiments', 'or', `persona_id.in.(${PERSONA}),persona_id.is.null`]);
  });

  it('400 on a query parameter; 500 when the read fails', async () => {
    mockDb({});
    expect((await LIST(new Request('http://localhost/api/experiments?x=1'))).status).toBe(400);
    mockDb({ experiments: { data: null, error: { message: 'down' } } });
    expect((await LIST(new Request('http://localhost/api/experiments'))).status).toBe(500);
  });
});

describe('GET /api/experiments/[id]', () => {
  const slots = [1, 2, 3].flatMap((pair) => [
    { id: `calm-${pair}`, variant_id: 'hook-calm', experiment_pair: pair, status: 'published', title: 't', slot_at: '2026-11-08T18:00:00Z', published_at: '2026-11-08T18:01:00Z' },
    { id: `aggr-${pair}`, variant_id: 'hook-aggressive', experiment_pair: pair, status: 'published', title: 't', slot_at: '2026-11-09T18:00:00Z', published_at: '2026-11-09T18:01:00Z' },
  ]);
  const metrics = [1, 2, 3].flatMap((pair) => [
    { post_id: `calm-${pair}`, provider: 'youtube', views: 100, likes: 1, comments: 0, average_view_duration_seconds: '12.5' },
    { post_id: `aggr-${pair}`, provider: 'youtube', views: 300, likes: 4, comments: 1, average_view_duration_seconds: 20 },
  ]);

  it('returns the videos and the paired results for the 7d window by default', async () => {
    const db = mockDb({
      experiments: { data: EXPERIMENT_ROW, error: null },
      experiment_variants: { data: VARIANT_ROWS, error: null },
      scheduled_posts: { data: slots, error: null },
      post_metrics: { data: metrics, error: null },
    });
    const response = await detail(EXPERIMENT_ID);
    expect(response.status).toBe(200);
    expect(db.calls).toContainEqual(['post_metrics', 'eq', 'metrics_window', '7d']);
    expect(db.calls).toContainEqual(['post_metrics', 'eq', 'user_id', USER]);
    expect(db.calls).toContainEqual(['scheduled_posts', 'eq', 'experiment_id', EXPERIMENT_ID]);
    const json = await response.json();
    expect(json.window).toBe('7d');
    expect(json.videos).toHaveLength(6);
    expect(json.results.pairsPublished).toBe(3);
    const youtube = json.results.providers[0];
    expect(youtube.wins).toEqual({ 'hook-calm': 0, 'hook-aggressive': 3 });
    expect(youtube.comparisons[0].values['hook-calm'].averageViewDurationSeconds).toBe(12.5);
    // 3 of 3 is p = 0.25: never a clear winner.
    expect(youtube.label).toBe('indicative');
  });

  it('reads another window when asked; 400 on an unknown window', async () => {
    const db = mockDb({
      experiments: { data: EXPERIMENT_ROW, error: null },
      experiment_variants: { data: VARIANT_ROWS, error: null },
      scheduled_posts: { data: [], error: null },
      post_metrics: { data: [], error: null },
    });
    expect((await detail(EXPERIMENT_ID, '?window=28d')).status).toBe(200);
    expect(db.calls).toContainEqual(['post_metrics', 'eq', 'metrics_window', '28d']);
    expect((await detail(EXPERIMENT_ID, '?window=1y')).status).toBe(400);
  });

  it('404 for a non-uuid id, an unknown experiment and an out-of-scope persona', async () => {
    const db = mockDb({ experiments: { data: null, error: null } });
    expect((await detail('not-a-uuid')).status).toBe(404);
    expect(db.from).not.toHaveBeenCalled();
    expect((await detail(EXPERIMENT_ID)).status).toBe(404);
    auth({ isApiKey: true, personaIds: ['other'] });
    mockDb({ experiments: { data: EXPERIMENT_ROW, error: null } });
    expect((await detail(EXPERIMENT_ID)).status).toBe(404);
  });

  it('500 (logged) when a read fails', async () => {
    mockDb({
      experiments: { data: EXPERIMENT_ROW, error: null },
      experiment_variants: { data: VARIANT_ROWS, error: null },
      scheduled_posts: { data: null, error: { message: 'down' } },
    });
    expect((await detail(EXPERIMENT_ID)).status).toBe(500);
    expect(logger.error).toHaveBeenCalled();
  });
});

describe('GET /api/experiments/[id] ?live=1', () => {
  // Published 2h ago, so the 7d window is still live-reading.
  const recentSlots = [1, 2, 3].flatMap((pair) => [
    { id: `calm-${pair}`, variant_id: 'hook-calm', experiment_pair: pair, status: 'published', title: 't', slot_at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(), published_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), task_id: `task-calm-${pair}` },
    { id: `aggr-${pair}`, variant_id: 'hook-aggressive', experiment_pair: pair, status: 'published', title: 't', slot_at: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(), published_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), task_id: `task-aggr-${pair}` },
  ]);
  const metrics = [1, 2, 3].flatMap((pair) => [
    { post_id: `calm-${pair}`, provider: 'youtube', views: 100, likes: 1, comments: 0, average_view_duration_seconds: '12.5' },
    { post_id: `aggr-${pair}`, provider: 'youtube', views: 300, likes: 4, comments: 1, average_view_duration_seconds: 20 },
  ]);

  function mockLive() {
    vi.mocked(fetchEnginePostMetricsSource).mockImplementation(async (taskId: string) => ({
      publishResults: [
        { status: 'published', provider: 'youtube', accountId: 'acc-1', videoUrl: `https://www.youtube.com/watch?v=vid-${taskId}` },
      ],
      scriptAngle: null,
    }));
    vi.mocked(fetchProviderCounters).mockImplementation(async (_userId: string, target: { externalId: string }) => ({
      // Live views flip the snapshot winner: calm 500 beats aggressive 250.
      views: target.externalId.includes('calm') ? 500 : 250,
      likes: 2,
      comments: 1,
      saves: null,
    }));
  }

  function mockLiveDb() {
    return mockDb({
      experiments: { data: EXPERIMENT_ROW, error: null },
      experiment_variants: { data: VARIANT_ROWS, error: null },
      scheduled_posts: { data: recentSlots, error: null },
      post_metrics: { data: metrics, error: null },
    });
  }

  it('re-reads live counters and reports the live source', async () => {
    mockLive();
    mockLiveDb();
    const response = await detail(EXPERIMENT_ID, '?live=1');
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.source).toBe('live');
    expect(typeof json.liveAt).toBe('string');
    expect(json.liveFailures).toEqual([]);
    expect(json.frozen).toBe(false);
    expect(json.results.providers[0].wins).toEqual({ 'hook-calm': 3, 'hook-aggressive': 0 });
    expect(json.results.providers[0].comparisons[0].values['hook-calm'].views).toBe(500);
  });

  it('snapshot mode (no live param) has no live fields, so the MCP tool is unchanged', async () => {
    mockLive();
    mockLiveDb();
    const json = await (await detail(EXPERIMENT_ID)).json();
    expect(json.source).toBeUndefined();
    expect(json.liveAt).toBeUndefined();
    expect(json.results.providers[0].wins).toEqual({ 'hook-calm': 0, 'hook-aggressive': 3 });
    expect(fetchProviderCounters).not.toHaveBeenCalled();
  });

  it('400 for live=2 and for live on the 28d window; live=0 is snapshot mode', async () => {
    mockLiveDb();
    expect((await detail(EXPERIMENT_ID, '?live=2')).status).toBe(400);
    expect((await detail(EXPERIMENT_ID, '?live=1&window=28d')).status).toBe(400);
    expect((await detail(EXPERIMENT_ID, '?live=0')).status).toBe(200);
    expect(fetchProviderCounters).not.toHaveBeenCalled();
  });

  it('a failed engine read keeps the snapshot and reports the failures', async () => {
    mockLiveDb();
    vi.mocked(fetchEnginePostMetricsSource).mockRejectedValue(new Error('engine down'));
    const response = await detail(EXPERIMENT_ID, '?live=1');
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.source).toBe('snapshot');
    expect(json.liveAt).toBe(null);
    expect(json.liveFailures).toHaveLength(6);
    expect(json.results.providers[0].wins).toEqual({ 'hook-calm': 0, 'hook-aggressive': 3 });
  });
});

describe('exact response contracts', () => {
  const limitedResponse = () => new Response('limited', { status: 429 });

  it('POST returns the full success body, with the variants echoed back', async () => {
    mockDb({ personas: { data: { id: PERSONA }, error: null } });
    const response = await post(createBody());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      experiment: { id: EXPERIMENT_ID, name: 'Hook test', variable: 'hook', personaId: PERSONA, targetPairs: 6, variants: VARIANTS },
    });
  });

  it('POST queries the persona by id and owner with the id column only', async () => {
    const db = mockDb({ personas: { data: { id: PERSONA }, error: null } });
    await post(createBody());
    expect(db.from).toHaveBeenCalledWith('personas');
    expect(db.calls).toContainEqual(['personas', 'select', 'id']);
    expect(db.calls).toContainEqual(['personas', 'eq', 'id', PERSONA]);
    expect(db.calls).toContainEqual(['personas', 'eq', 'user_id', USER]);
  });

  it('POST returns an auth error as-is and does nothing else', async () => {
    const authError = new Response('nope', { status: 401 });
    vi.mocked(requireSupabaseSession).mockResolvedValue({ auth: null, error: authError } as never);
    const db = mockDb({});
    expect(await post(createBody())).toBe(authError);
    expect(applyRateLimit).not.toHaveBeenCalled();
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it('POST returns the rate-limit response as-is before parsing the body', async () => {
    const limited = limitedResponse();
    vi.mocked(applyRateLimit).mockResolvedValueOnce(limited as never);
    const db = mockDb({});
    expect(await post(createBody())).toBe(limited);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it('POST 400 for invalid JSON has the exact message and code', async () => {
    mockDb({});
    const response = await POST(new Request('http://localhost/api/experiments', { method: 'POST', body: 'nope' }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ success: false, error: 'Invalid JSON payload.', code: 'VALIDATION_FAILED' });
  });

  it('POST 400 names the failing field and message', async () => {
    mockDb({});
    const response = await post(createBody({ targetPairs: 2 }));
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.code).toBe('VALIDATION_FAILED');
    expect(json.field).toBe('targetPairs');
    expect(json.error.startsWith('Invalid request: targetPairs: ')).toBe(true);
    expect(json.error.length).toBeLessThanOrEqual(500);
  });

  it('POST 400 for a root-level issue has no field prefix and an empty field', async () => {
    mockDb({});
    const response = await post([]);
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.field).toBe('');
    expect(json.error.startsWith('Invalid request: ')).toBe(true);
    expect(json.error.startsWith('Invalid request: : ')).toBe(false);
  });

  it('POST 400 joins a nested path with dots', async () => {
    mockDb({});
    const response = await post(createBody({ variants: [VARIANTS[0], { ...VARIANTS[1], variantId: 'A' }] }));
    const json = await response.json();
    expect(json.field).toBe('variants.1.variantId');
    expect(json.error.startsWith('Invalid request: variants.1.variantId: ')).toBe(true);
  });

  it('POST 400 truncates an over-long message to 500 characters and the field to 200', async () => {
    mockDb({});
    const longKey = 'k'.repeat(600);
    const response = await post(createBody({ [longKey]: true }));
    const json = await response.json();
    expect(response.status).toBe(400);
    expect(json.error.length).toBeLessThanOrEqual(500);
    expect(json.field.length).toBeLessThanOrEqual(200);
  });

  it('POST 403 and 404 persona errors have exact messages and codes', async () => {
    auth({ isApiKey: true, personaIds: ['other'] });
    mockDb({});
    const denied = await post(createBody());
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({ success: false, error: 'This API key cannot access the selected persona.', code: 'PERSONA_SCOPE_DENIED' });
    auth();
    mockDb({ personas: { data: null, error: null } });
    const missing = await post(createBody());
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ success: false, error: 'Persona not found.', code: 'PERSONA_NOT_FOUND' });
  });

  it('POST allows a persona inside the API key scope', async () => {
    auth({ isApiKey: true, personaIds: [PERSONA] });
    const db = mockDb({ personas: { data: { id: PERSONA }, error: null } });
    expect((await post(createBody())).status).toBe(200);
    expect(db.rpc).toHaveBeenCalled();
  });

  it('POST 500s carry the generic message, log the cause with exact arguments', async () => {
    const personaError = { message: 'down' };
    mockDb({ personas: { data: null, error: personaError } });
    const first = await post(createBody());
    expect(first.status).toBe(500);
    expect(await first.json()).toMatchObject({ success: false, error: 'Failed to create the experiment.' });
    expect(logger.error).toHaveBeenCalledWith('[api/experiments] persona lookup failed', personaError, { personaId: PERSONA });
    vi.mocked(logger.error).mockClear();
    const rpcError = { message: 'check violation' };
    mockDb({ personas: { data: { id: PERSONA }, error: null } }, { data: null, error: rpcError });
    const second = await post(createBody());
    expect(second.status).toBe(500);
    expect(await second.json()).toMatchObject({ success: false, error: 'Failed to create the experiment.' });
    expect(logger.error).toHaveBeenCalledWith('[api/experiments] create_experiment failed', rpcError, { userId: USER });
  });

  it('POST 500 when the RPC answers without an id string, even with no error', async () => {
    mockDb({ personas: { data: { id: PERSONA }, error: null } }, { data: 42, error: null });
    const response = await post(createBody());
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: 'Failed to create the experiment.' });
    mockDb({ personas: { data: { id: PERSONA }, error: null } }, { data: EXPERIMENT_ID, error: { message: 'late' } });
    expect((await post(createBody())).status).toBe(500);
  });

  it('GET list returns the exact body and checks the rate limit with the read bucket', async () => {
    mockDb({ experiments: { data: [EXPERIMENT_ROW], error: null }, experiment_variants: { data: VARIANT_ROWS, error: null } });
    const response = await LIST(new Request('http://localhost/api/experiments'));
    expect(applyRateLimit).toHaveBeenCalledWith(expect.any(Request), RATE_LIMITS.experimentRead, USER);
    expect(await response.json()).toEqual({
      success: true,
      truncated: false,
      experiments: [
        {
          id: EXPERIMENT_ID,
          name: 'Hook test',
          variable: 'hook',
          personaId: PERSONA,
          targetPairs: 3,
          createdAt: '2026-11-07T00:00:00Z',
          variants: [
            { variantId: 'hook-calm', name: 'Calm', description: 'calm' },
            { variantId: 'hook-aggressive', name: 'Aggressive', description: 'direct' },
          ],
        },
      ],
    });
  });

  it('GET list returns auth and rate-limit responses as-is', async () => {
    const authError = new Response('nope', { status: 401 });
    vi.mocked(requireSupabaseSession).mockResolvedValue({ auth: null, error: authError } as never);
    mockDb({});
    expect(await LIST(new Request('http://localhost/api/experiments'))).toBe(authError);
    expect(applyRateLimit).not.toHaveBeenCalled();
    auth();
    const limited = limitedResponse();
    vi.mocked(applyRateLimit).mockResolvedValueOnce(limited as never);
    const db = mockDb({});
    expect(await LIST(new Request('http://localhost/api/experiments?x=1'))).toBe(limited);
    expect(db.from).not.toHaveBeenCalled();
  });

  it('GET list 400 and 500 have exact bodies; the 500 logs the cause', async () => {
    const db = mockDb({});
    const bad = await LIST(new Request('http://localhost/api/experiments?x=1'));
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ success: false, error: 'Unknown query parameter.', code: 'VALIDATION_FAILED' });
    expect(db.from).not.toHaveBeenCalled();
    const readError = { message: 'down' };
    mockDb({ experiments: { data: null, error: readError } });
    const failed = await LIST(new Request('http://localhost/api/experiments'));
    expect(failed.status).toBe(500);
    expect(await failed.json()).toMatchObject({ success: false, error: 'Failed to load experiments.' });
    expect(logger.error).toHaveBeenCalledWith('[api/experiments] list failed', readError);
  });

  it('detail returns auth and rate-limit responses as-is', async () => {
    const authError = new Response('nope', { status: 401 });
    vi.mocked(requireSupabaseSession).mockResolvedValue({ auth: null, error: authError } as never);
    mockDb({});
    expect(await detail(EXPERIMENT_ID)).toBe(authError);
    expect(applyRateLimit).not.toHaveBeenCalled();
    auth();
    const limited = limitedResponse();
    vi.mocked(applyRateLimit).mockResolvedValueOnce(limited as never);
    const db = mockDb({});
    expect(await detail(EXPERIMENT_ID)).toBe(limited);
    expect(db.from).not.toHaveBeenCalled();
    expect(applyRateLimit).toHaveBeenLastCalledWith(expect.any(Request), RATE_LIMITS.experimentRead, USER);
  });

  it('detail 400 for a bad window or query parameter has the exact message', async () => {
    const db = mockDb({});
    const window = await detail(EXPERIMENT_ID, '?window=1y');
    expect(window.status).toBe(400);
    expect(await window.json()).toEqual({ success: false, error: 'window must be one of 24h, 7d, 28d.', code: 'VALIDATION_FAILED' });
    const unknown = await detail(EXPERIMENT_ID, '?x=1');
    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toEqual({ success: false, error: 'Unknown query parameter.', code: 'VALIDATION_FAILED' });
    expect(db.from).not.toHaveBeenCalled();
  });

  it('detail 404s have the exact message: bad uuid, undecodable id, unknown experiment', async () => {
    const db = mockDb({ experiments: { data: null, error: null } });
    for (const id of ['not-a-uuid', '%E0%A4%A', EXPERIMENT_ID]) {
      const response = await detail(id);
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ success: false, error: 'Experiment not found.' });
    }
    expect(db.from).toHaveBeenCalledTimes(1);
  });

  it('detail decodes a percent-encoded uuid before matching', async () => {
    mockDb({
      experiments: { data: EXPERIMENT_ROW, error: null },
      experiment_variants: { data: VARIANT_ROWS, error: null },
      scheduled_posts: { data: [], error: null },
      post_metrics: { data: [], error: null },
    });
    const encoded = EXPERIMENT_ID.replace('7b0e', '%37b0e');
    expect((await detail(encoded)).status).toBe(200);
  });

  it('detail 500 has the generic message and logs the cause with the experiment id', async () => {
    const readError = { message: 'down' };
    mockDb({
      experiments: { data: EXPERIMENT_ROW, error: null },
      experiment_variants: { data: VARIANT_ROWS, error: null },
      scheduled_posts: { data: null, error: readError },
    });
    const response = await detail(EXPERIMENT_ID);
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ success: false, error: 'Failed to load the experiment.' });
    expect(logger.error).toHaveBeenCalledWith('[api/experiments] results read failed', readError, { experimentId: EXPERIMENT_ID });
  });

  it('detail success body keeps success true and the experiment', async () => {
    mockDb({
      experiments: { data: EXPERIMENT_ROW, error: null },
      experiment_variants: { data: VARIANT_ROWS, error: null },
      scheduled_posts: { data: [], error: null },
      post_metrics: { data: [], error: null },
    });
    const json = await (await detail(EXPERIMENT_ID, '?window=24h')).json();
    expect(json.success).toBe(true);
    expect(json.window).toBe('24h');
    expect(json.experiment.id).toBe(EXPERIMENT_ID);
  });
});
