import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';

import { GET } from '../route';
import { RATE_LIMITS } from '@/lib/rate-limit';

describe('GET /api/instagram-auth/start rate limiting', () => {
  it('returns 429 after the oauthStart profile limit is exhausted', async () => {
    const headers = { 'x-vercel-forwarded-for': '10.250.0.9' };
    const url = 'http://localhost:3434/api/instagram-auth/start';
    for (let i = 0; i < RATE_LIMITS.oauthStart.limit; i++) {
      const res = await GET(new NextRequest(url, { headers }));
      expect(res.status).not.toBe(429);
    }
    const blocked = await GET(new NextRequest(url, { headers }));
    expect(blocked.status).toBe(429);
  });
});
