import { describe, it, expect, vi } from 'vitest';
import type { NextResponse } from 'next/server';

vi.mock('@/lib/request-auth', () => ({
  requireSupabaseSession: vi.fn(),
}));

import { POST } from '../route';
import { requireSupabaseSession } from '@/lib/request-auth';
import { RATE_LIMITS } from '@/lib/rate-limit';

describe('POST /api/persona/video-batch rate limiting', () => {
  it('returns 429 after the videoJob profile limit is exhausted', async () => {
    vi.mocked(requireSupabaseSession).mockResolvedValue({
      auth: null,
      error: new Response('auth', { status: 401 }) as unknown as NextResponse,
    });
    const headers = {
      'Content-Type': 'application/json',
      'x-vercel-forwarded-for': '10.250.0.99',
    };
    const url = 'http://localhost:3434/api/persona/video-batch';
    for (let i = 0; i < RATE_LIMITS.videoJob.limit; i++) {
      const res = await POST(new Request(url, { method: 'POST', headers, body: '{}' }));
      expect(res.status).toBe(401);
    }
    const blocked = await POST(new Request(url, { method: 'POST', headers, body: '{}' }));
    expect(blocked.status).toBe(429);
  });
});
