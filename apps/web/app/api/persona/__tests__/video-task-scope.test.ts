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
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { DELETE } from '../video-task/[taskId]/route';
import { requireSupabaseSession } from '@/lib/request-auth';
import { createSupabaseServiceClient } from '@/lib/supabase/service';

const USER_ID = 'user-1';
const PERSONA_A = '11111111-1111-4111-8111-111111111111';
const PERSONA_B = '22222222-2222-4222-8222-222222222222';
const TASK_ID = 'task-1';

interface QueryResult {
  data: unknown;
  error: unknown;
}

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
  const queries: Record<string, ReturnType<typeof makeQuery>> = {};
  const from = vi.fn((table: string) => {
    const query = makeQuery(results[table] ?? { data: null, error: null });
    queries[table] = query;
    return query;
  });
  vi.mocked(createSupabaseServiceClient).mockReturnValue({ from } as never);
  return { from, queries };
}

function authFor(auth: Record<string, unknown>) {
  vi.mocked(requireSupabaseSession).mockResolvedValue({ auth, error: null } as never);
}

const EMPTY = { data: null, error: null };

async function callDelete() {
  return DELETE(
    new Request(`http://localhost/api/persona/video-task/${TASK_ID}`, { method: 'DELETE' }) as never,
    { params: Promise.resolve({ taskId: TASK_ID }) },
  );
}

describe('DELETE /api/persona/video-task/:taskId — bearer auth and persona scope', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('MONEYPRINT_API_URL', 'http://moneyprint.internal:8080');
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ status: 'deleted' }), { status: 200 }));
  });

  it('accepts an unscoped API key without a scope lookup', async () => {
    authFor({ userId: USER_ID, accessToken: 'pe_live_key', isApiKey: true, personaIds: null });

    const response = await callDelete();

    expect(response.status).toBe(200);
    expect(createSupabaseServiceClient).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(
      `http://moneyprint.internal:8080/api/v1/tasks/${TASK_ID}`,
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('accepts an OAuth token without a scope lookup', async () => {
    authFor({ userId: USER_ID, accessToken: 'header.payload.signature', isOAuth: true });

    const response = await callDelete();

    expect(response.status).toBe(200);
    expect(createSupabaseServiceClient).not.toHaveBeenCalled();
  });

  it('cancels a scoped key task whose generation belongs to an allowed persona', async () => {
    authFor({ userId: USER_ID, accessToken: 'pe_live_key', isApiKey: true, personaIds: [PERSONA_A] });
    const service = makeService({
      video_generations: { data: { persona_id: PERSONA_A }, error: null },
    });

    const response = await callDelete();

    expect(response.status).toBe(200);
    expect(service.queries.video_generations.eq).toHaveBeenCalledWith('user_id', USER_ID);
    expect(service.queries.video_generations.eq).toHaveBeenCalledWith('engine_task_id', TASK_ID);
    expect(fetchMock).toHaveBeenCalled();
  });

  it('rejects a scoped key task whose generation belongs to another persona', async () => {
    authFor({ userId: USER_ID, accessToken: 'pe_live_key', isApiKey: true, personaIds: [PERSONA_A] });
    makeService({ video_generations: { data: { persona_id: PERSONA_B }, error: null } });

    const response = await callDelete();

    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a scoped key task tracked by a scheduled slot of another persona', async () => {
    authFor({ userId: USER_ID, accessToken: 'pe_live_key', isApiKey: true, personaIds: [PERSONA_A] });
    makeService({
      video_generations: EMPTY,
      scheduled_posts: { data: { schedule_id: 'schedule-1' }, error: null },
      schedules: { data: { persona_id: PERSONA_B }, error: null },
    });

    const response = await callDelete();

    expect(response.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails closed (404) when a scoped key task has no resolvable persona link', async () => {
    authFor({ userId: USER_ID, accessToken: 'pe_live_key', isApiKey: true, personaIds: [PERSONA_A] });
    makeService({ video_generations: EMPTY, scheduled_posts: EMPTY });

    const response = await callDelete();

    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 500 without deleting when the scope lookup fails', async () => {
    authFor({ userId: USER_ID, accessToken: 'pe_live_key', isApiKey: true, personaIds: [PERSONA_A] });
    makeService({
      video_generations: { data: null, error: { code: 'PGRST500', message: 'boom' } },
    });

    const response = await callDelete();

    expect(response.status).toBe(500);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
