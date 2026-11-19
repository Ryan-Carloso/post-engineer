// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/request-auth', () => ({
  requireSupabaseSession: vi.fn(),
}));
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
}));
vi.mock('@/lib/supabase/service', () => ({
  createSupabaseServiceClient: vi.fn(),
}));
vi.mock('@/lib/posthog-server', () => ({
  getPostHogServer: vi.fn(),
}));

import { requireSupabaseSession } from '@/lib/request-auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { getPostHogServer } from '@/lib/posthog-server';
import { GET } from '../route';

describe('GET /api/billing/tokens (OAuth)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getPostHogServer).mockReturnValue({
      capture: vi.fn(),
      captureAs: vi.fn(),
    } as never);
  });

  it('uses the service client for OAuth tokens (balance is not a silent 0)', async () => {
    vi.mocked(requireSupabaseSession).mockResolvedValue({
      auth: { userId: 'user-1', accessToken: 'oauth.jwt.token', isOAuth: true },
      error: null,
    } as never);
    const single = vi.fn().mockResolvedValue({
      data: { tokens_balance: '5', free_tokens_balance: '3' },
    });
    const eq = vi.fn().mockReturnValue({ single });
    const select = vi.fn().mockReturnValue({ eq });
    vi.mocked(createSupabaseServiceClient).mockReturnValue({
      rpc: vi.fn().mockResolvedValue({ error: null }),
      from: vi.fn().mockReturnValue({ select }),
    } as never);

    const res = await GET(new Request('https://example.com/api/billing/tokens'));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, balance: 8, free: 3 });
    expect(createSupabaseServerClient).not.toHaveBeenCalled();
    expect(eq).toHaveBeenCalledWith('id', 'user-1');
  });
});
