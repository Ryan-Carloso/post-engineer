import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
}));

import { POST } from '../route';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { RATE_LIMITS } from '@/lib/rate-limit';

describe('POST /api/billing/checkout rate limiting', () => {
  it('returns 429 after the billingCheckout profile limit is exhausted', async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: { message: 'no session' } }),
      },
    } as never);
    const headers = {
      'Content-Type': 'application/json',
      'x-vercel-forwarded-for': '10.250.0.5',
    };
    const url = 'http://localhost:3434/api/billing/checkout';
    for (let i = 0; i < RATE_LIMITS.billingCheckout.limit; i++) {
      const res = await POST(new Request(url, { method: 'POST', headers, body: '{}' }));
      expect(res.status).toBe(401);
    }
    const blocked = await POST(new Request(url, { method: 'POST', headers, body: '{}' }));
    expect(blocked.status).toBe(429);
  });
});
