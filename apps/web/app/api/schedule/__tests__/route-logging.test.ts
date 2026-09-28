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

const USER_ID = 'user-1';

//---------------
// Minimal supabase mock for the POST insert flow:
// persona ownership -> duplicate check -> account ownership -> insert.
//---------------

function mockSupabase(insertResult: { data: unknown; error: unknown }) {
  const client = {
    from: vi.fn((table: string) => {
      if (table === 'personas') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: { id: 'p-1' } }),
        };
      }
      if (table === 'social_accounts') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          in: vi.fn(async () => ({
            data: [{ provider_account_id: 'yt-1' }, { provider_account_id: 'yt-2' }],
            error: null,
          })),
        };
      }
      // schedules
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null }),
        insert: vi.fn(() => ({
          select: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue(insertResult),
        })),
      };
    }),
  };
  vi.mocked(createSupabaseServerClient).mockResolvedValue(client as never);
  vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);
  vi.mocked(requireSupabaseSession).mockResolvedValue({
    auth: { userId: USER_ID, accessToken: 'cookie-token' },
    error: null,
  });
}

const validBody = {
  personaId: 'p-1',
  providers: ['youtube'],
  youtubeAccountIds: ['yt-1', 'yt-2'],
  instagramAccountIds: [],
  daysOfWeek: [1, 3, 5],
  startHour: 9,
  endHour: 18,
  postsPerDay: 2,
  timezone: 'America/Sao_Paulo',
  times: ['09:30', '18:00'],
};

describe('POST /api/schedule insert failure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('logs the database error to Bugsink and returns a sanitized 500', async () => {
    // Regression test for the production Bluesky scheduling 500: the real
    // Postgres message/code/details/hint must reach the central logger
    // (Bugsink in production) while the client only sees a generic message.
    const dbError = {
      message: 'new row violates check constraint "schedules_providers_check"',
      code: '23514',
      details: 'Failing row contains (bluesky, ...).',
      hint: null,
    };
    mockSupabase({ data: null, error: dbError });

    const res = await POST(
      new Request('http://localhost/api/schedule', {
        method: 'POST',
        body: JSON.stringify(validBody),
      }),
    );

    expect(res.status).toBe(500);
    const body = (await res.json()) as { message?: string; error?: string };
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('23514');
    expect(serialized).not.toContain('check constraint');
    expect(body.message ?? body.error).toMatch(/failed to create schedule/i);

    expect(logger.error).toHaveBeenCalledWith('[api/schedule] insert failed', dbError);
  });
});
