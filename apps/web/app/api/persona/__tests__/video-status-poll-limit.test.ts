// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/request-auth', () => ({
  requireSupabaseSession: vi.fn(),
  engineAuthHeaders: vi.fn((userId: string) => ({
    Authorization: 'Bearer engine-secret',
    'x-user-id': userId,
  })),
}));

vi.mock('@/lib/supabase/service', () => ({
  createSupabaseServiceClient: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(() => 'log-id'), warn: vi.fn(() => 'log-id'), info: vi.fn(() => 'log-id'), debug: vi.fn() },
}));

import { GET } from '../video-status/[taskId]/route';
import { requireSupabaseSession } from '@/lib/request-auth';
import { createSupabaseServiceClient } from '@/lib/supabase/service';

const USER_ID = 'user-1';
const PERSONA_A = '11111111-1111-4111-8111-111111111111';
const NOW = 1_800_000_000_000;

const rateLimitGlobal = globalThis as unknown as { __rateLimitStore?: Map<string, unknown> };
const fetchMock = vi.fn<typeof fetch>();
const queriedTables: string[] = [];

function mockService(): void {
  const from = vi.fn((table: string) => {
    queriedTables.push(table);
    const query = {
      select: vi.fn(),
      eq: vi.fn(),
      limit: vi.fn(),
      maybeSingle: vi.fn(async () => ({ data: null, error: null })),
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.limit.mockReturnValue(query);
    return query;
  });
  vi.mocked(createSupabaseServiceClient).mockReturnValue({ from } as never);
}

function authAs(auth: Record<string, unknown>): void {
  vi.mocked(requireSupabaseSession).mockResolvedValue({ auth, error: null } as never);
}

const API_KEY_CALLER = { userId: USER_ID, accessToken: 'pe_live_key', isApiKey: true, keyId: 'key-1', personaIds: null };
const OTHER_KEY_CALLER = { ...API_KEY_CALLER, keyId: 'key-2' };
const OAUTH_CALLER = { userId: USER_ID, accessToken: 'a.b.c', isOAuth: true };
const SESSION_CALLER = { userId: USER_ID, accessToken: 'sb-session-token' };

async function poll(taskId = 'task-1'): Promise<Response> {
  return GET(new Request(`http://localhost/api/persona/video-status/${taskId}`), {
    params: Promise.resolve({ taskId }),
  });
}

function advanceSeconds(seconds: number): void {
  vi.spyOn(Date, 'now').mockReturnValue(NOW + seconds * 1000);
}

beforeEach(() => {
  vi.clearAllMocks();
  rateLimitGlobal.__rateLimitStore = new Map();
  queriedTables.length = 0;
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  vi.stubEnv('MONEYPRINT_API_URL', 'http://moneyprint.internal:8080');
  vi.stubEnv('MONEYPRINT_API_SECRET', 'engine-secret');
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://post-engineer.com');
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockImplementation(async () =>
    new Response(JSON.stringify({ status: 200, body: { state: 4, progress: 10 } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
  mockService();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GET /api/persona/video-status/:taskId poll limit', () => {
  it('answers a second API-key poll of the same task within a minute with 429 RATE_LIMITED and Retry-After', async () => {
    authAs(API_KEY_CALLER);
    expect((await poll()).status).toBe(200);

    const limited = await poll();

    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toBe('60');
    const body = (await limited.json()) as Record<string, unknown>;
    expect(body.success).toBe(false);
    expect(body.errorType).toBe('RATE_LIMITED');
    expect(body.retryAfterSeconds).toBe(60);
    expect(String(body.error)).toContain('at most once per minute');
  });

  it('reports the seconds left in the window as Retry-After', async () => {
    authAs(API_KEY_CALLER);
    await poll();
    advanceSeconds(45);

    const limited = await poll();

    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toBe('15');
  });

  it('allows the next poll once the minute has passed', async () => {
    authAs(API_KEY_CALLER);
    await poll();
    advanceSeconds(60);

    expect((await poll()).status).toBe(200);
  });

  it('touches neither Supabase nor the engine on a limited poll', async () => {
    authAs({ ...API_KEY_CALLER, personaIds: [PERSONA_A] });
    await poll();
    queriedTables.length = 0;
    fetchMock.mockClear();

    const limited = await poll();

    expect(limited.status).toBe(429);
    expect(queriedTables).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keys the limit per task, so another task of the same key is not limited', async () => {
    authAs(API_KEY_CALLER);
    await poll('task-1');

    expect((await poll('task-2')).status).toBe(200);
  });

  it('keys the limit per API key, so another key polling the same task is not limited', async () => {
    authAs(API_KEY_CALLER);
    await poll();
    authAs(OTHER_KEY_CALLER);

    expect((await poll()).status).toBe(200);
  });

  it('limits OAuth callers the same way', async () => {
    authAs(OAUTH_CALLER);
    expect((await poll()).status).toBe(200);

    const limited = await poll();

    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toBe('60');
  });

  it('never limits a browser session caller', async () => {
    authAs(SESSION_CALLER);

    const statuses = [];
    for (let i = 0; i < 5; i += 1) statuses.push((await poll()).status);

    expect(statuses).toEqual([200, 200, 200, 200, 200]);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it('does not let a session poll consume the API-key budget of the same task', async () => {
    authAs(SESSION_CALLER);
    await poll();
    authAs(API_KEY_CALLER);

    expect((await poll()).status).toBe(200);
  });
});
