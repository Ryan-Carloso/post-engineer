import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
}));
vi.mock('@/lib/oauth-utils', () => ({
  createOAuthState: vi.fn(),
  resolveOAuthRedirectUri: vi.fn(() => 'https://post-engineer.com/api/instagram-auth/callback'),
  setOAuthNonceCookie: vi.fn(),
}));
vi.mock('@/lib/api-error-reporting', () => ({
  withApiErrorReporting: (_route: string, handler: unknown) => handler,
  markApiErrorReported: vi.fn(),
}));
vi.mock('@/lib/logger', () => ({
  logger: { generateLogId: vi.fn(() => 'log-1'), logOAuthError: vi.fn() },
}));
vi.mock('@/lib/instagram', () => ({
  InstagramService: vi.fn().mockImplementation(() => ({
    getAuthorizationUrl: vi.fn(() => 'https://ig.auth'),
  })),
}));

import { GET } from '@/app/api/instagram-auth/start/route';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createOAuthState, setOAuthNonceCookie } from '@/lib/oauth-utils';
import { InstagramService } from '@/lib/instagram';
import { logger } from '@/lib/logger';
import { markApiErrorReported } from '@/lib/api-error-reporting';

const user = { id: 'user-1' };

function sessionMock(loggedIn: boolean): void {
  vi.mocked(createSupabaseServerClient).mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue(
        loggedIn
          ? { data: { user }, error: null }
          : { data: { user: null }, error: { message: 'no session' } },
      ),
    },
  } as never);
}


describe('/api/instagram-auth/start', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.INSTAGRAM_CLIENT_ID = 'ig-id';
    process.env.INSTAGRAM_CLIENT_SECRET = 'ig-secret';
    vi.mocked(InstagramService).mockImplementation(function () {
      return { getAuthorizationUrl: vi.fn(() => 'https://ig.auth') } as never;
    });
    vi.mocked(createOAuthState).mockReturnValue({
      state: 'state-1',
      nonce: 'nonce-1',
    });
  });

  it('returns 500 when instagram credentials are not configured', async () => {
    vi.stubEnv('INSTAGRAM_CLIENT_ID', undefined);
    const res = await GET();
    expect(res.status).toBe(500);
    // The missing-credentials cause is logged so PostHog shows the reason
    // instead of only the wrapper's generic "[route] 500", and the response
    // is marked so the wrapper does not report a second synthetic exception.
    expect(logger.logOAuthError).toHaveBeenCalledWith(
      'log-1',
      expect.objectContaining({ message: expect.stringContaining('INSTAGRAM_CLIENT_ID') }),
    );
    expect(markApiErrorReported).toHaveBeenCalledWith(res);
  });

  it('returns 401 when not logged in', async () => {
    sessionMock(false);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it('returns auth url on success (dono da conta = sessão)', async () => {
    sessionMock(true);
    const res = await GET();
    const body = (await res.json()) as { success: boolean; auth_url: string };
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.auth_url).toBe('https://ig.auth');
    expect(setOAuthNonceCookie).toHaveBeenCalled();
  });

  it('returns 500 with a generic error when the Instagram service throws (no internal details leaked)', async () => {
    sessionMock(true);
    vi.mocked(InstagramService).mockImplementation(function () {
      throw new Error('ig config missing');
    });
    const res = await GET();
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Failed to generate the authorization URL.');
    expect(body.error).not.toContain('ig config missing');
    expect(logger.logOAuthError).toHaveBeenCalledWith(
      'log-1',
      expect.objectContaining({ message: expect.stringContaining('ig config missing') }),
    );
    // The logged cause is already reported to PostHog, so the response is
    // marked so the wrapper does not report a second synthetic exception.
    expect(markApiErrorReported).toHaveBeenCalledWith(res);
  });
});
