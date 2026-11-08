// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Connect-url (MCP) flow against the real resolveOAuthCallbackAuth: only the
// framework, the provider client and the persistence sink are mocked.
vi.mock('@/lib/api-error-reporting', () => ({ withApiErrorReporting: (_route: string, handler: unknown) => handler }));
vi.mock('@/lib/supabase/server', () => ({ createSupabaseServerClient: vi.fn() }));
vi.mock('@/lib/supabase/service', () => ({ createSupabaseServiceClient: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/account-profile-telemetry', () => ({ reportProfileFetched: vi.fn(), reportProfileFetchFailed: vi.fn() }));
vi.mock('@/lib/social-accounts', () => ({ upsertSocialAccount: vi.fn() }));
vi.mock('@/lib/facebook', () => ({
  exchangeFacebookCodeForToken: vi.fn(),
  fetchFacebookPages: vi.fn(),
}));
vi.mock('@/lib/oauth-utils', () => ({
  // the browser carries no nonce cookie for this state: connect-url flow
  decodeOAuthState: vi.fn(() => ({ provider: 'facebook', nonce: 'n', redirectUri: 'https://app.example/cb' })),
  verifyOAuthNonce: vi.fn(() => false),
  oauthPopupResponse: vi.fn((type: string, data: unknown) => Response.json({ type, data })),
}));

import { GET as callbackGET } from '@/app/api/facebook-auth/callback/route';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { hashOAuthState } from '@/lib/oauth-connect';
import { upsertSocialAccount } from '@/lib/social-accounts';
import { exchangeFacebookCodeForToken, fetchFacebookPages } from '@/lib/facebook';
import { makeOAuthStateStore, type FakeOAuthStateStore } from '@/test/oauth-state-store';

const CALLBACK = 'https://app.example/api/facebook-auth/callback?code=c&state=s';

function sessionAs(userId: string | null): object {
  const client = {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: userId === null ? null : { id: userId } }, error: null }),
    },
  };
  vi.mocked(createSupabaseServerClient).mockResolvedValue(client as never);
  return client;
}

function connectUrlState(ownerId: string): { store: FakeOAuthStateStore; hash: string } {
  const store = makeOAuthStateStore();
  const hash = hashOAuthState('s');
  store.rows.set(hash, {
    state_hash: hash,
    user_id: ownerId,
    provider: 'facebook',
    nonce: 'n',
    redirect_uri: 'https://app.example/cb',
    expires_at: new Date(Date.now() + 600_000).toISOString(),
  });
  vi.mocked(createSupabaseServiceClient).mockReturnValue(store as never);
  return { store, hash };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(exchangeFacebookCodeForToken).mockResolvedValue('long');
  vi.mocked(fetchFacebookPages).mockResolvedValue([
    { id: '42', name: 'Ana Page', category: null, pictureUrl: null, followersCount: null, pageAccessToken: 'ptok' },
  ]);
});

describe('GET /api/facebook-auth/callback — connect-url owner binding', () => {
  it('the signed-in owner consumes the state and persists with the session client', async () => {
    const sessionClient = sessionAs('owner-user');
    const { store, hash } = connectUrlState('owner-user');
    const body = await (await callbackGET(new NextRequest(CALLBACK))).json();
    expect(body.type).toBe('facebook-oauth-success');
    expect(store.rows.has(hash)).toBe(false);
    expect(vi.mocked(upsertSocialAccount).mock.calls[0][0]).toBe(sessionClient);
    expect(vi.mocked(upsertSocialAccount).mock.calls[0][1]).toMatchObject({
      userId: 'owner-user',
      provider: 'facebook',
      providerAccountId: '42',
    });
    // the service role only ever touched oauth_states
    expect(store.tables).toEqual(['oauth_states']);
  });

  it('another signed-in user cannot complete the owner connect URL', async () => {
    sessionAs('victim-session-user');
    const { store, hash } = connectUrlState('attacker-user');
    const body = await (await callbackGET(new NextRequest(CALLBACK))).json();
    expect(body).toEqual({ type: 'facebook-oauth-error', data: { error: 'Invalid or expired OAuth state.' } });
    expect(exchangeFacebookCodeForToken).not.toHaveBeenCalled();
    expect(upsertSocialAccount).not.toHaveBeenCalled();
    expect(store.rows.has(hash)).toBe(true);
  });

  it('a browser without a session cannot complete the connect URL', async () => {
    sessionAs(null);
    const { store, hash } = connectUrlState('owner-user');
    const body = await (await callbackGET(new NextRequest(CALLBACK))).json();
    expect(body).toEqual({ type: 'facebook-oauth-error', data: { error: 'Authentication required. Please log in.' } });
    expect(exchangeFacebookCodeForToken).not.toHaveBeenCalled();
    expect(upsertSocialAccount).not.toHaveBeenCalled();
    expect(store.rows.has(hash)).toBe(true);
  });
});
