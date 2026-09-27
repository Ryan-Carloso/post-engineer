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
        data: { user: overrides.user === null ? null : { id: USER_ID } },
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
    vi.mocked(fetchLinkedInMemberProfile).mockResolvedValueOnce({ id: 'member-123', name: 'Ryan C' });
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

  it('MCP flow: no session, consumes the state and persists with service client under the API key owner', async () => {
    mockSupabase({ user: null });
    vi.mocked(verifyOAuthNonce).mockReturnValue(false);
    // mocked decodeOAuthState returns provider 'linkedin', nonce 'nonce-1'
    const storedRow = {
      state_hash: 'hash-state-xyz',
      user_id: 'api-key-owner',
      provider: 'linkedin',
      nonce: 'nonce-1',
      redirect_uri: 'https://post-engineer.com/api/linkedin-auth/callback',
      expires_at: new Date(Date.now() + 600_000).toISOString(),
    };
    vi.mocked(createSupabaseServiceClient).mockReturnValue({
      from: vi.fn(() => ({
        delete: () => ({
          eq: () => ({
            gt: () => ({
              select: async () => ({ data: [storedRow], error: null }),
            }),
            lte: () => Promise.resolve({ error: null }),
          }),
        }),
      })),
    } as never);
    vi.mocked(exchangeLinkedInCodeForToken).mockResolvedValueOnce({ access_token: 'at-1', expires_in: 5_184_000 });
    vi.mocked(fetchLinkedInMemberProfile).mockResolvedValueOnce({ id: 'member-123', name: 'Ryan C' });
    vi.mocked(fetchLinkedInAdminOrganizations).mockResolvedValueOnce([]);
    vi.mocked(upsertSocialAccount).mockResolvedValue({ id: 'row-1' } as never);

    const url = 'http://localhost/api/linkedin-auth/callback?code=code-1&state=state-xyz';
    const res = await callbackGET(new Request(url) as never);
    const body = (await res.json()) as { popup: string };

    expect(body.popup).toBe('linkedin-oauth-success');
    // account persists under the API key owner, not the session (which does not exist)
    expect(vi.mocked(upsertSocialAccount).mock.calls[0][1]).toMatchObject({
      userId: 'api-key-owner',
      provider: 'linkedin',
      providerAccountId: 'member-123',
    });
    // without a browser session, persistence uses the service client
    expect(createSupabaseServiceClient).toHaveBeenCalled();
  });
});
