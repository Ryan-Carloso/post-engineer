// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

vi.mock('@/lib/rate-limit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/rate-limit')>();
  return { ...actual, applyRateLimit: vi.fn().mockResolvedValue(null) };
});

vi.mock('@/lib/billing/token-check', () => ({
  refundTokens: vi.fn(async () => true),
}));

vi.mock('@/lib/generation/video-generation', () => ({
  recordGenerationUpdate: vi.fn(async () => undefined),
}));

import { GET as downloadVideo } from '../video-download/[taskId]/[...path]/route';
import { GET as streamEvents } from '../video-events/[taskId]/route';
import { GET as readStatus } from '../video-status/[taskId]/route';
import { requireSupabaseSession } from '@/lib/request-auth';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { refundTokens } from '@/lib/billing/token-check';
import { recordGenerationUpdate } from '@/lib/generation/video-generation';
import { logger } from '@/lib/logger';

const USER_ID = 'user-1';
const PERSONA_A = '11111111-1111-4111-8111-111111111111';
const PERSONA_B = '22222222-2222-4222-8222-222222222222';
const TASK_ID = 'task-1';

interface QueryResult {
  data: unknown;
  error: unknown;
}

const EMPTY: QueryResult = { data: null, error: null };

function makeQuery(result: QueryResult) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    limit: vi.fn(),
    maybeSingle: vi.fn(async () => result),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.limit.mockReturnValue(query);
  return query;
}

function makeService(results: Record<string, QueryResult>) {
  const queried: string[] = [];
  const from = vi.fn((table: string) => {
    queried.push(table);
    return makeQuery(results[table] ?? EMPTY);
  });
  vi.mocked(createSupabaseServiceClient).mockReturnValue({ from } as never);
  return { from, queried };
}

function authFor(auth: Record<string, unknown>): void {
  vi.mocked(requireSupabaseSession).mockResolvedValue({ auth, error: null } as never);
}

function scoped(): void {
  authFor({ userId: USER_ID, accessToken: 'pe_live_key', isApiKey: true, personaIds: [PERSONA_A] });
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('MONEYPRINT_API_URL', 'http://moneyprint.internal:8080');
  vi.stubEnv('MONEYPRINT_API_SECRET', 'engine-secret');
  vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://post-engineer.com');
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ status: 'success', body: { state: 0, progress: 10 } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
});

async function getDownload(): Promise<Response> {
  return downloadVideo(new Request('http://localhost/download') as never, {
    params: Promise.resolve({ taskId: TASK_ID, path: ['final.mp4'] }),
  });
}

async function getEvents(): Promise<Response> {
  return streamEvents(new Request(`http://localhost/api/persona/video-events/${TASK_ID}`), {
    params: Promise.resolve({ taskId: TASK_ID }),
  });
}

async function getStatus(): Promise<Response> {
  return readStatus(new Request(`http://localhost/api/persona/video-status/${TASK_ID}`), {
    params: Promise.resolve({ taskId: TASK_ID }),
  });
}

describe('engine proxies hide another persona before any fetch', () => {
  it('download answers 404 and does not fetch', async () => {
    scoped();
    makeService({ video_generations: { data: { persona_id: PERSONA_B }, error: null } });

    const response = await getDownload();
    const text = await response.text();

    expect(response.status, text).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('events answers 404 and does not fetch', async () => {
    scoped();
    makeService({ video_generations: { data: { persona_id: PERSONA_B }, error: null } });

    const response = await getEvents();
    const text = await response.text();

    expect(response.status, text).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('status answers 404 before a failed task can refund or rewrite history', async () => {
    scoped();
    makeService({
      video_generations: { data: { persona_id: PERSONA_B, generation_id: 'gen-secret' }, error: null },
    });
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ status: 'success', body: { state: -1, error: 'boom' } }), { status: 200 }),
    );

    const response = await getStatus();
    const text = await response.text();

    expect(response.status, text).toBe(404);
    expect(text).not.toContain('boom');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(refundTokens).not.toHaveBeenCalled();
    expect(recordGenerationUpdate).not.toHaveBeenCalled();
  });
});

describe('engine proxies still read an in-scope task', () => {
  it('download fetches an allowed persona', async () => {
    scoped();
    makeService({ video_generations: { data: { persona_id: PERSONA_A }, error: null } });
    fetchMock.mockResolvedValue(new Response('video', { status: 200, headers: { 'Content-Type': 'video/mp4' } }));

    const response = await getDownload();

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalled();
  });

  it('events fetches an allowed persona', async () => {
    scoped();
    makeService({ video_generations: { data: { persona_id: PERSONA_A }, error: null } });
    fetchMock.mockResolvedValue(new Response('data: hi\n\n', { status: 200 }));

    const response = await getEvents();

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalled();
  });

  it('status fetches an allowed persona', async () => {
    scoped();
    makeService({ video_generations: { data: { persona_id: PERSONA_A }, error: null } });

    const response = await getStatus();

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalled();
    expect(refundTokens).not.toHaveBeenCalled();
  });
});

describe('GET /api/persona/video-status task visibility', () => {
  interface StatusCase {
    name: string;
    personaIds: string[] | null;
    isApiKey?: boolean;
    isOAuth?: boolean;
    tables: Record<string, QueryResult>;
    status: number;
    fetch: boolean;
    queriesGenerations: boolean;
  }

  const cases: StatusCase[] = [
    {
      name: 'null persona generation is visible',
      personaIds: [PERSONA_A],
      tables: { video_generations: { data: { persona_id: null }, error: null } },
      status: 200,
      fetch: true,
      queriesGenerations: true,
    },
    {
      name: 'no row is a 404',
      personaIds: [PERSONA_A],
      tables: { video_generations: EMPTY, scheduled_posts: EMPTY },
      status: 404,
      fetch: false,
      queriesGenerations: true,
    },
    {
      name: 'slot of another persona is a 404',
      personaIds: [PERSONA_A],
      tables: {
        video_generations: EMPTY,
        scheduled_posts: { data: { schedule_id: 'schedule-1', faceless: false }, error: null },
        schedules: { data: { persona_id: PERSONA_B }, error: null },
      },
      status: 404,
      fetch: false,
      queriesGenerations: true,
    },
    {
      name: 'slot of an allowed persona is visible',
      personaIds: [PERSONA_A],
      tables: {
        video_generations: EMPTY,
        scheduled_posts: { data: { schedule_id: 'schedule-1', faceless: false }, error: null },
        schedules: { data: { persona_id: PERSONA_A }, error: null },
      },
      status: 200,
      fetch: true,
      queriesGenerations: true,
    },
    {
      name: 'faceless slot with a null schedule persona is visible',
      personaIds: [PERSONA_A],
      tables: {
        video_generations: EMPTY,
        scheduled_posts: { data: { schedule_id: 'schedule-1', faceless: true }, error: null },
        schedules: { data: { persona_id: null }, error: null },
      },
      status: 200,
      fetch: true,
      queriesGenerations: true,
    },
    {
      name: 'non-faceless slot with a null schedule persona is hidden',
      personaIds: [PERSONA_A],
      tables: {
        video_generations: EMPTY,
        scheduled_posts: { data: { schedule_id: 'schedule-1', faceless: false }, error: null },
        schedules: { data: { persona_id: null }, error: null },
      },
      status: 404,
      fetch: false,
      queriesGenerations: true,
    },
    {
      name: 'deleted schedule that is not faceless is hidden',
      personaIds: [PERSONA_A],
      tables: {
        video_generations: EMPTY,
        scheduled_posts: { data: { schedule_id: 'schedule-1', faceless: false }, error: null },
        schedules: EMPTY,
      },
      status: 404,
      fetch: false,
      queriesGenerations: true,
    },
    {
      name: 'deleted schedule that is faceless is visible',
      personaIds: [PERSONA_A],
      tables: {
        video_generations: EMPTY,
        scheduled_posts: { data: { schedule_id: 'schedule-1', faceless: true }, error: null },
        schedules: EMPTY,
      },
      status: 200,
      fetch: true,
      queriesGenerations: true,
    },
    {
      name: 'schedule_id null and not faceless is hidden',
      personaIds: [PERSONA_A],
      tables: {
        video_generations: EMPTY,
        scheduled_posts: { data: { schedule_id: null, faceless: false }, error: null },
      },
      status: 404,
      fetch: false,
      queriesGenerations: true,
    },
    {
      name: 'schedule_id null and faceless is visible',
      personaIds: [PERSONA_A],
      tables: {
        video_generations: EMPTY,
        scheduled_posts: { data: { schedule_id: null, faceless: true }, error: null },
      },
      status: 200,
      fetch: true,
      queriesGenerations: true,
    },
    {
      name: 'an out-of-scope generation hides even a faceless slot',
      personaIds: [PERSONA_A],
      tables: {
        video_generations: { data: { persona_id: PERSONA_B }, error: null },
        scheduled_posts: { data: { schedule_id: null, faceless: true }, error: null },
      },
      status: 404,
      fetch: false,
      queriesGenerations: true,
    },
    {
      name: 'unscoped key does not look up video_generations',
      personaIds: null,
      tables: {},
      status: 200,
      fetch: true,
      queriesGenerations: false,
    },
    {
      name: 'OAuth token does not look up video_generations',
      personaIds: null,
      isApiKey: false,
      isOAuth: true,
      tables: {},
      status: 200,
      fetch: true,
      queriesGenerations: false,
    },
    {
      name: 'empty scope hides a persona row',
      personaIds: [],
      tables: { video_generations: { data: { persona_id: PERSONA_A }, error: null } },
      status: 404,
      fetch: false,
      queriesGenerations: true,
    },
    {
      name: 'empty scope still shows a null persona generation',
      personaIds: [],
      tables: { video_generations: { data: { persona_id: null }, error: null } },
      status: 200,
      fetch: true,
      queriesGenerations: true,
    },
  ];

  it.each(cases)('$name', async (item) => {
    authFor({
      userId: USER_ID,
      accessToken: 'token',
      isApiKey: item.isApiKey !== false,
      isOAuth: item.isOAuth === true,
      personaIds: item.personaIds,
    });
    const service = makeService(item.tables);

    const response = await getStatus();

    expect(response.status).toBe(item.status);
    expect(fetchMock.mock.calls.length > 0).toBe(item.fetch);
    expect(service.queried.includes('video_generations')).toBe(item.queriesGenerations);
  });

  it('returns 500 and does not fetch when the scope lookup fails', async () => {
    scoped();
    makeService({ video_generations: { data: null, error: { code: 'PGRST500', message: 'boom' } } });

    const response = await getStatus();

    expect(response.status).toBe(500);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();
    expect(refundTokens).not.toHaveBeenCalled();
  });
});

describe('download and events follow the same visibility rules', () => {
  it('download shows a null persona generation and skips the lookup for an unscoped key', async () => {
    scoped();
    makeService({ video_generations: { data: { persona_id: null }, error: null } });
    fetchMock.mockResolvedValue(new Response('video', { status: 200, headers: { 'Content-Type': 'video/mp4' } }));

    const visible = await getDownload();
    expect(visible.status).toBe(200);
    expect(fetchMock).toHaveBeenCalled();

    vi.clearAllMocks();
    fetchMock.mockResolvedValue(new Response('video', { status: 200, headers: { 'Content-Type': 'video/mp4' } }));
    authFor({ userId: USER_ID, accessToken: 'token', isApiKey: true, personaIds: null });
    const service = makeService({});
    const unscoped = await getDownload();
    expect(unscoped.status).toBe(200);
    expect(service.queried).not.toContain('video_generations');
  });

  it('events returns 500 without fetching when the scope lookup fails', async () => {
    scoped();
    makeService({ video_generations: { data: null, error: { message: 'boom' } } });

    const response = await getEvents();

    expect(response.status).toBe(500);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('download returns 500 without fetching when the scope lookup fails', async () => {
    scoped();
    makeService({ video_generations: { data: null, error: { message: 'boom' } } });

    const response = await getDownload();

    expect(response.status).toBe(500);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
