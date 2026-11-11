// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/rate-limit', () => ({ applyRateLimit: vi.fn(async () => null), RATE_LIMITS: { oauthStart: {}, pinterestBoards: {} } }));
vi.mock('@/lib/api-error-reporting', () => ({ withApiErrorReporting: (_route: string, handler: unknown) => handler, resolveReportingUserId: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: vi.fn() }));
vi.mock('@/lib/supabase/service', () => ({ createSupabaseServiceClient: vi.fn(() => ({ __mock: 'service' })) }));
vi.mock('@/lib/logger', () => ({ logger: { generateLogId: vi.fn(() => 'log-1'), logOAuthError: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/account-profile-telemetry', () => ({ reportProfileFetched: vi.fn(), reportProfileFetchFailed: vi.fn() }));
vi.mock('@/lib/oauth-connect', () => ({ resolveOAuthCallbackAuth: vi.fn() }));
vi.mock('@/lib/social-accounts', () => ({ upsertSocialAccount: vi.fn() }));
vi.mock('@/lib/fanvue', () => ({
  buildFanvueAuthUrl: vi.fn(() => ({ authUrl: 'https://auth.fanvue.com/oauth2/auth?x=1', codeVerifier: 'verifier-1' })),
  exchangeFanvueCode: vi.fn(),
  fetchFanvueProfile: vi.fn(),
}));
vi.mock('@/lib/oauth-utils', () => ({
  createOAuthState: vi.fn(() => ({ state: 's', nonce: 'n' })),
  resolveOAuthRedirectUri: vi.fn(() => 'https://app.example/cb'),
  setOAuthNonceCookie: vi.fn(),
  setFanvueCodeVerifierCookie: vi.fn(),
  oauthPopupResponse: vi.fn((type: string, data: unknown) => Response.json({ type, data })),
}));

import { GET as startGET } from '@/app/api/fanvue-auth/start/route';
import { GET as callbackGET } from '@/app/api/fanvue-auth/callback/route';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { resolveOAuthCallbackAuth } from '@/lib/oauth-connect';
import { upsertSocialAccount } from '@/lib/social-accounts';
import { buildFanvueAuthUrl, exchangeFanvueCode, fetchFanvueProfile } from '@/lib/fanvue';
import { createOAuthState, resolveOAuthRedirectUri, setOAuthNonceCookie, setFanvueCodeVerifierCookie } from '@/lib/oauth-utils';
import { reportProfileFetched, reportProfileFetchFailed } from '@/lib/account-profile-telemetry';

const START = 'https://app.example/api/fanvue-auth/start';
const CALLBACK = 'https://app.example/api/fanvue-auth/callback';

function session(user: { id: string } | null): void {
  vi.mocked(createSupabaseServerClient).mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user }, error: user === null ? new Error('no session') : null }) },
  } as never);
}

describe('GET /api/fanvue-auth/start', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.FANVUE_CLIENT_ID = 'fan-id';
    process.env.FANVUE_CLIENT_SECRET = 'fan-secret';
    session({ id: 'user-1' });
  });

  it('returns the Fanvue authorization URL for a signed-in user and stores the PKCE verifier', async () => {
    const res = await startGET(new NextRequest(START));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; auth_url: string };
    expect(body.success).toBe(true);
    expect(body.auth_url).toBe('https://auth.fanvue.com/oauth2/auth?x=1');
    expect(buildFanvueAuthUrl).toHaveBeenCalledWith('s', 'https://app.example/cb');
    expect(createOAuthState).toHaveBeenCalledWith({ provider: 'fanvue', redirectUri: 'https://app.example/cb' });
    expect(resolveOAuthRedirectUri).toHaveBeenCalled();
    expect(setOAuthNonceCookie).toHaveBeenCalled();
    expect(setFanvueCodeVerifierCookie).toHaveBeenCalledWith(expect.anything(), 'verifier-1');
  });

  it('returns 401 without a session', async () => {
    session(null);
    const res = await startGET(new NextRequest(START));
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Authentication required. Please log in.');
  });

  it('returns 500 when the Fanvue credentials are missing', async () => {
    delete process.env.FANVUE_CLIENT_ID;
    const res = await startGET(new NextRequest(START));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('FANVUE_CLIENT_ID');
  });

  it('returns 500 with a generic error when URL building fails (no internal details leaked)', async () => {
    vi.mocked(buildFanvueAuthUrl).mockImplementation(() => {
      throw new Error('fan secret misconfigured');
    });
    const res = await startGET(new NextRequest(START));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Failed to generate the authorization URL.');
    expect(body.error).not.toContain('fan secret misconfigured');
  });
});

describe('GET /api/fanvue-auth/callback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    session({ id: 'user-1' });
    vi.mocked(resolveOAuthCallbackAuth).mockResolvedValue({
      ok: true,
      userId: 'user-1',
      redirectUri: 'https://app.example/cb',
      viaMcp: false,
      codeVerifier: 'verifier-1',
    } as never);
    vi.mocked(exchangeFanvueCode).mockResolvedValue({
      access_token: 'at-1',
      refresh_token: 'rt-1',
      expires_in: 3600,
      token_type: 'Bearer',
    } as never);
    vi.mocked(fetchFanvueProfile).mockResolvedValue({
      uuid: 'user-9',
      username: 'maker',
      displayName: 'Maker',
      email: 'maker@example.com',
      avatarUrl: 'https://cdn.fanvue.com/a.jpg',
      isCreator: true,
      createdAt: '2026-01-01T00:00:00.000Z',
    } as never);
  });

  function callbackRequest(query: string): NextRequest {
    return new NextRequest(`${CALLBACK}${query}`);
  }

  it('persists the account with the /users/me uuid and returns the success popup', async () => {
    const res = await callbackGET(callbackRequest('?code=c&state=s'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { type: string; data: { account: Record<string, unknown> } };
    expect(body.type).toBe('fanvue-oauth-success');
    expect(body.data.account).toMatchObject({ provider: 'fanvue', providerAccountId: 'user-9', accountName: 'Maker' });
    expect(exchangeFanvueCode).toHaveBeenCalledWith('c', 'verifier-1', 'https://app.example/cb');
    expect(fetchFanvueProfile).toHaveBeenCalledWith('at-1');
    expect(reportProfileFetched).toHaveBeenCalledWith('fanvue', 'connect', { accountName: 'Maker', pictureUrl: 'https://cdn.fanvue.com/a.jpg' });
    expect(upsertSocialAccount).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: 'user-1',
        provider: 'fanvue',
        providerAccountId: 'user-9',
        accountName: 'Maker',
        tokens: expect.objectContaining({ access_token: 'at-1', refresh_token: 'rt-1' }),
      }),
    );
  });

  it('returns the error popup when Fanvue reports an error', async () => {
    const res = await callbackGET(callbackRequest('?error=access_denied&state=s'));
    const body = (await res.json()) as { type: string; data: { error: string } };
    expect(body.type).toBe('fanvue-oauth-error');
    expect(body.data.error).toBe('Fanvue authorization was not completed.');
    expect(exchangeFanvueCode).not.toHaveBeenCalled();
  });

  it('returns the error popup without a code', async () => {
    const res = await callbackGET(callbackRequest('?state=s'));
    const body = (await res.json()) as { type: string; data: { error: string } };
    expect(body.type).toBe('fanvue-oauth-error');
    expect(body.data.error).toBe('Missing authorization code');
  });

  it('returns the error popup when the callback auth fails', async () => {
    vi.mocked(resolveOAuthCallbackAuth).mockResolvedValue({ ok: false, error: 'Invalid state' } as never);
    const res = await callbackGET(callbackRequest('?code=c&state=s'));
    const body = (await res.json()) as { type: string; data: { error: string } };
    expect(body.type).toBe('fanvue-oauth-error');
    expect(body.data.error).toBe('Invalid state');
    expect(exchangeFanvueCode).not.toHaveBeenCalled();
  });

  it('returns the error popup when the PKCE verifier did not survive from /start', async () => {
    vi.mocked(resolveOAuthCallbackAuth).mockResolvedValue({
      ok: true,
      userId: 'user-1',
      redirectUri: 'https://app.example/cb',
      viaMcp: false,
    } as never);
    const res = await callbackGET(callbackRequest('?code=c&state=s'));
    const body = (await res.json()) as { type: string; data: { error: string } };
    expect(body.type).toBe('fanvue-oauth-error');
    expect(body.data.error).toContain('could not be completed');
    expect(exchangeFanvueCode).not.toHaveBeenCalled();
    expect(upsertSocialAccount).not.toHaveBeenCalled();
  });

  it('returns the error popup and reports the failure when the exchange fails', async () => {
    vi.mocked(exchangeFanvueCode).mockRejectedValue(new Error('bad code'));
    const res = await callbackGET(callbackRequest('?code=c&state=s'));
    const body = (await res.json()) as { type: string; data: { error: string } };
    expect(body.type).toBe('fanvue-oauth-error');
    expect(body.data.error).toBe('Failed to connect the Fanvue account.');
    expect(reportProfileFetchFailed).toHaveBeenCalledWith('fanvue', 'connect', expect.any(Error));
    expect(upsertSocialAccount).not.toHaveBeenCalled();
  });
});
