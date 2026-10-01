// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/request-auth', () => ({
  requireSupabaseSession: vi.fn(),
}));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(() => 'log-id'), warn: vi.fn(() => 'log-id'), info: vi.fn(() => 'log-id') },
}));
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
}));
vi.mock('@/lib/supabase/service', () => ({
  createSupabaseServiceClient: vi.fn(),
}));

import { GET } from '../route';
import { requireSupabaseSession } from '@/lib/request-auth';
import { createSupabaseServiceClient } from '@/lib/supabase/service';

//---------------
// GET /api/persona/video-generations/[generationId] — one generation's
// detail, same shape as the list route's rows. Unknown id or another
// user's row → 404.
//---------------

const USER_ID = 'user-1';

const GENERATION_ROW = {
  id: 'row-1',
  generation_id: 'gen-3',
  engine_task_id: 'task-3',
  persona_name: 'Viva Leve',
  video_subject: 'Launch recap',
  status: 'completed',
  error_code: null,
  tokens_refunded: false,
  created_at: '2026-09-23T12:00:00.000Z',
  completed_at: '2026-09-23T12:02:00.000Z',
};

function mockGenerationClient(row: unknown | null) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn(async () => ({ data: row, error: row ? null : { code: 'PGRST116' } })),
  };
  const from = vi.fn(() => chain);
  return { from, chain };
}

function mockAuth() {
  vi.mocked(requireSupabaseSession).mockResolvedValue({
    auth: { userId: USER_ID, accessToken: 'pe_test_key', isApiKey: true },
    error: null,
  } as never);
}

async function getGeneration(id: string): Promise<Response> {
  return GET(new Request(`https://example.com/api/persona/video-generations/${id}`), {
    params: Promise.resolve({ generationId: id }),
  });
}

describe('GET /api/persona/video-generations/[generationId]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the generation detail with the list row shape', async () => {
    const client = mockGenerationClient(GENERATION_ROW);
    mockAuth();
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await getGeneration('gen-3');

    expect(response.status).toBe(200);
    const body = (await response.json()) as { success: boolean; generation: Record<string, unknown> };
    expect(body.success).toBe(true);
    expect(body.generation).toEqual({
      id: 'row-1',
      generationId: 'gen-3',
      engineTaskId: 'task-3',
      personaName: 'Viva Leve',
      videoSubject: 'Launch recap',
      status: 'completed',
      errorCode: null,
      tokensRefunded: false,
      createdAt: '2026-09-23T12:00:00.000Z',
      completedAt: '2026-09-23T12:02:00.000Z',
    });
    // Scoped by the caller's user id AND the id param.
    expect(client.chain.eq).toHaveBeenCalledWith('user_id', USER_ID);
    expect(client.chain.eq).toHaveBeenCalledWith('generation_id', 'gen-3');
  });

  it('returns 404 for an unknown generation id', async () => {
    const client = mockGenerationClient(null);
    mockAuth();
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await getGeneration('unknown');

    expect(response.status).toBe(404);
    const body = (await response.json()) as { success: boolean };
    expect(body.success).toBe(false);
  });

  it('returns 401 when authentication fails', async () => {
    const authError = Response.json(
      { success: false, error: 'Authentication required.' },
      { status: 401 },
    );
    vi.mocked(requireSupabaseSession).mockResolvedValue({ auth: null, error: authError } as never);

    const response = await getGeneration('gen-3');

    expect(response.status).toBe(401);
  });

  it('returns 500 and logs when the lookup fails (DB down, not missing)', async () => {
    const { logger } = await import('@/lib/logger');
    const client = mockGenerationClient(null);
    client.chain.single.mockResolvedValue({ data: null, error: { code: 'XX000', message: 'connection reset' } } as never);
    mockAuth();
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await getGeneration('gen-3');

    expect(response.status).toBe(500);
    expect(logger.error).toHaveBeenCalledWith(
      '[api/persona/video-generations] generation lookup failed',
      expect.objectContaining({ code: 'XX000' }),
    );
  });

  it('keeps PGRST116 as a plain 404 without an error log', async () => {
    const { logger } = await import('@/lib/logger');
    const client = mockGenerationClient(null);
    client.chain.single.mockResolvedValue({ data: null, error: { code: 'PGRST116' } });
    mockAuth();
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await getGeneration('gen-3');

    expect(response.status).toBe(404);
    expect(logger.error).not.toHaveBeenCalled();
  });
});
