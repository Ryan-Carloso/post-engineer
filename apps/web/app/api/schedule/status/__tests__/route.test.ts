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

import { parseLimit, GET } from '../route';
import { requireSupabaseSession } from '@/lib/request-auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';

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

function mockPostsClient(upcoming: unknown[], recent: unknown[]) {
  let limitCalls = 0;
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn(async () => ({ data: limitCalls++ === 0 ? upcoming : recent, error: null })),
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
function mockScopedPostsClient(allowedScheduleIds: string[], upcoming: unknown[], recent: unknown[]) {
  let limitCalls = 0;
  const postsChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn(async () => ({ data: limitCalls++ === 0 ? upcoming : recent, error: null })),
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
      upcoming: upcoming.map((slot) => ({ ...slot, progress: 0 })),
      recent: recent.map((slot) => ({ ...slot, progress: 100 })),
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
      upcoming: upcoming.map((slot) => ({ ...slot, progress: 0 })),
      recent: recent.map((slot) => ({ ...slot, progress: 100 })),
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
      upcoming: upcoming.map((slot) => ({ ...slot, progress: 0 })),
      recent: recent.map((slot) => ({ ...slot, progress: 100 })),
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
      upcoming: allowedUpcoming.map((slot) => ({ ...slot, progress: 0 })),
      recent: allowedRecent.map((slot) => ({ ...slot, progress: 100 })),
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

  async function getStatus(upcoming: unknown[], recent: unknown[] = []) {
    const client = mockPostsClient(upcoming, recent);
    mockAuthSession({ userId: USER_ID, accessToken: 'pe_test_key', isApiKey: true }, null);
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);
    const response = await GET(new Request('https://example.com/api/schedule/status'));
    expect(response.status).toBe(200);
    return (await response.json()) as {
      upcoming: { progress: number; error?: string }[];
      recent: { progress: number; error?: string }[];
    };
  }

  it('pending → 0 sem chamar o engine', async () => {
    mockEngine({ data: { progress: 99 } });
    const body = await getStatus([
      { id: 'up-1', slot_at: '2026-09-24T10:00:00Z', status: 'pending', topic: 'Next', schedule_id: 's1' },
    ]);
    expect(body.upcoming[0].progress).toBe(0);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it('generating → progresso live do engine via task_id', async () => {
    mockEngine({ data: { progress: 45, state: 4 } });
    const body = await getStatus([
      { id: 'up-1', slot_at: '2026-09-24T10:00:00Z', status: 'generating', topic: 'Next', schedule_id: 's1', task_id: 'task-1' },
    ]);
    expect(body.upcoming[0].progress).toBe(45);
    const url = vi.mocked(fetch).mock.calls[0][0] as string;
    expect(url).toContain('/api/v1/tasks/task-1');
  });

  it('generating sem task_id → 0 sem chamar o engine', async () => {
    mockEngine({ data: { progress: 45 } });
    const body = await getStatus([
      { id: 'up-1', slot_at: '2026-09-24T10:00:00Z', status: 'generating', topic: 'Next', schedule_id: 's1' },
    ]);
    expect(body.upcoming[0].progress).toBe(0);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it('engine fora do ar → 0 no slot, request continua 200', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down'); }));
    const body = await getStatus([
      { id: 'up-1', slot_at: '2026-09-24T10:00:00Z', status: 'generating', topic: 'Next', schedule_id: 's1', task_id: 'task-1' },
    ]);
    expect(body.upcoming[0].progress).toBe(0);
  });

  it('ready/publishing/published → 100', async () => {
    mockEngine({ data: { progress: 10 } });
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

  it('failed → último progresso conhecido do engine, preservando o error', async () => {
    mockEngine({ data: { progress: 80, state: -1 } });
    const body = await getStatus(
      [],
      [{ id: 're-1', slot_at: '2026-09-20T10:00:00Z', status: 'failed', topic: 'C', schedule_id: 's1', task_id: 'task-9', error: 'boom' }],
    );
    expect(body.recent[0].progress).toBe(80);
    expect(body.recent[0].error).toBe('boom');
  });

  it('failed sem task_id ou com engine fora → 0', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down'); }));
    const body = await getStatus(
      [],
      [{ id: 're-1', slot_at: '2026-09-20T10:00:00Z', status: 'failed', topic: 'C', schedule_id: 's1', task_id: 'task-9' }],
    );
    expect(body.recent[0].progress).toBe(0);
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
        return { ok: true, status: 200, json: async () => ({ data: { progress: 50 } }) };
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
});
