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

import { GET } from '../video-events/[taskId]/route';
import { requireSupabaseSession } from '@/lib/request-auth';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { RATE_LIMITS } from '@/lib/rate-limit';

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
const OAUTH_CALLER = { userId: USER_ID, accessToken: 'a.b.c', isOAuth: true };
const SESSION_CALLER = { userId: USER_ID, accessToken: 'sb-session-token' };

async function open(taskId = 'task-1'): Promise<Response> {
  return GET(new Request(`http://localhost/api/persona/video-events/${taskId}`), {
    params: Promise.resolve({ taskId }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  rateLimitGlobal.__rateLimitStore = new Map();
  queriedTables.length = 0;
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  vi.stubEnv('MONEYPRINT_API_URL', 'http://moneyprint.internal:8080');
  vi.stubEnv('MONEYPRINT_API_SECRET', 'engine-secret');
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockImplementation(async () =>
    new Response('data: {"progress":10}\n\n', { status: 200, headers: { 'Content-Type': 'text/event-stream' } }),
  );
  mockService();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('GET /api/persona/video-events/:taskId stream limit', () => {
  it('answers a second API-key open of the same task within a minute with 429 RATE_LIMITED and Retry-After', async () => {
    authAs(API_KEY_CALLER);
    expect((await open()).status).toBe(200);

    const limited = await open();

    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toBe('60');
    expect(limited.headers.get('X-RateLimit-Limit')).toBe(String(RATE_LIMITS.taskEventsStream.limit));
    const body = (await limited.json()) as Record<string, unknown>;
    expect(body.errorType).toBe('RATE_LIMITED');
    expect(String(body.error)).toContain('at most once per minute');
  });

  it('touches neither Supabase nor the engine on a limited open', async () => {
    authAs({ ...API_KEY_CALLER, personaIds: [PERSONA_A] });
    await open();
    queriedTables.length = 0;
    fetchMock.mockClear();

    expect((await open()).status).toBe(429);
    expect(queriedTables).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keys the limit per task', async () => {
    authAs(API_KEY_CALLER);
    await open('task-1');

    expect((await open('task-2')).status).toBe(200);
  });

  it('limits OAuth callers the same way', async () => {
    authAs(OAUTH_CALLER);
    await open();

    expect((await open()).status).toBe(429);
  });

  it('does not share the budget with the task-status poll', async () => {
    authAs(API_KEY_CALLER);
    await open();

    expect(RATE_LIMITS.taskEventsStream.name).not.toBe(RATE_LIMITS.taskStatusPoll.name);
    expect(rateLimitGlobal.__rateLimitStore?.has(`${RATE_LIMITS.taskStatusPoll.name}:api-key:key-1:task-1`)).toBe(false);
    expect(rateLimitGlobal.__rateLimitStore?.has(`${RATE_LIMITS.taskEventsStream.name}:api-key:key-1:task-1`)).toBe(true);
  });

  it('never limits a browser session caller', async () => {
    authAs(SESSION_CALLER);

    const statuses = [];
    for (let i = 0; i < 3; i += 1) statuses.push((await open()).status);

    expect(statuses).toEqual([200, 200, 200]);
  });
});
