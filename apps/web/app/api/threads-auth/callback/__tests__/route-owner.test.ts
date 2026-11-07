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
vi.mock('@/lib/account-profile-telemetry', () => ({ reportProfileFetched: vi.fn() }));
vi.mock('@/lib/social-accounts', () => ({ upsertSocialAccount: vi.fn() }));
vi.mock('@/lib/threads', () => ({
  exchangeThreadsCodeForToken: vi.fn(),
  fetchThreadsProfile: vi.fn(),
}));
vi.mock('@/lib/oauth-utils', () => ({
  // the browser carries no nonce cookie for this state: connect-url flow
  decodeOAuthState: vi.fn(() => ({ provider: 'threads', nonce: 'n', redirectUri: 'https://app.example/cb' })),
  verifyOAuthNonce: vi.fn(() => false),
  oauthPopupResponse: vi.fn((type: string, data: unknown) => Response.json({ type, data })),
}));

import { GET as callbackGET } from '@/app/api/threads-auth/callback/route';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { hashOAuthState } from '@/lib/oauth-connect';
import { upsertSocialAccount } from '@/lib/social-accounts';
import { exchangeThreadsCodeForToken, fetchThreadsProfile } from '@/lib/threads';
import { makeOAuthStateStore, type FakeOAuthStateStore } from '@/test/oauth-state-store';

const CALLBACK = 'https://app.example/api/threads-auth/callback?code=c&state=s';

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
    provider: 'threads',
    nonce: 'n',
    redirect_uri: 'https://app.example/cb',
    expires_at: new Date(Date.now() + 600_000).toISOString(),
  });
  vi.mocked(createSupabaseServiceClient).mockReturnValue(store as never);
  return { store, hash };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(exchangeThreadsCodeForToken).mockResolvedValue({ access_token: 'long', expires_in: 100 });
  vi.mocked(fetchThreadsProfile).mockResolvedValue({ id: '42', username: 'ana', profilePictureUrl: null });
});

describe('GET /api/threads-auth/callback — connect-url owner binding', () => {
  it('the signed-in owner consumes the state and persists with the session client', async () => {
    const sessionClient = sessionAs('owner-user');
    const { store, hash } = connectUrlState('owner-user');
    const body = await (await callbackGET(new NextRequest(CALLBACK))).json();
    expect(body.type).toBe('threads-oauth-success');
    expect(store.rows.has(hash)).toBe(false);
    expect(vi.mocked(upsertSocialAccount).mock.calls[0][0]).toBe(sessionClient);
    expect(vi.mocked(upsertSocialAccount).mock.calls[0][1]).toMatchObject({
      userId: 'owner-user',
      provider: 'threads',
      providerAccountId: '42',
    });
    // the service role only ever touched oauth_states
    expect(store.tables).toEqual(['oauth_states']);
  });

  it('another signed-in user cannot complete the owner connect URL', async () => {
    sessionAs('victim-session-user');
    const { store, hash } = connectUrlState('attacker-user');
    const body = await (await callbackGET(new NextRequest(CALLBACK))).json();
    expect(body).toEqual({ type: 'threads-oauth-error', data: { error: 'Invalid or expired OAuth state.' } });
    expect(exchangeThreadsCodeForToken).not.toHaveBeenCalled();
    expect(upsertSocialAccount).not.toHaveBeenCalled();
    expect(store.rows.has(hash)).toBe(true);
  });

  it('a browser without a session cannot complete the connect URL', async () => {
    sessionAs(null);
    const { store, hash } = connectUrlState('owner-user');
    const body = await (await callbackGET(new NextRequest(CALLBACK))).json();
    expect(body).toEqual({ type: 'threads-oauth-error', data: { error: 'Authentication required. Please log in.' } });
    expect(exchangeThreadsCodeForToken).not.toHaveBeenCalled();
    expect(upsertSocialAccount).not.toHaveBeenCalled();
    expect(store.rows.has(hash)).toBe(true);
  });
});
