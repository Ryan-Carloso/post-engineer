// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/rate-limit', () => ({ applyRateLimit: vi.fn(async () => null), RATE_LIMITS: { oauthStart: {}, pinterestBoards: {} } }));
vi.mock('@/lib/api-error-reporting', () => ({ withApiErrorReporting: (_route: string, handler: unknown) => handler, resolveReportingUserId: vi.fn(), markApiErrorReported: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: vi.fn() }));
vi.mock('@/lib/supabase/service', () => ({ createSupabaseServiceClient: vi.fn(() => ({ __mock: 'service' })) }));
vi.mock('@/lib/logger', () => ({ logger: { generateLogId: vi.fn(() => 'log-1'), logOAuthError: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/account-profile-telemetry', () => ({ reportProfileFetched: vi.fn(), reportProfileFetchFailed: vi.fn() }));
vi.mock('@/lib/oauth-connect', () => ({ resolveOAuthCallbackAuth: vi.fn() }));
vi.mock('@/lib/social-accounts', () => ({ upsertSocialAccount: vi.fn() }));
vi.mock('@/lib/pinterest', () => ({
  buildPinterestAuthorizationUrl: vi.fn(() => 'https://www.pinterest.com/oauth/?x=1'),
  exchangePinterestCodeForToken: vi.fn(),
  fetchPinterestUserProfile: vi.fn(),
}));
vi.mock('@/lib/oauth-utils', () => ({
  createOAuthState: vi.fn(() => ({ state: 's', nonce: 'n' })),
  resolveOAuthRedirectUri: vi.fn(() => 'https://app.example/cb'),
  setOAuthNonceCookie: vi.fn(),
  oauthPopupResponse: vi.fn((type: string, data: unknown) => Response.json({ type, data })),
}));

import { GET as startGET } from '@/app/api/pinterest-auth/start/route';
import { GET as callbackGET } from '@/app/api/pinterest-auth/callback/route';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { resolveOAuthCallbackAuth } from '@/lib/oauth-connect';
import { upsertSocialAccount } from '@/lib/social-accounts';
import { buildPinterestAuthorizationUrl, exchangePinterestCodeForToken, fetchPinterestUserProfile } from '@/lib/pinterest';
import { createOAuthState, resolveOAuthRedirectUri, setOAuthNonceCookie } from '@/lib/oauth-utils';
import { reportProfileFetched, reportProfileFetchFailed } from '@/lib/account-profile-telemetry';
import { logger } from '@/lib/logger';
import { markApiErrorReported } from '@/lib/api-error-reporting';

const START = 'https://app.example/api/pinterest-auth/start';
const CALLBACK = 'https://app.example/api/pinterest-auth/callback';

function session(user: { id: string } | null): void {
  vi.mocked(createSupabaseServerClient).mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user }, error: user === null ? new Error('no session') : null }) },
  } as never);
}

describe('GET /api/pinterest-auth/start', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PINTEREST_CLIENT_ID = 'pin-id';
    process.env.PINTEREST_CLIENT_SECRET = 'pin-secret';
    session({ id: 'user-1' });
  });

  it('returns the Pinterest authorization URL for a signed-in user', async () => {
    const res = await startGET(new NextRequest(START));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; auth_url: string };
    expect(body.success).toBe(true);
    expect(body.auth_url).toBe('https://www.pinterest.com/oauth/?x=1');
    expect(buildPinterestAuthorizationUrl).toHaveBeenCalledWith('s', 'https://app.example/cb');
    expect(createOAuthState).toHaveBeenCalledWith({ provider: 'pinterest', redirectUri: 'https://app.example/cb' });
    expect(resolveOAuthRedirectUri).toHaveBeenCalled();
    expect(setOAuthNonceCookie).toHaveBeenCalled();
  });

  it('returns 401 without a session', async () => {
    session(null);
    const res = await startGET(new NextRequest(START));
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Authentication required. Please log in.');
  });

  it('returns 500 when the Pinterest credentials are missing', async () => {
    vi.stubEnv('PINTEREST_CLIENT_ID', undefined);
    const res = await startGET(new NextRequest(START));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('PINTEREST_CLIENT_ID');
    // The missing-credentials cause is logged so PostHog shows the reason
    // instead of only the wrapper's generic "[route] 500", and the response
    // is marked so the wrapper does not report a second synthetic exception.
    expect(logger.logOAuthError).toHaveBeenCalledWith(
      'log-1',
      expect.objectContaining({ message: expect.stringContaining('PINTEREST_CLIENT_ID') }),
    );
    expect(markApiErrorReported).toHaveBeenCalledWith(res);
  });

  it('returns 500 with a generic error when URL building fails (no internal details leaked)', async () => {
    vi.mocked(buildPinterestAuthorizationUrl).mockImplementation(() => {
      throw new Error('pin secret misconfigured');
    });
    const res = await startGET(new NextRequest(START));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Failed to generate the authorization URL.');
    expect(body.error).not.toContain('pin secret misconfigured');
  });
});

describe('GET /api/pinterest-auth/callback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    session({ id: 'user-1' });
    vi.mocked(resolveOAuthCallbackAuth).mockResolvedValue({
      ok: true,
      userId: 'user-1',
      redirectUri: 'https://app.example/cb',
      viaMcp: false,
    } as never);
    vi.mocked(exchangePinterestCodeForToken).mockResolvedValue({
      access_token: 'at-1',
      refresh_token: 'rt-1',
      expires_in: 2592000,
      token_type: 'Bearer',
    } as never);
    vi.mocked(fetchPinterestUserProfile).mockResolvedValue({
      id: 'user-9',
      username: 'maker',
      profileImage: 'https://i.pinimg.com/p.jpg',
    } as never);
  });

  function callbackRequest(query: string): NextRequest {
    return new NextRequest(`${CALLBACK}${query}`);
  }

  it('persists the account with the v5 user id and returns the success popup', async () => {
    const res = await callbackGET(callbackRequest('?code=c&state=s'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { type: string; data: { account: Record<string, unknown> } };
    expect(body.type).toBe('pinterest-oauth-success');
    expect(body.data.account).toMatchObject({ provider: 'pinterest', providerAccountId: 'user-9', accountName: 'maker' });
    expect(exchangePinterestCodeForToken).toHaveBeenCalledWith('c', 'https://app.example/cb');
    expect(fetchPinterestUserProfile).toHaveBeenCalledWith('at-1');
    expect(reportProfileFetched).toHaveBeenCalledWith('pinterest', 'connect', { accountName: 'maker', pictureUrl: 'https://i.pinimg.com/p.jpg' });
    expect(upsertSocialAccount).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: 'user-1',
        provider: 'pinterest',
        providerAccountId: 'user-9',
        accountName: 'maker',
        tokens: expect.objectContaining({ access_token: 'at-1', refresh_token: 'rt-1' }),
      }),
    );
  });

  it('returns the error popup when Pinterest reports an error', async () => {
    const res = await callbackGET(callbackRequest('?error=access_denied&state=s'));
    const body = (await res.json()) as { type: string; data: { error: string } };
    expect(body.type).toBe('pinterest-oauth-error');
    expect(body.data.error).toBe('Pinterest authorization was not completed.');
    expect(exchangePinterestCodeForToken).not.toHaveBeenCalled();
  });

  it('returns the error popup without a code', async () => {
    const res = await callbackGET(callbackRequest('?state=s'));
    const body = (await res.json()) as { type: string; data: { error: string } };
    expect(body.type).toBe('pinterest-oauth-error');
    expect(body.data.error).toBe('Missing authorization code');
  });

  it('returns the error popup when the callback auth fails', async () => {
    vi.mocked(resolveOAuthCallbackAuth).mockResolvedValue({ ok: false, error: 'Invalid state' } as never);
    const res = await callbackGET(callbackRequest('?code=c&state=s'));
    const body = (await res.json()) as { type: string; data: { error: string } };
    expect(body.type).toBe('pinterest-oauth-error');
    expect(body.data.error).toBe('Invalid state');
    expect(exchangePinterestCodeForToken).not.toHaveBeenCalled();
  });

  it('returns the error popup and reports the failure when the exchange fails', async () => {
    vi.mocked(exchangePinterestCodeForToken).mockRejectedValue(new Error('bad code'));
    const res = await callbackGET(callbackRequest('?code=c&state=s'));
    const body = (await res.json()) as { type: string; data: { error: string } };
    expect(body.type).toBe('pinterest-oauth-error');
    expect(body.data.error).toBe('Failed to connect the Pinterest account.');
    expect(reportProfileFetchFailed).toHaveBeenCalledWith('pinterest', 'connect', expect.any(Error));
    expect(upsertSocialAccount).not.toHaveBeenCalled();
  });
});
