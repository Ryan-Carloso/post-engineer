import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
}));
vi.mock('@/lib/oauth-utils', () => ({
  createOAuthState: vi.fn(() => ({ state: 'state-1', nonce: 'nonce-1' })),
  resolveOAuthRedirectUri: vi.fn(() => 'https://post-engineer.com/api/linkedin-auth/callback'),
  setOAuthNonceCookie: vi.fn(),
}));
vi.mock('@/lib/logger', () => ({
  logger: { generateLogId: vi.fn(() => 'log-1'), logOAuthError: vi.fn() },
}));
vi.mock('@/lib/linkedin', () => ({
  buildLinkedInAuthorizationUrl: vi.fn(() => {
    throw new Error('li secret misconfigured');
  }),
}));

import { GET } from '@/app/api/linkedin-auth/start/route';
import { createSupabaseServerClient } from '@/lib/supabase/server';

describe('GET /api/linkedin-auth/start', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.LINKEDIN_CLIENT_ID = 'li-id';
    process.env.LINKEDIN_CLIENT_SECRET = 'li-secret';
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null }),
      },
    } as never);
  });

  it('returns 500 with a generic error when URL building fails (no internal details leaked)', async () => {
    const res = await GET();
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Failed to generate the authorization URL.');
    expect(body.error).not.toContain('li secret misconfigured');
  });
});
