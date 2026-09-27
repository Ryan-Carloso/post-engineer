import { describe, it, expect, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/request-auth', () => ({
  requireSupabaseSession: vi.fn(),
}));

import { POST } from '../route';
import { requireSupabaseSession } from '@/lib/request-auth';
import { RATE_LIMITS } from '@/lib/rate-limit';

describe('POST /api/account/connect-url rate limiting', () => {
  it('returns 429 after the connectUrl profile limit is exhausted', async () => {
    vi.mocked(requireSupabaseSession).mockResolvedValue({
      auth: null,
      error: NextResponse.json({ success: false }, { status: 401 }),
    });
    const headers = {
      'Content-Type': 'application/json',
      'x-vercel-forwarded-for': '10.250.0.7',
    };
    const url = 'http://localhost:3434/api/account/connect-url';
    for (let i = 0; i < RATE_LIMITS.connectUrl.limit; i++) {
      const res = await POST(
        new NextRequest(url, { method: 'POST', headers, body: '{}' }),
      );
      expect(res.status).toBe(401);
    }
    const blocked = await POST(new NextRequest(url, { method: 'POST', headers, body: '{}' }));
    expect(blocked.status).toBe(429);
  });
});
