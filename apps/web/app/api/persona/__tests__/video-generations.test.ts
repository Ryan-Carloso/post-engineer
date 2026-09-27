import { describe, it, expect, vi, beforeEach } from 'vitest';

//---------------
// Tests for GET /api/persona/video-generations — the user's video
// generation history. Supabase is a mocked boundary; the row mapping and
// the ?limit= validation are real.
//---------------

vi.mock('@/lib/request-auth', () => ({
  requireSupabaseSession: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock('@/lib/supabase/service', () => ({
  createSupabaseServiceClient: vi.fn(),
}));

import { GET, parseGenerationsLimit } from '../video-generations/route';
import { requireSupabaseSession } from '@/lib/request-auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';

const USER_ID = 'user-uuid-1';

const ROW = {
  id: 'row-1',
  generation_id: 'gen-1',
  engine_task_id: 'task-1',
  persona_name: 'Viva Leve',
  video_subject: 'myth busting',
  status: 'failed',
  error_code: 'custom_audio_invalid',
  error_message: 'custom audio file is invalid: boom',
  tokens_refunded: true,
  created_at: '2026-09-23T10:00:00Z',
  completed_at: '2026-09-23T10:01:00Z',
};

function mockClient(rows: unknown[] | null, error: unknown = null) {
  const limit = vi.fn().mockResolvedValue({ data: rows, error });
  const order = vi.fn().mockReturnValue({ limit });
  const eq = vi.fn().mockReturnValue({ order });
  const select = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ select });
  return { from, select, eq, order, limit };
}

function mockSession() {
  vi.mocked(requireSupabaseSession).mockResolvedValue({
    auth: { userId: USER_ID },
    error: undefined,
  } as never);
}

describe('GET /api/persona/video-generations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession();
  });

  it('returns the newest-first mapped rows scoped to the user', async () => {
    const client = mockClient([ROW]);
    vi.mocked(createSupabaseServerClient).mockResolvedValue(client as never);

    const response = await GET(new Request('https://x/api/persona/video-generations'));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.generations).toEqual([
      {
        id: 'row-1',
        generationId: 'gen-1',
        engineTaskId: 'task-1',
        personaName: 'Viva Leve',
        videoSubject: 'myth busting',
        status: 'failed',
        errorCode: 'custom_audio_invalid',
        tokensRefunded: true,
        createdAt: '2026-09-23T10:00:00Z',
        completedAt: '2026-09-23T10:01:00Z',
      },
    ]);
    expect(client.from).toHaveBeenCalledWith('video_generations');
    expect(client.eq).toHaveBeenCalledWith('user_id', USER_ID);
    expect(client.order).toHaveBeenCalledWith('created_at', { ascending: false });
  });

  it('never selects or returns the raw engine error message', async () => {
    // Review MINOR: error_message may contain paths or upstream bodies and
    // is kept server-side for support only — the UI renders errorCode, so
    // the API must not ship the raw text to the browser (visible via
    // devtools even when never rendered).
    const client = mockClient([ROW]);
    vi.mocked(createSupabaseServerClient).mockResolvedValue(client as never);

    const response = await GET(new Request('https://x/api/persona/video-generations'));
    expect(response.status).toBe(200);
    const selectArg = vi.mocked(client.select).mock.calls[0]?.[0] as string;
    expect(selectArg).not.toContain('error_message');
    const body = await response.json();
    expect(body.generations[0]).not.toHaveProperty('errorMessage');
  });

  it('returns 401 without a session', async () => {
    const authError = new Response(JSON.stringify({ error: 'x' }), { status: 401 });
    vi.mocked(requireSupabaseSession).mockResolvedValue({ auth: null, error: authError } as never);
    const response = await GET(new Request('https://x/api/persona/video-generations'));
    expect(response.status).toBe(401);
  });

  it('returns 500 when the query fails', async () => {
    const client = mockClient(null, new Error('db down'));
    vi.mocked(createSupabaseServerClient).mockResolvedValue(client as never);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = await GET(new Request('https://x/api/persona/video-generations'));
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.success).toBe(false);
  });
});

describe('parseGenerationsLimit', () => {
  it('defaults to 50 and caps at 200', () => {
    expect(parseGenerationsLimit(null)).toBe(50);
    expect(parseGenerationsLimit('abc')).toBe(50);
    expect(parseGenerationsLimit('0')).toBe(50);
    expect(parseGenerationsLimit('12abc')).toBe(50);
    expect(parseGenerationsLimit('25')).toBe(25);
    expect(parseGenerationsLimit('9999')).toBe(200);
  });
});
