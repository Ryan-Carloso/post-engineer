// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/rate-limit', () => ({ applyRateLimit: vi.fn(async () => null), RATE_LIMITS: { oauthStart: {} } }));
vi.mock('@/lib/api-error-reporting', () => ({ withApiErrorReporting: (_route: string, handler: unknown) => handler, markApiErrorReported: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: vi.fn() }));
vi.mock('@/lib/supabase/service', () => ({ createSupabaseServiceClient: vi.fn(() => ({ __mock: 'service' })) }));
vi.mock('@/lib/logger', () => ({ logger: { generateLogId: vi.fn(() => 'log-1'), logOAuthError: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/account-profile-telemetry', () => ({ reportProfileFetched: vi.fn(), reportProfileFetchFailed: vi.fn() }));
vi.mock('@/lib/oauth-connect', () => ({ resolveOAuthCallbackAuth: vi.fn() }));
vi.mock('@/lib/social-accounts', () => ({ upsertSocialAccount: vi.fn() }));
vi.mock('@/lib/facebook', () => ({
  buildFacebookAuthorizationUrl: vi.fn(() => 'https://www.facebook.com/v23.0/dialog/oauth?x=1'),
  exchangeFacebookCodeForToken: vi.fn(),
  fetchFacebookPages: vi.fn(),
}));
vi.mock('@/lib/oauth-utils', () => ({
  createOAuthState: vi.fn(() => ({ state: 's', nonce: 'n' })),
  resolveOAuthRedirectUri: vi.fn(() => 'https://app.example/cb'),
  setOAuthNonceCookie: vi.fn(),
  oauthPopupResponse: vi.fn((type: string, data: unknown) => Response.json({ type, data })),
}));

import { GET as startGET } from '@/app/api/facebook-auth/start/route';
import { GET as callbackGET } from '@/app/api/facebook-auth/callback/route';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { resolveOAuthCallbackAuth } from '@/lib/oauth-connect';
import { upsertSocialAccount } from '@/lib/social-accounts';
import { buildFacebookAuthorizationUrl, exchangeFacebookCodeForToken, fetchFacebookPages } from '@/lib/facebook';
import { createOAuthState, resolveOAuthRedirectUri, setOAuthNonceCookie } from '@/lib/oauth-utils';
import { applyRateLimit } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';
import { markApiErrorReported } from '@/lib/api-error-reporting';
import { reportProfileFetched, reportProfileFetchFailed } from '@/lib/account-profile-telemetry';

const START = 'https://app.example/api/facebook-auth/start';
const CALLBACK = 'https://app.example/api/facebook-auth/callback';

const PAGES = [
  { id: '111', name: 'Page One', category: 'Media', pictureUrl: 'https://scontent.xx.fbcdn.net/1.jpg', followersCount: 5, pageAccessToken: 'ptok-111' },
  { id: '222', name: null, category: null, pictureUrl: null, followersCount: null, pageAccessToken: 'ptok-222' },
];

function session(user: { id: string } | null): void {
  vi.mocked(createSupabaseServerClient).mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }) },
  } as never);
}

function ownerAuth(): void {
  vi.mocked(resolveOAuthCallbackAuth).mockResolvedValue({ ok: true, userId: 'user-1', viaMcp: false, redirectUri: 'https://app.example/cb' });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('FACEBOOK_CLIENT_ID', 'fb-cid');
  vi.stubEnv('FACEBOOK_CLIENT_SECRET', 'fb-secret');
  session({ id: 'user-1' });
});

describe('GET /api/facebook-auth/start', () => {
  it('returns the authorization URL for a session and sets the nonce cookie', async () => {
    const response = await startGET(new NextRequest(START));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      message: 'Authorization URL generated',
      auth_url: 'https://www.facebook.com/v23.0/dialog/oauth?x=1',
    });
    expect(resolveOAuthRedirectUri).toHaveBeenCalledWith(expect.anything(), 'FACEBOOK_REDIRECT_URI_LOCAL', 'FACEBOOK_REDIRECT_URI');
    expect(createOAuthState).toHaveBeenCalledWith({ provider: 'facebook', redirectUri: 'https://app.example/cb' });
    expect(buildFacebookAuthorizationUrl).toHaveBeenCalledWith('s', 'https://app.example/cb');
    expect(setOAuthNonceCookie).toHaveBeenCalledWith(expect.anything(), 'n');
  });

  it('returns the rate limiter response before any other work', async () => {
    vi.mocked(applyRateLimit).mockResolvedValueOnce(new Response('slow down', { status: 429 }) as never);
    const response = await startGET(new NextRequest(START));
    expect(response.status).toBe(429);
    expect(buildFacebookAuthorizationUrl).not.toHaveBeenCalled();
  });

  it('401s without a session', async () => {
    session(null);
    const response = await startGET(new NextRequest(START));
    expect(response.status).toBe(401);
    expect(buildFacebookAuthorizationUrl).not.toHaveBeenCalled();
  });

  it.each(['FACEBOOK_CLIENT_ID', 'FACEBOOK_CLIENT_SECRET'])('500s naming the credentials when %s is missing', async (name) => {
    vi.stubEnv(name, undefined);
    const response = await startGET(new NextRequest(START));
    expect(response.status).toBe(500);
    expect((await response.json()).error).toContain('FACEBOOK_CLIENT_SECRET');
    // The missing-credentials cause is logged so PostHog shows the reason
    // instead of only the wrapper's generic "[route] 500", and the response
    // is marked so the wrapper does not report a second synthetic exception.
    expect(logger.logOAuthError).toHaveBeenCalledWith(
      'log-1',
      expect.objectContaining({ message: expect.stringContaining('FACEBOOK_CLIENT_ID') }),
    );
    expect(markApiErrorReported).toHaveBeenCalledWith(response);
  });

  it('returns a generic 500 and logs the detail when building the URL throws', async () => {
    vi.mocked(buildFacebookAuthorizationUrl).mockImplementationOnce(() => {
      throw new Error('FACEBOOK_ENV_MISSING: FACEBOOK_REDIRECT_URI is not defined');
    });
    const response = await startGET(new NextRequest(START));
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({ success: false, error: 'Failed to generate the authorization URL.' });
    expect(logger.logOAuthError).toHaveBeenCalledWith('log-1', expect.objectContaining({ message: expect.stringContaining('FACEBOOK_REDIRECT_URI') }));
  });
});

describe('GET /api/facebook-auth/callback', () => {
  it('persists every managed Page as its own account with its Page token and no expiry', async () => {
    ownerAuth();
    vi.mocked(exchangeFacebookCodeForToken).mockResolvedValue('user-long-tok');
    vi.mocked(fetchFacebookPages).mockResolvedValue(PAGES);

    const body = await (await callbackGET(new NextRequest(`${CALLBACK}?code=c&state=s`))).json();

    expect(body.type).toBe('facebook-oauth-success');
    expect(body.data.account.pages).toEqual([
      { providerAccountId: '111', accountName: 'Page One' },
      { providerAccountId: '222', accountName: null },
    ]);
    expect(exchangeFacebookCodeForToken).toHaveBeenCalledWith('c', 'https://app.example/cb');
    expect(fetchFacebookPages).toHaveBeenCalledWith('user-long-tok');
    expect(upsertSocialAccount).toHaveBeenCalledTimes(2);
    expect(vi.mocked(upsertSocialAccount).mock.calls[0][1]).toMatchObject({
      userId: 'user-1',
      provider: 'facebook',
      providerAccountId: '111',
      accountName: 'Page One',
      accountMetadata: { name: 'Page One', category: 'Media', profilePictureUrl: 'https://scontent.xx.fbcdn.net/1.jpg', followersCount: 5 },
      tokens: { access_token: 'ptok-111', token_type: 'bearer' },
      tokenExpiresAt: null,
    });
    expect(vi.mocked(upsertSocialAccount).mock.calls[1][1]).toMatchObject({
      providerAccountId: '222',
      accountName: null,
      tokens: { access_token: 'ptok-222' },
    });
    expect(vi.mocked(upsertSocialAccount).mock.calls[1][1].accountMetadata).toHaveProperty('followersCount', undefined);
    expect(reportProfileFetched).toHaveBeenCalledTimes(2);
    // Neither the user token nor a Page token reaches the popup.
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('user-long-tok');
    expect(serialized).not.toContain('ptok-');
  });

  it('reports an account that manages no Page instead of connecting nothing silently', async () => {
    ownerAuth();
    vi.mocked(exchangeFacebookCodeForToken).mockResolvedValue('user-long-tok');
    vi.mocked(fetchFacebookPages).mockResolvedValue([]);
    const body = await (await callbackGET(new NextRequest(`${CALLBACK}?code=c&state=s`))).json();
    expect(body.type).toBe('facebook-oauth-error');
    expect(body.data.error).toContain('No Facebook Pages');
    expect(upsertSocialAccount).not.toHaveBeenCalled();
  });

  it('binds the callback to the facebook provider and stops on a bad state', async () => {
    vi.mocked(resolveOAuthCallbackAuth).mockResolvedValue({ ok: false, error: 'bad state', status: 400 });
    const body = await (await callbackGET(new NextRequest(`${CALLBACK}?code=c&state=s`))).json();
    expect(vi.mocked(resolveOAuthCallbackAuth).mock.calls[0][4]).toBe('facebook');
    expect(body).toEqual({ type: 'facebook-oauth-error', data: { error: 'bad state' } });
    expect(exchangeFacebookCodeForToken).not.toHaveBeenCalled();
  });

  it('rejects a callback without a code', async () => {
    const body = await (await callbackGET(new NextRequest(`${CALLBACK}?state=s`))).json();
    expect(body).toEqual({ type: 'facebook-oauth-error', data: { error: 'Missing authorization code' } });
    expect(resolveOAuthCallbackAuth).not.toHaveBeenCalled();
  });

  it('does not reflect provider or upstream error text to the popup, and logs the failure', async () => {
    const denied = await (await callbackGET(new NextRequest(`${CALLBACK}?error=<script>`))).json();
    expect(denied.type).toBe('facebook-oauth-error');
    expect(JSON.stringify(denied)).not.toContain('script');

    ownerAuth();
    const upstream = new Error('FACEBOOK_TOKEN_FAILED: upstream detail');
    vi.mocked(exchangeFacebookCodeForToken).mockRejectedValue(upstream);
    const failed = await (await callbackGET(new NextRequest(`${CALLBACK}?code=c&state=s`))).json();
    expect(failed).toEqual({ type: 'facebook-oauth-error', data: { error: 'Failed to connect the Facebook Page.' } });
    expect(reportProfileFetchFailed).toHaveBeenCalledWith('facebook', 'connect', upstream);
    expect(logger.error).toHaveBeenCalledWith('[facebook-auth/callback] connect failed', upstream);
  });
});
