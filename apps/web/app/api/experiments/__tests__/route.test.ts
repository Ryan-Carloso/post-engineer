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

import { GET as LIST, POST } from '../route';
import { GET as DETAIL } from '../[id]/route';
import { requireSupabaseSession } from '@/lib/request-auth';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import { LIST_LIMIT } from '@/lib/experiments/read';

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
