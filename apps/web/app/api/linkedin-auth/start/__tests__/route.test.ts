import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
}));
vi.mock('@/lib/oauth-utils', () => ({
  createOAuthState: vi.fn(() => ({ state: 'state-1', nonce: 'nonce-1' })),
  resolveOAuthRedirectUri: vi.fn(() => 'https://post-engineer.com/api/linkedin-auth/callback'),
  setOAuthNonceCookie: vi.fn(),
}));
vi.mock('@/lib/api-error-reporting', () => ({
  withApiErrorReporting: (_route: string, handler: unknown) => handler,
  markApiErrorReported: vi.fn(),
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
import { logger } from '@/lib/logger';
import { markApiErrorReported } from '@/lib/api-error-reporting';

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

  it('returns 500 naming the credentials when LinkedIn credentials are missing', async () => {
    vi.stubEnv('LINKEDIN_CLIENT_ID', undefined);
    const res = await GET();
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('LINKEDIN_CLIENT_ID');
    // The missing-credentials cause is logged so PostHog shows the reason
    // instead of only the wrapper's generic "[route] 500", and the response
    // is marked so the wrapper does not report a second synthetic exception.
    expect(logger.logOAuthError).toHaveBeenCalledWith(
      'log-1',
      expect.objectContaining({ message: expect.stringContaining('LINKEDIN_CLIENT_ID') }),
    );
    expect(markApiErrorReported).toHaveBeenCalledWith(res);
  });
});
