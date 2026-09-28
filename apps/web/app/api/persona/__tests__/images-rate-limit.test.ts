import { describe, it, expect, vi } from 'vitest';
import type { NextResponse } from 'next/server';

vi.mock('@/lib/request-auth', () => ({
  requireSupabaseSession: vi.fn(),
}));

import { POST } from '../images/route';
import { requireSupabaseSession } from '@/lib/request-auth';
import { RATE_LIMITS } from '@/lib/rate-limit';

describe('POST /api/persona/images rate limiting', () => {
  it('returns 429 after the mediaUpload profile limit is exhausted', async () => {
    vi.mocked(requireSupabaseSession).mockResolvedValue({
      auth: null,
      error: new Response('auth', { status: 401 }) as unknown as NextResponse,
    });
    const headers = {
      'Content-Type': 'application/json',
      'x-vercel-forwarded-for': '10.250.0.7',
    };
    const url = 'http://localhost:3434/api/persona/images';
    for (let i = 0; i < RATE_LIMITS.mediaUpload.limit; i++) {
      const res = await POST(new Request(url, { method: 'POST', headers, body: '{}' }));
      expect(res.status).toBe(401);
    }
    const blocked = await POST(new Request(url, { method: 'POST', headers, body: '{}' }));
    expect(blocked.status).toBe(429);
  });
});
