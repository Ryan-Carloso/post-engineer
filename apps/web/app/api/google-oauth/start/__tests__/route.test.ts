import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
}));
vi.mock('@/lib/oauth-utils', () => ({
  createOAuthState: vi.fn(),
  resolveOAuthRedirectUri: vi.fn(() => 'https://post-engineer.com/api/google-oauth/callback'),
  setOAuthNonceCookie: vi.fn(),
}));
vi.mock('@/lib/logger', () => ({
  logger: { generateLogId: vi.fn(() => 'log-1'), logOAuthError: vi.fn() },
}));
vi.mock('@/lib/api-error-reporting', () => ({
  withApiErrorReporting: (_route: string, handler: unknown) => handler,
  resolveReportingUserId: vi.fn(),
  markApiErrorReported: vi.fn(),
}));
vi.mock('@/lib/youtube', () => ({
  createGoogleOAuth2Client: vi.fn(),
  generateGoogleAuthUrl: vi.fn(),
}));

import { GET } from '@/app/api/google-oauth/start/route';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createOAuthState, setOAuthNonceCookie } from '@/lib/oauth-utils';
import { createGoogleOAuth2Client, generateGoogleAuthUrl } from '@/lib/youtube';
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

describe('/api/google-oauth/start', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GOOGLE_CLIENT_ID = 'google-id';
    process.env.GOOGLE_CLIENT_SECRET = 'google-secret';
    vi.mocked(createOAuthState).mockReturnValue({
      state: 'state-1',
      nonce: 'nonce-1',
    });
    vi.mocked(generateGoogleAuthUrl).mockReturnValue('https://auth.url');
    vi.mocked(createGoogleOAuth2Client).mockResolvedValue({} as never);
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
    expect(body.auth_url).toBe('https://auth.url');
    expect(setOAuthNonceCookie).toHaveBeenCalled();
  });

  it('returns 500 when the Google credentials are missing', async () => {
    sessionMock(true);
    vi.stubEnv('GOOGLE_CLIENT_ID', undefined);
    vi.stubEnv('GOOGLE_CLIENT_SECRET', undefined);
    const res = await GET();
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('GOOGLE_CLIENT_ID');
    // The missing-credentials cause is logged so PostHog shows the reason
    // instead of only the wrapper's generic "[route] 500", and the response
    // is marked so the wrapper does not report a second synthetic exception.
    expect(logger.logOAuthError).toHaveBeenCalledWith(
      'log-1',
      expect.objectContaining({ message: expect.stringContaining('GOOGLE_CLIENT_ID') }),
    );
    expect(markApiErrorReported).toHaveBeenCalledWith(res);
  });

  it('returns 500 when only the Google client secret is missing', async () => {
    sessionMock(true);
    vi.stubEnv('GOOGLE_CLIENT_SECRET', undefined);
    const res = await GET();
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('GOOGLE_CLIENT_SECRET');
    expect(logger.logOAuthError).toHaveBeenCalledWith(
      'log-1',
      expect.objectContaining({ message: expect.stringContaining('GOOGLE_CLIENT_SECRET') }),
    );
    expect(markApiErrorReported).toHaveBeenCalledWith(res);
  });

  it('returns 500 with a generic error when the oauth client fails (no internal details leaked)', async () => {
    sessionMock(true);
    vi.mocked(createGoogleOAuth2Client).mockRejectedValue(new Error('boom'));
    const res = await GET();
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Failed to generate the authorization URL.');
    expect(body.error).not.toContain('boom');
  });
});
