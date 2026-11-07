// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
}));
vi.mock('@/lib/supabase/service', () => ({
  createSupabaseServiceClient: vi.fn(),
}));

import { NextResponse } from 'next/server';

vi.mock('@/lib/oauth-utils', () => ({
  createOAuthState: vi.fn(() => ({ state: 'state-xyz', nonce: 'nonce-1' })),
  resolveOAuthRedirectUri: vi.fn(() => 'https://post-engineer.com/api/linkedin-auth/callback'),
  setOAuthNonceCookie: vi.fn(),
  decodeOAuthState: vi.fn(() => ({ provider: 'linkedin', nonce: 'nonce-1' })),
  verifyOAuthNonce: vi.fn(() => true),
  oauthPopupResponse: vi.fn((type: string, data: Record<string, unknown>) =>
    NextResponse.json({ popup: type, ...data })),
}));

vi.mock('@/lib/linkedin', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/linkedin')>();
  return {
    ...actual,
    buildLinkedInAuthorizationUrl: vi.fn(() => 'https://www.linkedin.com/oauth/v2/authorization?x=1'),
    exchangeLinkedInCodeForToken: vi.fn(),
    fetchLinkedInMemberProfile: vi.fn(),
    fetchLinkedInAdminOrganizations: vi.fn(),
  };
});

vi.mock('@/lib/social-accounts', () => ({
  upsertSocialAccount: vi.fn(),
  touchSocialAccount: vi.fn(),
}));

import { GET as startGET } from '@/app/api/linkedin-auth/start/route';
import { GET as callbackGET } from '@/app/api/linkedin-auth/callback/route';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { hashOAuthState } from '@/lib/oauth-connect';
import { makeOAuthStateStore, type FakeOAuthStateStore } from '@/test/oauth-state-store';
import { verifyOAuthNonce } from '@/lib/oauth-utils';
import {
  exchangeLinkedInCodeForToken,
  fetchLinkedInMemberProfile,
  fetchLinkedInAdminOrganizations,
} from '@/lib/linkedin';
import { upsertSocialAccount } from '@/lib/social-accounts';

const USER_ID = 'user-uuid-1';

function mockSupabase(overrides: { user?: { id: string } | null } = {}) {
  const client = {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: overrides.user === undefined ? { id: USER_ID } : overrides.user },
        error: null,
      })),
    },
  };
  vi.mocked(createSupabaseServerClient).mockResolvedValue(client as never);
  return client;
}

describe('GET /api/linkedin-auth/start', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.LINKEDIN_CLIENT_ID = 'client-1';
    process.env.LINKEDIN_CLIENT_SECRET = 'secret-1';
    process.env.LINKEDIN_REDIRECT_URI = 'https://post-engineer.com/api/linkedin-auth/callback';
  });

  it('returns 401 without session', async () => {
    mockSupabase({ user: null });
    const res = await startGET();
    expect(res.status).toBe(401);
  });

  it('returns auth_url with session', async () => {
    mockSupabase();
    const res = await startGET();
    const body = (await res.json()) as { success: boolean; auth_url?: string };
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.auth_url).toContain('linkedin.com');
  });

  it('returns 500 without configured credentials', async () => {
    mockSupabase();
    delete process.env.LINKEDIN_CLIENT_ID;
    const res = await startGET();
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toContain('LINKEDIN_CLIENT_ID');
  });
});

describe('GET /api/linkedin-auth/callback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSupabase();
  });

  it('returns popup error when the provider returns error', async () => {
    const url = 'http://localhost/api/linkedin-auth/callback?error=user_cancelled';
    const res = await callbackGET(new Request(url) as never);
    const body = (await res.json()) as { popup: string };
    expect(body.popup).toBe('linkedin-oauth-error');
  });

  it('returns error when code is missing', async () => {
    const url = 'http://localhost/api/linkedin-auth/callback?state=s';
    const res = await callbackGET(new Request(url) as never);
    const body = (await res.json()) as { popup: string };
    expect(body.popup).toBe('linkedin-oauth-error');
  });

  it('success: saves member account AND each admin organization as separate accounts', async () => {
    vi.mocked(exchangeLinkedInCodeForToken).mockResolvedValueOnce({ access_token: 'at-1', expires_in: 5_184_000 });
    vi.mocked(fetchLinkedInMemberProfile).mockResolvedValueOnce({ id: 'member-123', name: 'Ryan C', picture: 'https://media.licdn.com/p.jpg' });
    vi.mocked(fetchLinkedInAdminOrganizations).mockResolvedValueOnce([
      { id: 'urn:li:organization:111', name: 'Page Um' },
      { id: 'urn:li:organization:222', name: null },
    ]);
    vi.mocked(upsertSocialAccount).mockResolvedValue({ id: 'row-1' } as never);

    const url = 'http://localhost/api/linkedin-auth/callback?code=code-1&state=state-xyz';
    const res = await callbackGET(new Request(url) as never);
    const body = (await res.json()) as { popup: string };

    expect(body.popup).toBe('linkedin-oauth-success');
    // member + 2 organizations = 3 accounts
    expect(upsertSocialAccount).toHaveBeenCalledTimes(3);

    const calls = vi.mocked(upsertSocialAccount).mock.calls;
    expect(calls[0][1]).toMatchObject({
      userId: USER_ID,
      provider: 'linkedin',
      providerAccountId: 'member-123',
      accountName: 'Ryan C',
    });
    expect(calls[1][1]).toMatchObject({
      provider: 'linkedin',
      providerAccountId: 'urn:li:organization:111',
      accountName: 'Page Um',
    });
    expect(calls[2][1]).toMatchObject({
      providerAccountId: 'urn:li:organization:222',
      accountName: null,
    });
    // encrypted token propagated to all of them
    for (const call of calls) {
      expect(call[1].tokens.access_token).toBe('at-1');
      expect(call[1].tokens.member_urn).toBe('urn:li:person:member-123');
    }
  });

  it('failing token exchange becomes an error popup (not 500 HTML)', async () => {
    vi.mocked(exchangeLinkedInCodeForToken).mockRejectedValueOnce(
      Object.assign(new Error('LINKEDIN_TOKEN_FAILED: code expired'), { name: 'LinkedInError' }),
    );
    const url = 'http://localhost/api/linkedin-auth/callback?code=c&state=state-xyz';
    const res = await callbackGET(new Request(url) as never);
    const body = (await res.json()) as { popup: string; error?: string };
    expect(body.popup).toBe('linkedin-oauth-error');
  });

  // Connect-url (MCP) flow: the service client only serves oauth_states,
  // backed by the shared fake that applies every filter of the real chain.
  // The mocked decodeOAuthState yields provider 'linkedin', nonce 'nonce-1'.
  function connectUrlState(ownerId: string): { store: FakeOAuthStateStore; hash: string } {
    const store = makeOAuthStateStore();
    const hash = hashOAuthState('state-xyz');
    store.rows.set(hash, {
      state_hash: hash,
      user_id: ownerId,
      provider: 'linkedin',
      nonce: 'nonce-1',
      redirect_uri: 'https://post-engineer.com/api/linkedin-auth/callback',
      expires_at: new Date(Date.now() + 600_000).toISOString(),
    });
    vi.mocked(createSupabaseServiceClient).mockReturnValue(store as never);
    return { store, hash };
  }

  const CONNECT_URL_CALLBACK = 'http://localhost/api/linkedin-auth/callback?code=code-1&state=state-xyz';

  it('MCP flow: the signed-in owner consumes the state and persists with the session client', async () => {
    const sessionClient = mockSupabase({ user: { id: 'api-key-owner' } });
    vi.mocked(verifyOAuthNonce).mockReturnValue(false);
    const { store, hash } = connectUrlState('api-key-owner');
    vi.mocked(exchangeLinkedInCodeForToken).mockResolvedValueOnce({ access_token: 'at-1', expires_in: 5_184_000 });
    vi.mocked(fetchLinkedInMemberProfile).mockResolvedValueOnce({ id: 'member-123', name: 'Ryan C', picture: 'https://media.licdn.com/p.jpg' });
    vi.mocked(fetchLinkedInAdminOrganizations).mockResolvedValueOnce([]);
    vi.mocked(upsertSocialAccount).mockResolvedValue({ id: 'row-1' } as never);

    const res = await callbackGET(new Request(CONNECT_URL_CALLBACK) as never);
    const body = (await res.json()) as { popup: string };

    expect(body.popup).toBe('linkedin-oauth-success');
    expect(store.rows.has(hash)).toBe(false);
    // persisted under the signed-in owner through the RLS-bound session client
    expect(vi.mocked(upsertSocialAccount).mock.calls[0][0]).toBe(sessionClient);
    expect(vi.mocked(upsertSocialAccount).mock.calls[0][1]).toMatchObject({
      userId: 'api-key-owner',
      provider: 'linkedin',
      providerAccountId: 'member-123',
    });
    // the service role only ever touched oauth_states
    expect(store.tables).toEqual(['oauth_states']);
  });

  it('MCP flow: another signed-in user cannot complete the owner connect URL', async () => {
    mockSupabase({ user: { id: 'victim-session-user' } });
    vi.mocked(verifyOAuthNonce).mockReturnValue(false);
    const { store, hash } = connectUrlState('attacker-user');
    const res = await callbackGET(new Request(CONNECT_URL_CALLBACK) as never);
    const body = (await res.json()) as { popup: string; error?: string };
    expect(body).toMatchObject({ popup: 'linkedin-oauth-error', error: 'Invalid or expired OAuth state.' });
    expect(exchangeLinkedInCodeForToken).not.toHaveBeenCalled();
    expect(upsertSocialAccount).not.toHaveBeenCalled();
    expect(store.rows.has(hash)).toBe(true);
  });

  it('MCP flow: a browser without a session cannot complete the connect URL', async () => {
    mockSupabase({ user: null });
    vi.mocked(verifyOAuthNonce).mockReturnValue(false);
    const { store, hash } = connectUrlState('api-key-owner');
    const res = await callbackGET(new Request(CONNECT_URL_CALLBACK) as never);
    const body = (await res.json()) as { popup: string; error?: string };
    expect(body).toMatchObject({ popup: 'linkedin-oauth-error', error: 'Authentication required. Please log in.' });
    expect(exchangeLinkedInCodeForToken).not.toHaveBeenCalled();
    expect(upsertSocialAccount).not.toHaveBeenCalled();
    expect(store.rows.has(hash)).toBe(true);
  });
});
