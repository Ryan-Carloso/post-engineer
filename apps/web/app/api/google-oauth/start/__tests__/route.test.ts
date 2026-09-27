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
vi.mock('@/lib/youtube', () => ({
  createGoogleOAuth2Client: vi.fn(),
  generateGoogleAuthUrl: vi.fn(),
}));

import { GET } from '@/app/api/google-oauth/start/route';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createOAuthState, setOAuthNonceCookie } from '@/lib/oauth-utils';
import { createGoogleOAuth2Client, generateGoogleAuthUrl } from '@/lib/youtube';

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
