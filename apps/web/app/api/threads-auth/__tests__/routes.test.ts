// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/rate-limit', () => ({ applyRateLimit: vi.fn(async () => null), RATE_LIMITS: { oauthStart: {} } }));
vi.mock('@/lib/api-error-reporting', () => ({ withApiErrorReporting: (_route: string, handler: unknown) => handler }));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: vi.fn() }));
vi.mock('@/lib/supabase/service', () => ({ createSupabaseServiceClient: vi.fn(() => ({ __mock: 'service' })) }));
vi.mock('@/lib/logger', () => ({ logger: { generateLogId: vi.fn(() => 'log-1'), logOAuthError: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/oauth-connect', () => ({ resolveOAuthCallbackAuth: vi.fn() }));
vi.mock('@/lib/social-accounts', () => ({ upsertSocialAccount: vi.fn() }));
vi.mock('@/lib/threads', () => ({
  buildThreadsAuthorizationUrl: vi.fn(() => 'https://threads.net/oauth/authorize?x=1'),
  exchangeThreadsCodeForToken: vi.fn(),
  fetchThreadsProfile: vi.fn(),
}));
vi.mock('@/lib/oauth-utils', () => ({
  createOAuthState: vi.fn(() => ({ state: 's', nonce: 'n' })),
  resolveOAuthRedirectUri: vi.fn(() => 'https://app.example/cb'),
  setOAuthNonceCookie: vi.fn(),
  oauthPopupResponse: vi.fn((type: string, data: unknown) => Response.json({ type, data })),
}));

import { GET as startGET } from '@/app/api/threads-auth/start/route';
import { GET as callbackGET } from '@/app/api/threads-auth/callback/route';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { resolveOAuthCallbackAuth } from '@/lib/oauth-connect';
import { upsertSocialAccount } from '@/lib/social-accounts';
import { exchangeThreadsCodeForToken, fetchThreadsProfile } from '@/lib/threads';

const START = 'https://app.example/api/threads-auth/start';
const CALLBACK = 'https://app.example/api/threads-auth/callback';

function session(user: { id: string } | null): void {
  vi.mocked(createSupabaseServerClient).mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }) },
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('INSTAGRAM_CLIENT_ID', undefined);
  vi.stubEnv('INSTAGRAM_CLIENT_SECRET', undefined);
  vi.stubEnv('THREADS_CLIENT_ID', 'tcid');
  vi.stubEnv('THREADS_CLIENT_SECRET', 'tsecret');
  session({ id: 'user-1' });
});

describe('GET /api/threads-auth/start', () => {
  it('returns the authorization URL for a session', async () => {
    const response = await startGET(new NextRequest(START));
    expect(response.status).toBe(200);
    expect((await response.json()).auth_url).toContain('threads.net');
  });

  it('401s without a session', async () => {
    session(null);
    expect((await startGET(new NextRequest(START))).status).toBe(401);
  });

  it('500s when the Threads credentials are missing even with Instagram credentials set', async () => {
    vi.stubEnv('INSTAGRAM_CLIENT_ID', 'cid');
    vi.stubEnv('INSTAGRAM_CLIENT_SECRET', 'secret');
    vi.stubEnv('THREADS_CLIENT_SECRET', undefined);
    const response = await startGET(new NextRequest(START));
    expect(response.status).toBe(500);
    expect((await response.json()).error).toContain('THREADS_CLIENT_SECRET');
  });
});

describe('GET /api/threads-auth/callback', () => {
  it('persists the long-lived token under the callback owner', async () => {
    vi.mocked(resolveOAuthCallbackAuth).mockResolvedValue({ ok: true, userId: 'user-1', viaMcp: false, redirectUri: 'https://app.example/cb' });
    vi.mocked(exchangeThreadsCodeForToken).mockResolvedValue({ access_token: 'long', expires_in: 100 });
    vi.mocked(fetchThreadsProfile).mockResolvedValue({ id: '42', username: 'ana', profilePictureUrl: null });
    const body = await (await callbackGET(new NextRequest(`${CALLBACK}?code=c&state=s`))).json();
    expect(body.type).toBe('threads-oauth-success');
    expect(vi.mocked(upsertSocialAccount).mock.calls[0][1]).toMatchObject({
      userId: 'user-1', provider: 'threads', providerAccountId: '42', accountName: 'ana',
    });
    expect(JSON.stringify(body)).not.toContain('long');
  });

  it('binds the callback to the threads provider', async () => {
    vi.mocked(resolveOAuthCallbackAuth).mockResolvedValue({ ok: false, error: 'bad state', status: 400 });
    const body = await (await callbackGET(new NextRequest(`${CALLBACK}?code=c&state=s`))).json();
    expect(vi.mocked(resolveOAuthCallbackAuth).mock.calls[0][4]).toBe('threads');
    expect(body).toEqual({ type: 'threads-oauth-error', data: { error: 'bad state' } });
    expect(exchangeThreadsCodeForToken).not.toHaveBeenCalled();
  });

  it('does not reflect provider or upstream error text to the popup', async () => {
    const denied = await (await callbackGET(new NextRequest(`${CALLBACK}?error=<script>`))).json();
    expect(JSON.stringify(denied)).not.toContain('script');
    vi.mocked(resolveOAuthCallbackAuth).mockResolvedValue({ ok: true, userId: 'user-1', viaMcp: false });
    vi.mocked(exchangeThreadsCodeForToken).mockRejectedValue(new Error('upstream detail'));
    const failed = await (await callbackGET(new NextRequest(`${CALLBACK}?code=c&state=s`))).json();
    expect(failed.type).toBe('threads-oauth-error');
    expect(JSON.stringify(failed)).not.toContain('upstream detail');
  });
});
