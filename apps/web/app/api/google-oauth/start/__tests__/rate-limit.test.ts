import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
}));

import { GET } from '../route';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { RATE_LIMITS } from '@/lib/rate-limit';

describe('GET /api/google-oauth/start rate limiting', () => {
  it('returns 429 after the oauthStart profile limit is exhausted', async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: { message: 'no session' } }),
      },
    } as never);
    const headers = { 'x-vercel-forwarded-for': '10.250.0.8' };
    const url = 'http://localhost:3434/api/google-oauth/start';
    for (let i = 0; i < RATE_LIMITS.oauthStart.limit; i++) {
      const res = await GET(new NextRequest(url, { headers }));
      expect(res.status).toBe(401);
    }
    const blocked = await GET(new NextRequest(url, { headers }));
    expect(blocked.status).toBe(429);
  });
});
