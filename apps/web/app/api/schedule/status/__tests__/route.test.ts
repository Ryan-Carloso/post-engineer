import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextResponse } from 'next/server';

vi.mock('@/lib/request-auth', () => ({
  requireSupabaseSession: vi.fn(),
  engineAuthHeaders: (userId: string) => ({ 'x-user-id': userId }),
}));
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
}));
vi.mock('@/lib/supabase/service', () => ({
  createSupabaseServiceClient: vi.fn(),
}));
vi.mock('@/lib/schedule-progress-history', () => ({
  recordProgressHistory: vi.fn(async () => undefined),
}));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { parseLimit, GET } from '../route';
import { requireSupabaseSession } from '@/lib/request-auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { recordProgressHistory } from '@/lib/schedule-progress-history';
import { logger } from '@/lib/logger';

//---------------
// Unit tests for the ?limit= query param of GET /api/schedule/status.
//---------------

describe('parseLimit', () => {
  it('defaults to 10 when the param is missing', () => {
    expect(parseLimit(null)).toBe(10);
  });

  it('accepts valid positive integers', () => {
    expect(parseLimit('50')).toBe(50);
    expect(parseLimit('1')).toBe(1);
  });

  it('falls back to 10 for non-numeric or non-positive values', () => {
    expect(parseLimit('abc')).toBe(10);
    expect(parseLimit('0')).toBe(10);
    expect(parseLimit('-5')).toBe(10);
    expect(parseLimit('')).toBe(10);
  });

  it('falls back to 10 for partially-numeric values', () => {
    // Number.parseInt('12abc', 10) returns 12 — require the whole string
    // to be digits so the contract is exact.
    expect(parseLimit('12abc')).toBe(10);
    expect(parseLimit(' 20')).toBe(10);
    expect(parseLimit('20 ')).toBe(10);
  });

  it('caps the limit at 500', () => {
    expect(parseLimit('1000')).toBe(500);
    expect(parseLimit('500')).toBe(500);
  });
});

//---------------
// Auth tests — GET /api/schedule/status must accept the MCP/API-key
// flow (Bearer key or OAuth token) via requireSupabaseSession, while
// keeping the cookie session working for the web app.
//---------------

const USER_ID = 'user-1';

function mockPostsClient(upcoming: unknown[], recent: unknown[], queue: unknown[] = []) {
  let limitCalls = 0;
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn(async () => ({ data: limitCalls++ === 0 ? upcoming : recent, error: null })),
    // The queue-positions query is awaited without .limit() (the real
    // Supabase chain is thenable); it resolves the queue fixture.
    then: (resolve: (value: unknown) => void) => resolve({ data: queue, error: null }),
  };
  const from = vi.fn(() => chain);
  return { from, chain };
}

function mockAuthSession(auth: unknown, error: unknown) {
  vi.mocked(requireSupabaseSession).mockResolvedValue({ auth, error } as never);
}

//---------------
// Scoped-key mock: from('schedules') resolves the allowed schedule ids,
// from('scheduled_posts') captures the .in('schedule_id', …) filter.
//---------------
function mockScopedPostsClient(allowedScheduleIds: string[], upcoming: unknown[], recent: unknown[], queue: unknown[] = []) {
  let limitCalls = 0;
  const postsChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn(async () => ({ data: limitCalls++ === 0 ? upcoming : recent, error: null })),
    // Thenable like the real Supabase chain: the queue-positions query is
    // awaited without .limit().
    then: (resolve: (value: unknown) => void) => resolve({ data: queue, error: null }),
  };
  const schedulesChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn(async () => ({ data: allowedScheduleIds.map((id) => ({ id })), error: null })),
  };
  const from = vi.fn((table: string) => (table === 'schedules' ? schedulesChain : postsChain));
  return { from, postsChain, schedulesChain };
}

describe('GET auth', () => {
  const upcoming = [{ id: 'up-1', slot_at: '2026-09-24T10:00:00Z', status: 'pending', topic: 'Next', schedule_id: 's1' }];
  const recent = [{ id: 're-1', slot_at: '2026-09-20T10:00:00Z', status: 'published', topic: 'Old', schedule_id: 's1' }];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('accepts an API key and queries with the service client', async () => {
    const client = mockPostsClient(upcoming, recent);
    mockAuthSession({ userId: USER_ID, accessToken: 'pe_test_key', isApiKey: true }, null);
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await GET(new Request('https://example.com/api/schedule/status?limit=5'));

    expect(requireSupabaseSession).toHaveBeenCalledOnce();
    expect(createSupabaseServiceClient).toHaveBeenCalledOnce();
    expect(createSupabaseServerClient).not.toHaveBeenCalled();
    expect(client.chain.eq).toHaveBeenCalledWith('user_id', USER_ID);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      success: true,
      upcoming: upcoming.map((slot) => ({
        ...slot,
        status: 'awaiting',
        progress: 0,
        stage: null,
        queuePosition: null,
        queueTotal: null,
        retryable: null,
      })),
      recent: recent.map((slot) => ({
        ...slot,
        progress: 100,
        stage: 'done',
        queuePosition: null,
        queueTotal: null,
        retryable: null,
      })),
    });
  });

  it('keeps working with a cookie session through the server client', async () => {
    const client = mockPostsClient(upcoming, recent);
    mockAuthSession({ userId: USER_ID, accessToken: 'jwt' }, null);
    vi.mocked(createSupabaseServerClient).mockResolvedValue(client as never);

    const response = await GET(new Request('https://example.com/api/schedule/status'));

    expect(createSupabaseServerClient).toHaveBeenCalledOnce();
    expect(createSupabaseServiceClient).not.toHaveBeenCalled();
    expect(client.chain.eq).toHaveBeenCalledWith('user_id', USER_ID);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      success: true,
      upcoming: upcoming.map((slot) => ({
        ...slot,
        status: 'awaiting',
        progress: 0,
        stage: null,
        queuePosition: null,
        queueTotal: null,
        retryable: null,
      })),
      recent: recent.map((slot) => ({
        ...slot,
        progress: 100,
        stage: 'done',
        queuePosition: null,
        queueTotal: null,
        retryable: null,
      })),
    });
  });

  it('returns 401 when authentication fails', async () => {
    const authError = NextResponse.json(
      { success: false, error: 'Authentication required.' },
      { status: 401 },
    );
    mockAuthSession(null, authError);

    const response = await GET(new Request('https://example.com/api/schedule/status'));

    expect(response.status).toBe(401);
    expect(createSupabaseServiceClient).not.toHaveBeenCalled();
    expect(createSupabaseServerClient).not.toHaveBeenCalled();
  });

  it('uses the service client for OAuth tokens (no silent-empty via RLS)', async () => {
    const client = mockPostsClient(upcoming, recent);
    mockAuthSession({ userId: USER_ID, accessToken: 'oauth.jwt.token', isOAuth: true }, null);
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await GET(new Request('https://example.com/api/schedule/status'));

    expect(createSupabaseServiceClient).toHaveBeenCalledOnce();
    expect(createSupabaseServerClient).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      success: true,
      upcoming: upcoming.map((slot) => ({
        ...slot,
        status: 'awaiting',
        progress: 0,
        stage: null,
        queuePosition: null,
        queueTotal: null,
        retryable: null,
      })),
      recent: recent.map((slot) => ({
        ...slot,
        progress: 100,
        stage: 'done',
        queuePosition: null,
        queueTotal: null,
        retryable: null,
      })),
    });
  });

  it('restricts a persona-scoped API key to its allowed schedules', async () => {
    const allowedUpcoming = [{ id: 'up-1', slot_at: '2026-09-24T10:00:00Z', status: 'pending', topic: 'Next', schedule_id: 's1' }];
    const allowedRecent = [{ id: 're-1', slot_at: '2026-09-20T10:00:00Z', status: 'published', topic: 'Old', schedule_id: 's1' }];
    const client = mockScopedPostsClient(['s1'], allowedUpcoming, allowedRecent);
    mockAuthSession(
      { userId: USER_ID, accessToken: 'pe_live_scoped', isApiKey: true, keyId: 'key-1', personaIds: ['p1'] },
      null,
    );
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await GET(new Request('https://example.com/api/schedule/status'));

    expect(response.status).toBe(200);
    // The schedules table is queried for ids owned by the allowed personas.
    expect(client.from).toHaveBeenCalledWith('schedules');
    expect(client.schedulesChain.eq).toHaveBeenCalledWith('user_id', USER_ID);
    expect(client.schedulesChain.in).toHaveBeenCalledWith('persona_id', ['p1']);
    // Both post queries are restricted to the allowed schedule ids.
    expect(client.postsChain.in).toHaveBeenCalledWith('schedule_id', ['s1']);
    const body = await response.json();
    expect(body).toEqual({
      success: true,
      upcoming: allowedUpcoming.map((slot) => ({
        ...slot,
        status: 'awaiting',
        progress: 0,
        stage: null,
        queuePosition: null,
        queueTotal: null,
        retryable: null,
      })),
      recent: allowedRecent.map((slot) => ({
        ...slot,
        progress: 100,
        stage: 'done',
        queuePosition: null,
        queueTotal: null,
        retryable: null,
      })),
    });
  });

  it('returns empty lists for a scoped key with no allowed schedules', async () => {
    const client = mockScopedPostsClient([], [], []);
    mockAuthSession(
      { userId: USER_ID, accessToken: 'pe_live_scoped', isApiKey: true, keyId: 'key-1', personaIds: ['p1'] },
      null,
    );
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await GET(new Request('https://example.com/api/schedule/status'));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ success: true, upcoming: [], recent: [] });
    expect(client.from).not.toHaveBeenCalledWith('scheduled_posts');
  });
});

describe('GET progress linkage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('selects task_id on upcoming slots so callers can poll get_video_task_progress', async () => {
    const upcoming = [
      { id: 'up-1', slot_at: '2026-09-24T10:00:00Z', status: 'generating', topic: 'Next', schedule_id: 's1', task_id: 'task-1' },
    ];
    const client = mockPostsClient(upcoming, []);
    mockAuthSession({ userId: USER_ID, accessToken: 'pe_test_key', isApiKey: true }, null);
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await GET(new Request('https://example.com/api/schedule/status'));
    expect(response.status).toBe(200);
    // The upcoming select must include task_id: the engine sets it when
    // generation dispatches, and agents poll progress with it.
    const selectCalls = client.chain.select.mock.calls.map((c) => String(c[0]));
    expect(selectCalls.some((s) => s.includes('task_id'))).toBe(true);
    const body = (await response.json()) as { upcoming: { task_id: string }[] };
    expect(body.upcoming[0].task_id).toBe('task-1');
  });
});

describe('GET slot progress (0–100)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('MONEYPRINT_API_URL', 'https://engine.test');
    vi.stubEnv('MONEYPRINT_API_SECRET', 'secret');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  function mockEngine(body: unknown, ok = true) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok, status: ok ? 200 : 502, json: async () => body })),
    );
  }

  async function getStatus(upcoming: unknown[], recent: unknown[] = [], queue: unknown[] = []) {
    const client = mockPostsClient(upcoming, recent, queue);
    mockAuthSession({ userId: USER_ID, accessToken: 'pe_test_key', isApiKey: true }, null);
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);
    const response = await GET(new Request('https://example.com/api/schedule/status'));
    expect(response.status).toBe(200);
    return (await response.json()) as {
      upcoming: SlotPresentation[];
      recent: SlotPresentation[];
    };
  }

  interface SlotPresentation {
    id: string;
    status: string;
    progress: number;
    stage: string | null;
    queuePosition: number | null;
    queueTotal: number | null;
    retryable: boolean | null;
    error?: string;
  }

  it('pending → 0 sem chamar o engine', async () => {
    mockEngine({ body: { progress: 99 } });
    const body = await getStatus([
      { id: 'up-1', slot_at: '2026-09-24T10:00:00Z', status: 'pending', topic: 'Next', schedule_id: 's1' },
    ]);
    expect(body.upcoming[0].progress).toBe(0);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it('generating → progresso live do engine via task_id', async () => {
    mockEngine({ body: { progress: 45, state: 4 } });
    const body = await getStatus([
      { id: 'up-1', slot_at: '2026-09-24T10:00:00Z', status: 'generating', topic: 'Next', schedule_id: 's1', task_id: 'task-1' },
    ]);
    expect(body.upcoming[0].progress).toBe(45);
    const url = vi.mocked(fetch).mock.calls[0][0] as string;
    expect(url).toContain('/api/v1/tasks/task-1');
  });

  it('caps the engine fan-out and degrades past the cap to progress 0', async () => {
    mockEngine({ body: { progress: 62, stage: 'lipsync' } });
    const slots = Array.from({ length: 30 }, (_, i) => ({
      id: `up-${i}`,
      slot_at: '2026-09-24T10:00:00Z',
      status: 'generating',
      topic: `Topic ${i}`,
      schedule_id: 's1',
      task_id: `task-${i}`,
    }));
    const body = await getStatus(slots);

    // Only ENGINE_LOOKUP_CAP (25) engine calls; the rest degrade to 0.
    expect(vi.mocked(fetch).mock.calls.length).toBe(25);
    expect(body.upcoming.slice(0, 25).every((s) => s.progress === 62)).toBe(true);
    expect(body.upcoming.slice(25).every((s) => s.progress === 0)).toBe(true);
  });

  it('generating sem task_id → 0 sem chamar o engine', async () => {
    mockEngine({ body: { progress: 45 } });
    const body = await getStatus([
      { id: 'up-1', slot_at: '2026-09-24T10:00:00Z', status: 'generating', topic: 'Next', schedule_id: 's1' },
    ]);
    expect(body.upcoming[0].progress).toBe(0);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it('ready/publishing/published → 100', async () => {
    mockEngine({ body: { progress: 10 } });
    const body = await getStatus(
      [
        { id: 'up-1', slot_at: '2026-09-24T10:00:00Z', status: 'ready', topic: 'A', schedule_id: 's1' },
        { id: 'up-2', slot_at: '2026-09-24T11:00:00Z', status: 'publishing', topic: 'B', schedule_id: 's1' },
      ],
      [{ id: 're-1', slot_at: '2026-09-20T10:00:00Z', status: 'published', topic: 'C', schedule_id: 's1' }],
    );
    expect(body.upcoming.map((s) => s.progress)).toEqual([100, 100]);
    expect(body.recent[0].progress).toBe(100);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it('busca os progressos em concorrência, não em série', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 10));
        inFlight--;
        return { ok: true, status: 200, json: async () => ({ body: { progress: 50 } }) };
      }),
    );
    const upcoming = [1, 2, 3, 4].map((i) => ({
      id: `up-${i}`, slot_at: '2026-09-24T10:00:00Z', status: 'generating',
      topic: 'T', schedule_id: 's1', task_id: `task-${i}`,
    }));
    const body = await getStatus(upcoming);
    expect(body.upcoming.map((s) => s.progress)).toEqual([50, 50, 50, 50]);
    expect(maxInFlight).toBeGreaterThan(1);
  });

  it('mapeia pending do banco para "awaiting" com posição na fila', async () => {
    mockEngine({ body: { progress: 99 } });
    const queue = [
      { id: 'up-1', schedule_id: 's1', slot_at: '2026-09-24T10:00:00Z' },
      { id: 'up-2', schedule_id: 's1', slot_at: '2026-09-24T11:00:00Z' },
    ];
    const body = await getStatus(
      [
        { id: 'up-1', slot_at: '2026-09-24T10:00:00Z', status: 'pending', topic: 'Next', schedule_id: 's1' },
        { id: 'up-2', slot_at: '2026-09-24T11:00:00Z', status: 'pending', topic: 'After', schedule_id: 's1' },
      ],
      [],
      queue,
    );
    expect(body.upcoming[0].status).toBe('awaiting');
    expect(body.upcoming[0].progress).toBe(0);
    expect(body.upcoming[0].stage).toBeNull();
    expect(body.upcoming[0].queuePosition).toBe(1);
    expect(body.upcoming[0].queueTotal).toBe(2);
    expect(body.upcoming[1].queuePosition).toBe(2);
    expect(body.upcoming[1].queueTotal).toBe(2);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it('generating repassa o stage do engine e não expõe posição de fila', async () => {
    mockEngine({ body: { progress: 45, stage: 'lipsync' } });
    const queue = [
      { id: 'gen-1', schedule_id: 's1', slot_at: '2026-09-24T10:00:00Z' },
      { id: 'up-1', schedule_id: 's1', slot_at: '2026-09-24T11:00:00Z' },
    ];
    const body = await getStatus(
      [
        { id: 'gen-1', slot_at: '2026-09-24T10:00:00Z', status: 'generating', topic: 'Now', schedule_id: 's1', task_id: 'task-1' },
        { id: 'up-1', slot_at: '2026-09-24T11:00:00Z', status: 'pending', topic: 'Next', schedule_id: 's1' },
      ],
      [],
      queue,
    );
    expect(body.upcoming[0].status).toBe('generating');
    expect(body.upcoming[0].progress).toBe(45);
    expect(body.upcoming[0].stage).toBe('lipsync');
    expect(body.upcoming[0].queuePosition).toBeNull();
    expect(body.upcoming[0].queueTotal).toBeNull();
    // O generating conta na fila: o awaiting vem depois dele.
    expect(body.upcoming[1].status).toBe('awaiting');
    expect(body.upcoming[1].queuePosition).toBe(2);
    expect(body.upcoming[1].queueTotal).toBe(2);
  });

  it('ready/publishing/published têm stage "done"', async () => {
    const body = await getStatus(
      [{ id: 'up-1', slot_at: '2026-09-24T10:00:00Z', status: 'ready', topic: 'A', schedule_id: 's1' }],
      [{ id: 're-1', slot_at: '2026-09-20T10:00:00Z', status: 'published', topic: 'B', schedule_id: 's1' }],
    );
    expect(body.upcoming[0].stage).toBe('done');
    expect(body.recent[0].stage).toBe('done');
  });

  it('failed mantém error, último progresso e retryable pela categoria', async () => {
    mockEngine({ body: { progress: 80, state: -1 } });
    const body = await getStatus(
      [],
      [
        { id: 're-1', slot_at: '2026-09-20T10:00:00Z', status: 'failed', topic: 'A', schedule_id: 's1', task_id: 'task-9', error: 'Video service is unavailable.' },
        { id: 're-2', slot_at: '2026-09-19T10:00:00Z', status: 'failed', topic: 'B', schedule_id: 's1', error: 'custom audio file is invalid' },
      ],
    );
    expect(body.recent[0].status).toBe('failed');
    expect(body.recent[0].progress).toBe(80);
    expect(body.recent[0].error).toBe('Video service is unavailable.');
    expect(body.recent[0].retryable).toBe(true);
    expect(body.recent[0].stage).toBeNull();
    expect(body.recent[1].progress).toBe(0);
    expect(body.recent[1].retryable).toBe(false);
  });

  it('engine fora do ar degrada o slot sem falhar o request', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down'); }));
    const body = await getStatus(
      [{ id: 'up-1', slot_at: '2026-09-24T10:00:00Z', status: 'generating', topic: 'Next', schedule_id: 's1', task_id: 'task-1' }],
      [{ id: 're-1', slot_at: '2026-09-20T10:00:00Z', status: 'failed', topic: 'Old', schedule_id: 's1', task_id: 'task-9', error: 'boom' }],
    );
    expect(body.upcoming[0].progress).toBe(0);
    expect(body.upcoming[0].stage).toBeNull();
    expect(body.recent[0].progress).toBe(0);
    expect(body.recent[0].retryable).toBe(false);
  });

  //---------------
  // Engine lookup cap — only slots that actually need a live lookup
  // (generating/failed WITH a task id) consume the ENGINE_LOOKUP_CAP
  // budget. Anything else reaching past the cap degrades to progress 0
  // instead of firing unbounded concurrent engine calls.
  //---------------
  it('does not spend the engine cap on pending slots', async () => {
    mockEngine({ body: { progress: 62, stage: 'lipsync' } });
    const pending = Array.from({ length: 25 }, (_, i) => ({
      id: `pend-${i}`, slot_at: '2026-09-24T10:00:00Z', status: 'pending',
      topic: `Topic ${i}`, schedule_id: 's1',
    }));
    const live = Array.from({ length: 5 }, (_, i) => ({
      id: `gen-${i}`, slot_at: '2026-09-24T10:00:00Z', status: 'generating',
      topic: `Live ${i}`, schedule_id: 's1', task_id: `task-${i}`,
    }));
    const body = await getStatus([...pending, ...live]);

    expect(vi.mocked(fetch).mock.calls.length).toBe(5);
    expect(body.upcoming.slice(25).every((s) => s.progress === 62)).toBe(true);
  });

  it('does not spend the engine cap on generating slots without a task id', async () => {
    mockEngine({ body: { progress: 62, stage: 'lipsync' } });
    const withoutTask = Array.from({ length: 25 }, (_, i) => ({
      id: `notask-${i}`, slot_at: '2026-09-24T10:00:00Z', status: 'generating',
      topic: `Topic ${i}`, schedule_id: 's1',
    }));
    const live = Array.from({ length: 5 }, (_, i) => ({
      id: `gen-${i}`, slot_at: '2026-09-24T10:00:00Z', status: 'generating',
      topic: `Live ${i}`, schedule_id: 's1', task_id: `task-${i}`,
    }));
    const body = await getStatus([...withoutTask, ...live]);

    expect(vi.mocked(fetch).mock.calls.length).toBe(5);
    expect(body.upcoming.slice(0, 25).every((s) => s.progress === 0)).toBe(true);
    expect(body.upcoming.slice(25).every((s) => s.progress === 62)).toBe(true);
  });

  it('does not spend the engine cap on non-live slots that carry a task id', async () => {
    mockEngine({ body: { progress: 62, stage: 'lipsync' } });
    const pending = Array.from({ length: 25 }, (_, i) => ({
      id: `pend-${i}`, slot_at: '2026-09-24T10:00:00Z', status: 'pending',
      topic: `Topic ${i}`, schedule_id: 's1', task_id: `stale-task-${i}`,
    }));
    const live = Array.from({ length: 5 }, (_, i) => ({
      id: `gen-${i}`, slot_at: '2026-09-24T10:00:00Z', status: 'generating',
      topic: `Live ${i}`, schedule_id: 's1', task_id: `task-${i}`,
    }));
    const body = await getStatus([...pending, ...live]);

    expect(vi.mocked(fetch).mock.calls.length).toBe(5);
    expect(body.upcoming.slice(25).every((s) => s.progress === 62)).toBe(true);
  });

  it('caps the engine fan-out for failed slots too', async () => {
    mockEngine({ body: { progress: 80, state: -1 } });
    const failed = Array.from({ length: 30 }, (_, i) => ({
      id: `fail-${i}`, slot_at: '2026-09-24T10:00:00Z', status: 'failed',
      topic: `Topic ${i}`, schedule_id: 's1', task_id: `task-${i}`, error: 'boom',
    }));
    const body = await getStatus([], failed);

    expect(vi.mocked(fetch).mock.calls.length).toBe(25);
    expect(body.recent.slice(0, 25).every((s) => s.progress === 80)).toBe(true);
    expect(body.recent.slice(25).every((s) => s.progress === 0)).toBe(true);
  });
});

//---------------
// Progress history recording — every status poll records observed
// (progress, stage) transitions for live (generating) and dead (failed)
// slots, so a regression like 40% -> 0% stays visible after the fact.
//---------------
describe('GET progress history recording', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('MONEYPRINT_API_URL', 'https://engine.test');
    vi.stubEnv('MONEYPRINT_API_SECRET', 'secret');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  function mockEngine(body: unknown) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, json: async () => body })),
    );
  }

  async function getStatusWithClient(upcoming: unknown[], recent: unknown[] = []) {
    const client = mockPostsClient(upcoming, recent);
    mockAuthSession({ userId: USER_ID, accessToken: 'pe_test_key', isApiKey: true }, null);
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);
    const response = await GET(new Request('https://example.com/api/schedule/status'));
    expect(response.status).toBe(200);
    return client;
  }

  it('records observed progress for generating slots with a task id', async () => {
    mockEngine({ body: { progress: 40, stage: 'subtitle' } });
    const client = await getStatusWithClient([
      { id: 'gen-1', slot_at: '2026-10-07T18:00:00Z', status: 'generating', topic: 'T', schedule_id: 's1', task_id: 'task-1' },
    ]);

    expect(recordProgressHistory).toHaveBeenCalledOnce();
    expect(vi.mocked(recordProgressHistory)).toHaveBeenCalledWith(client, USER_ID, [
      { postId: 'gen-1', progress: 40, stage: 'subtitle' },
    ]);
  });

  it('records last-known progress for failed slots with a task id', async () => {
    mockEngine({ body: { progress: 80, state: -1 } });
    await getStatusWithClient([], [
      { id: 'fail-1', slot_at: '2026-10-06T18:00:00Z', status: 'failed', topic: 'T', schedule_id: 's1', task_id: 'task-9', error: 'boom' },
    ]);

    expect(vi.mocked(recordProgressHistory)).toHaveBeenCalledWith(expect.anything(), USER_ID, [
      { postId: 'fail-1', progress: 80, stage: null },
    ]);
  });

  it('records nothing when no live slot carries a task id', async () => {
    mockEngine({ body: { progress: 40 } });
    await getStatusWithClient([
      { id: 'up-1', slot_at: '2026-10-07T18:00:00Z', status: 'pending', topic: 'T', schedule_id: 's1' },
    ]);

    expect(vi.mocked(recordProgressHistory)).toHaveBeenCalledWith(expect.anything(), USER_ID, []);
  });

  it('ignores pending slots even when they carry a task id', async () => {
    mockEngine({ body: { progress: 40, stage: 'subtitle' } });
    await getStatusWithClient([
      { id: 'up-1', slot_at: '2026-10-07T18:00:00Z', status: 'pending', topic: 'T', schedule_id: 's1', task_id: 'stale-task-1' },
    ]);

    // Only generating/failed observations are history-worthy; a stale
    // task id on a pending slot must not create a sample.
    expect(vi.mocked(recordProgressHistory)).toHaveBeenCalledWith(expect.anything(), USER_ID, []);
  });

  it('ignores live slots with a non-string id', async () => {
    mockEngine({ body: { progress: 40, stage: 'subtitle' } });
    await getStatusWithClient([
      { id: 42, slot_at: '2026-10-07T18:00:00Z', status: 'generating', topic: 'T', schedule_id: 's1', task_id: 'task-1' },
    ]);

    expect(vi.mocked(recordProgressHistory)).toHaveBeenCalledWith(expect.anything(), USER_ID, []);
  });

  it('ignores live slots with a non-string task id', async () => {
    mockEngine({ body: { progress: 40, stage: 'subtitle' } });
    await getStatusWithClient([
      { id: 'gen-1', slot_at: '2026-10-07T18:00:00Z', status: 'generating', topic: 'T', schedule_id: 's1', task_id: 42 },
    ]);

    expect(vi.mocked(recordProgressHistory)).toHaveBeenCalledWith(expect.anything(), USER_ID, []);
  });
});

//---------------
// Query contracts — the exact Supabase query shape is part of the
// route's contract: the queried tables, status filters, sort direction
// and the applied limit. These assertions pin the literals mutation
// testing flips (array, string and boolean mutants).
//---------------
describe('GET query contracts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function getWithLimit(limitParam: string | null) {
    const upcoming = [
      { id: 'up-1', slot_at: '2026-09-24T10:00:00Z', status: 'pending', topic: 'Next', schedule_id: 's1' },
    ];
    const client = mockPostsClient(upcoming, []);
    mockAuthSession({ userId: USER_ID, accessToken: 'pe_test_key', isApiKey: true }, null);
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);
    const url =
      limitParam === null
        ? 'https://example.com/api/schedule/status'
        : `https://example.com/api/schedule/status?limit=${limitParam}`;
    const response = await GET(new Request(url));
    expect(response.status).toBe(200);
    return client;
  }

  function scheduleIdFilters(chain: { in: { mock: { calls: unknown[][] } } }) {
    const calls: unknown[][] = chain.in.mock.calls;
    return calls.filter(([column]) => column === 'schedule_id');
  }

  it('queries scheduled_posts three times, each scoped by the caller user id', async () => {
    const client = await getWithLimit(null);
    const fromCalls: unknown[][] = client.from.mock.calls;
    expect(fromCalls).toHaveLength(3);
    expect(fromCalls.every(([table]) => table === 'scheduled_posts')).toBe(true);
    // Every query (upcoming, recent, queue) scopes by user id — a single
    // mutated .eq must not hide behind the other two queries' calls.
    const eqCalls: unknown[][] = client.chain.eq.mock.calls;
    expect(eqCalls).toHaveLength(3);
    expect(eqCalls.every(([column, value]) => column === 'user_id' && value === USER_ID)).toBe(true);
  });

  it('filters upcoming, recent and queue queries by status', async () => {
    const client = await getWithLimit(null);
    const inCalls = client.chain.in.mock.calls;
    expect(inCalls).toContainEqual(['status', ['pending', 'generating', 'ready']]);
    expect(inCalls).toContainEqual(['status', ['published', 'failed']]);
    expect(inCalls).toContainEqual(['status', ['pending', 'generating']]);
  });

  it('selects the documented columns on every query', async () => {
    const client = await getWithLimit(null);
    expect(client.chain.select).toHaveBeenCalledWith(
      'id, slot_at, status, topic, schedule_id, task_id',
    );
    expect(client.chain.select).toHaveBeenCalledWith(
      'id, slot_at, status, topic, error, published_at, schedule_id, task_id',
    );
    expect(client.chain.select).toHaveBeenCalledWith('id, schedule_id, slot_at');
  });

  it('orders upcoming ascending and recent descending by slot_at', async () => {
    const client = await getWithLimit(null);
    const orderCalls: unknown[][] = client.chain.order.mock.calls;
    const ascending = orderCalls.filter(
      ([column, options]) =>
        column === 'slot_at' && (options as { ascending?: boolean } | null)?.ascending === true,
    );
    const descending = orderCalls.filter(
      ([column, options]) =>
        column === 'slot_at' && (options as { ascending?: boolean } | null)?.ascending === false,
    );
    // Upcoming and the queue-positions query sort ascending; recent sorts
    // descending. Counting (not just "contains") pins each query's
    // direction — a flipped boolean on one query must not hide behind the
    // other queries' calls.
    expect(ascending).toHaveLength(2);
    expect(descending).toHaveLength(1);
  });

  it('only fetches upcoming slots at or after now', async () => {
    const client = await getWithLimit(null);
    expect(client.chain.gte).toHaveBeenCalledWith('slot_at', expect.any(String));
  });

  it('applies the parsed limit to both paginated queries', async () => {
    const client = await getWithLimit('5');
    expect(client.chain.limit).toHaveBeenCalledTimes(2);
    expect(client.chain.limit).toHaveBeenNthCalledWith(1, 5);
    expect(client.chain.limit).toHaveBeenNthCalledWith(2, 5);
  });

  it('does not filter by schedule id for unscoped callers', async () => {
    const client = await getWithLimit(null);
    expect(scheduleIdFilters(client.chain)).toHaveLength(0);
  });

  it('restricts every scoped post query to the allowed schedule ids', async () => {
    const client = mockScopedPostsClient(['s1'], [], []);
    mockAuthSession(
      { userId: USER_ID, accessToken: 'pe_live_scoped', isApiKey: true, keyId: 'key-1', personaIds: ['p1'] },
      null,
    );
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);
    const response = await GET(new Request('https://example.com/api/schedule/status'));
    expect(response.status).toBe(200);
    // Upcoming, recent AND the queue-positions query carry the filter.
    expect(scheduleIdFilters(client.postsChain)).toHaveLength(3);
    expect(client.schedulesChain.select).toHaveBeenCalledWith('id');
  });
});

//---------------
// Failure handling — a failed upcoming/recent query is an honest 500;
// a failed queue lookup degrades queue positions to null (and warns)
// without failing the request; a failed scope lookup is a 500 before
// any post query runs. Malformed queue payloads never fail the request.
//---------------
function mockFailingPostsClient(options: {
  upcoming?: unknown[];
  upcomingError?: unknown;
  recentError?: unknown;
  queueError?: unknown;
  queue?: unknown;
}) {
  let limitCalls = 0;
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn(async () => {
      const isUpcoming = limitCalls++ === 0;
      return {
        data: isUpcoming ? (options.upcoming ?? []) : [],
        error: isUpcoming ? (options.upcomingError ?? null) : (options.recentError ?? null),
      };
    }),
    // The queue-positions query is awaited without .limit() (the real
    // Supabase chain is thenable); it resolves the queue fixture as-is so
    // malformed payloads reach buildQueuePositions unchanged.
    then: (resolve: (value: unknown) => void) =>
      resolve({
        data: options.queue !== undefined ? options.queue : [],
        error: options.queueError ?? null,
      }),
  };
  const from = vi.fn(() => chain);
  return { from, chain };
}

function mockScopedScheduleClient(scheduleResult: { data: unknown; error: unknown }) {
  const schedulesChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn(async () => scheduleResult),
  };
  const from = vi.fn(() => schedulesChain);
  return { from, schedulesChain };
}

describe('GET failure handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function getWithFailures(options: {
    upcoming?: unknown[];
    upcomingError?: unknown;
    recentError?: unknown;
    queueError?: unknown;
    queue?: unknown;
  }) {
    const client = mockFailingPostsClient(options);
    mockAuthSession({ userId: USER_ID, accessToken: 'pe_test_key', isApiKey: true }, null);
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);
    const response = await GET(new Request('https://example.com/api/schedule/status'));
    return { response, client };
  }

  function getScopedWithScheduleResult(scheduleResult: { data: unknown; error: unknown }) {
    const client = mockScopedScheduleClient(scheduleResult);
    mockAuthSession(
      { userId: USER_ID, accessToken: 'pe_live_scoped', isApiKey: true, keyId: 'key-1', personaIds: ['p1'] },
      null,
    );
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);
    return GET(new Request('https://example.com/api/schedule/status')).then((response) => ({
      response,
      client,
    }));
  }

  it('returns 500 when the upcoming query fails', async () => {
    const { response } = await getWithFailures({ upcomingError: { message: 'db down' } });
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({ success: false, error: 'Failed to load schedule status.' });
  });

  it('returns 500 when the recent query fails', async () => {
    const { response } = await getWithFailures({ recentError: { message: 'db down' } });
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({ success: false, error: 'Failed to load schedule status.' });
  });

  it('warns and degrades to null queue positions when the queue lookup fails', async () => {
    const upcoming = [
      { id: 'up-1', slot_at: '2026-09-24T10:00:00Z', status: 'pending', topic: 'Next', schedule_id: 's1' },
      { id: 'up-2', slot_at: '2026-09-24T11:00:00Z', status: 'pending', topic: 'After', schedule_id: 's1' },
    ];
    const queue = [
      { id: 'up-1', schedule_id: 's1', slot_at: '2026-09-24T10:00:00Z' },
      { id: 'up-2', schedule_id: 's1', slot_at: '2026-09-24T11:00:00Z' },
    ];
    const { response } = await getWithFailures({ upcoming, queue, queueError: { message: 'db down' } });
    expect(response.status).toBe(200);
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      '[api/schedule/status] queue lookup failed',
      expect.objectContaining({ error: { message: 'db down' } }),
    );
    const body = (await response.json()) as {
      upcoming: { queuePosition: number | null; queueTotal: number | null }[];
    };
    expect(body.upcoming).toHaveLength(2);
    expect(body.upcoming[0].queuePosition).toBeNull();
    expect(body.upcoming[0].queueTotal).toBeNull();
    expect(body.upcoming[1].queuePosition).toBeNull();
    expect(body.upcoming[1].queueTotal).toBeNull();
  });

  it('does not warn when the queue lookup succeeds', async () => {
    const upcoming = [
      { id: 'up-1', slot_at: '2026-09-24T10:00:00Z', status: 'pending', topic: 'Next', schedule_id: 's1' },
    ];
    const queue = [{ id: 'up-1', schedule_id: 's1', slot_at: '2026-09-24T10:00:00Z' }];
    const { response } = await getWithFailures({ upcoming, queue });
    expect(response.status).toBe(200);
    expect(vi.mocked(logger.warn)).not.toHaveBeenCalled();
  });

  it('ignores malformed queue rows instead of failing the request', async () => {
    const upcoming = [
      { id: 'up-1', slot_at: '2026-09-24T10:00:00Z', status: 'pending', topic: 'Next', schedule_id: 's1' },
      { id: 'up-2', slot_at: '2026-09-24T11:00:00Z', status: 'pending', topic: 'After', schedule_id: 's1' },
      { id: 'up-3', slot_at: '2026-09-24T12:00:00Z', status: 'pending', topic: 'Later', schedule_id: 's1' },
    ];
    const queue = [
      { id: 'up-1', schedule_id: 's1', slot_at: '2026-09-24T10:00:00Z' },
      null,
      'not-an-object',
      { id: 'up-2' },
      { id: 42, schedule_id: 's1' },
      { id: 'up-3', schedule_id: 's1', slot_at: '2026-09-24T12:00:00Z' },
    ];
    const { response } = await getWithFailures({ upcoming, queue });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      upcoming: { queuePosition: number | null; queueTotal: number | null }[];
    };
    // Only the two well-formed rows count: up-1 is 1/2, up-3 is 2/2, and
    // up-2 (no well-formed queue row) degrades to nulls.
    expect(body.upcoming[0].queuePosition).toBe(1);
    expect(body.upcoming[0].queueTotal).toBe(2);
    expect(body.upcoming[1].queuePosition).toBeNull();
    expect(body.upcoming[1].queueTotal).toBeNull();
    expect(body.upcoming[2].queuePosition).toBe(2);
    expect(body.upcoming[2].queueTotal).toBe(2);
  });

  it('treats a non-array queue payload as an empty queue', async () => {
    const upcoming = [
      { id: 'up-1', slot_at: '2026-09-24T10:00:00Z', status: 'pending', topic: 'Next', schedule_id: 's1' },
    ];
    const { response } = await getWithFailures({ upcoming, queue: { unexpected: 'shape' } });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      upcoming: { queuePosition: number | null; queueTotal: number | null }[];
    };
    expect(body.upcoming[0].queuePosition).toBeNull();
    expect(body.upcoming[0].queueTotal).toBeNull();
  });

  it('returns 500 when the scoped schedule lookup fails', async () => {
    const { response, client } = await getScopedWithScheduleResult({
      data: null,
      error: { message: 'db down' },
    });
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({ success: false, error: 'Failed to load schedule status.' });
    expect(client.from).not.toHaveBeenCalledWith('scheduled_posts');
  });

  it('treats a null scope lookup result as no allowed schedules', async () => {
    const { response, client } = await getScopedWithScheduleResult({ data: null, error: null });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ success: true, upcoming: [], recent: [] });
    expect(client.from).not.toHaveBeenCalledWith('scheduled_posts');
  });

  it('treats null query data as empty lists', async () => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn(async () => ({ data: null, error: null })),
      then: (resolve: (value: unknown) => void) => resolve({ data: null, error: null }),
    };
    const client = { from: vi.fn(() => chain) };
    mockAuthSession({ userId: USER_ID, accessToken: 'pe_test_key', isApiKey: true }, null);
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await GET(new Request('https://example.com/api/schedule/status'));

    // Null data degrades to empty lists — never a crash, never garbage rows.
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ success: true, upcoming: [], recent: [] });
  });

  it('treats a scoped key with no personas as no allowed schedules', async () => {
    const client = mockScopedScheduleClient({ data: [], error: null });
    mockAuthSession(
      { userId: USER_ID, accessToken: 'pe_live_scoped', isApiKey: true, keyId: 'key-1', personaIds: [] },
      null,
    );
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await GET(new Request('https://example.com/api/schedule/status'));

    expect(response.status).toBe(200);
    // An empty scope list must reach the query verbatim — no silent widening.
    expect(client.schedulesChain.in).toHaveBeenCalledWith('persona_id', []);
    const body = await response.json();
    expect(body).toEqual({ success: true, upcoming: [], recent: [] });
    expect(client.from).not.toHaveBeenCalledWith('scheduled_posts');
  });
});
