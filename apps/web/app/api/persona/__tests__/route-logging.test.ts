// @vitest-environment node
// API routes use native Request/FormData (undici); jsdom mixes
// implementations and locks up `request.formData()`.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
}));
vi.mock('@/lib/supabase/service', () => ({
  createSupabaseServiceClient: vi.fn(),
}));
vi.mock('@/lib/request-auth', () => ({
  requireSupabaseSession: vi.fn(),
}));
vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { POST } from '../route';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { requireSupabaseSession } from '@/lib/request-auth';
import { logger } from '@/lib/logger';

const USER_ID = 'user-uuid-1';

function mockSupabase(insertResult: { data: unknown; error: unknown }) {
  const from = {
    insert: vi.fn(() => ({
      select: vi.fn(() => ({
        single: vi.fn(async () => insertResult),
      })),
    })),
  };
  const client = {
    storage: { from: vi.fn() },
    from: vi.fn(() => from),
  };
  vi.mocked(createSupabaseServerClient).mockResolvedValue(client as never);
  vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);
  vi.mocked(requireSupabaseSession).mockResolvedValue({
    auth: { userId: USER_ID, accessToken: 'cookie-token' },
    error: null,
  });
}

function formRequest(fields: Record<string, string>): Request {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    formData.append(key, value);
  }
  return new Request('http://localhost/api/persona', { method: 'POST', body: formData });
}

describe('POST /api/persona insert failure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('logs the database error to PostHog and returns a sanitized 500', async () => {
    // An avatarUrl (no upload) keeps the mock minimal while satisfying the
    // "exactly one visual identity" rule, so the request reaches the personas
    // insert.
    const dbError = { message: 'duplicate key value violates unique constraint', code: '23505' };
    mockSupabase({ data: null, error: dbError });

    const res = await POST(
      formRequest({
        name: 'Canal Teste',
        avatarUrl: 'data:image/png;base64,IA',
        voiceId: 'voz-1',
      }),
    );

    expect(res.status).toBe(500);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toMatch(/failed to create persona/i);
    expect(JSON.stringify(body)).not.toContain('23505');

    // The cause is threaded through apiErrorResponse: a single logger.error
    // with the real DB error, and the errorId points at that event.
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      '[POST /api/persona] 500 Failed to create persona.',
      dbError,
      expect.objectContaining({ route: 'POST /api/persona' }),
    );
  });
});
