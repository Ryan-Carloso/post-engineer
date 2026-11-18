// @vitest-environment node
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
vi.mock('@/lib/voice-catalog-fetch', () => ({
  fetchPersonaVoiceCatalogIds: vi.fn(async () => undefined),
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
    const dbError = { message: 'duplicate key value violates unique constraint', code: '23505' };
    mockSupabase({ data: null, error: dbError });

    const res = await POST(
      formRequest({
        name: 'Canal Teste',
        avatarUrl: 'data:image/png;base64,IA',
        voiceId: 'chatterbox:kokoro_af_heart',
        publishingAccounts: JSON.stringify({ youtube: ['acct-1'] }),
      }),
    );

    expect(res.status).toBe(500);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toMatch(/failed to create persona/i);
    expect(JSON.stringify(body)).not.toContain('23505');

    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      '[POST /api/persona] 500 Failed to create persona.',
      dbError,
      expect.objectContaining({ route: 'POST /api/persona' }),
    );
  });
});
