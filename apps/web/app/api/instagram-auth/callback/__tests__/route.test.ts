import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
}));
vi.mock('@/lib/supabase/service', () => ({
  createSupabaseServiceClient: vi.fn(),
}));
vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    generateLogId: vi.fn(() => 'test-log-id'),
  },
}));
vi.mock('@/lib/social-accounts', () => ({
  upsertSocialAccount: vi.fn(),
  touchSocialAccount: vi.fn(),
}));
vi.mock('@/lib/oauth-utils', () => ({
  decodeOAuthState: vi.fn(),
  verifyOAuthNonce: vi.fn(),
  oauthPopupResponse: vi.fn(() => new Response('popup')),
}));
const exchangeCodeForLongLivedToken = vi.fn();
const getProfile = vi.fn();
vi.mock('@/lib/instagram', () => ({
  InstagramService: vi.fn().mockImplementation(() => ({
    exchangeCodeForLongLivedToken,
    getProfile,
  })),
}));

import { GET } from '@/app/api/instagram-auth/callback/route';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { decodeOAuthState, verifyOAuthNonce, oauthPopupResponse } from '@/lib/oauth-utils';
import { upsertSocialAccount } from '@/lib/social-accounts';
import { InstagramService } from '@/lib/instagram';
import { logger } from '@/lib/logger';

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

function serviceKeyMock(ok: boolean): void {
  vi.mocked(createSupabaseServiceClient).mockReturnValue({
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue(
        ok
          ? { data: { id: 'key-1' }, error: null }
          : { data: null, error: { message: 'not found' } },
      ),
    })),
  } as never);
}

function makeRequest(query: string): NextRequest {
  return new NextRequest(`http://localhost/api/instagram-auth/callback${query}`);
}

// Fake service client for the MCP flow: oauth_states returns the row
// stored in the atomic DELETE; the rest of the client is untouched because
// upsertSocialAccount/touchSocialAccount are mocked.
function oauthStateStoreMock(row: Record<string, string>): void {
  vi.mocked(createSupabaseServiceClient).mockReturnValue({
    from: vi.fn(() => ({
      delete: () => ({
        eq: () => ({
          gt: () => ({
            select: async () => ({ data: [row], error: null }),
          }),
          lte: () => Promise.resolve({ error: null }),
        }),
      }),
    })),
  } as never);
}

describe('/api/instagram-auth/callback', () => {
  const envBackup = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.INSTAGRAM_REDIRECT_URI =
      'https://post-engineer.com/api/instagram-auth/callback';
    process.env.INSTAGRAM_REDIRECT_URI_LOCAL =
      'http://localhost:3434/api/instagram-auth/callback';
    vi.mocked(InstagramService).mockImplementation(
      function () {
        return { exchangeCodeForLongLivedToken, getProfile } as never;
      },
    );
    vi.mocked(verifyOAuthNonce).mockReturnValue(true);
    vi.mocked(decodeOAuthState).mockReturnValue({
      api_key_id: 'key-1',
      provider: 'instagram',
      nonce: 'n',
    } as never);
    vi.mocked(oauthPopupResponse).mockReturnValue(new Response('popup') as never);
  });

  afterEach(() => {
    process.env = { ...envBackup };
  });

  it('returns error popup on oauth error param', async () => {
    const res = await GET(makeRequest('?error=access_denied&error_description=nope'));
    expect(await res.text()).toBe('popup');
    expect(oauthPopupResponse).toHaveBeenCalledWith(
      'instagram-oauth-error',
      expect.objectContaining({ error: expect.stringContaining('access_denied') }),
    );
  });

  it('returns error popup when code missing', async () => {
    await GET(makeRequest('?'));
    expect(oauthPopupResponse).toHaveBeenCalledWith(
      'instagram-oauth-error',
      expect.objectContaining({ error: 'Missing authorization code' }),
    );
  });

  it('returns error popup when not logged in', async () => {
    sessionMock(false);
    await GET(makeRequest('?code=c'));
    expect(oauthPopupResponse).toHaveBeenCalledWith(
      'instagram-oauth-error',
      expect.objectContaining({ error: expect.stringContaining('Authentication required') }),
    );
  });

  it('returns error popup when nonce invalid', async () => {
    sessionMock(true);
    vi.mocked(verifyOAuthNonce).mockReturnValue(false);
    await GET(makeRequest('?code=c&state=s'));
    expect(oauthPopupResponse).toHaveBeenCalledWith(
      'instagram-oauth-error',
      expect.objectContaining({ error: expect.stringContaining('Invalid or expired') }),
    );
  });

  it('returns error popup when constructor throws', async () => {
    sessionMock(true);
    serviceKeyMock(true);
    vi.mocked(InstagramService).mockImplementation(() => {
      throw new Error('missing env');
    });
    await GET(makeRequest('?code=c&state=s'));
    expect(oauthPopupResponse).toHaveBeenCalledWith(
      'instagram-oauth-error',
      expect.objectContaining({ error: expect.stringContaining('Instagram credentials not configured') }),
    );
  });

  it('returns error popup when the state redirect_uri is not a registered Meta callback', async () => {
    sessionMock(true);
    vi.mocked(decodeOAuthState).mockReturnValue({
      provider: 'instagram',
      nonce: 'n',
      redirectUri: 'https://evil.example.com/callback',
    } as never);
    await GET(makeRequest('?code=c&state=s'));
    expect(oauthPopupResponse).toHaveBeenCalledWith(
      'instagram-oauth-error',
      expect.objectContaining({ error: expect.stringContaining('redirect') }),
    );
    // the code exchange never happens with an invalid redirect_uri
    expect(exchangeCodeForLongLivedToken).not.toHaveBeenCalled();
  });

  it('returns error popup when token exchange fails', async () => {
    sessionMock(true);
    serviceKeyMock(true);
    exchangeCodeForLongLivedToken.mockRejectedValue(new Error('bad code'));
    await GET(makeRequest('?code=c&state=s'));
    expect(oauthPopupResponse).toHaveBeenCalledWith(
      'instagram-oauth-error',
      expect.objectContaining({ error: 'Failed to obtain Instagram token: bad code' }),
    );
  });

  it('returns error popup when profile fetch fails', async () => {
    sessionMock(true);
    serviceKeyMock(true);
    exchangeCodeForLongLivedToken.mockResolvedValue({
      accessToken: 'at',
      expiresIn: 1000,
      tokenType: 'Bearer',
    });
    getProfile.mockRejectedValue(new Error('no profile'));
    await GET(makeRequest('?code=c&state=s'));
    expect(oauthPopupResponse).toHaveBeenCalledWith(
      'instagram-oauth-error',
      expect.objectContaining({ error: 'Failed to fetch Instagram profile: no profile' }),
    );
  });

  it('persists account and returns success popup', async () => {
    sessionMock(true);
    serviceKeyMock(true);
    exchangeCodeForLongLivedToken.mockResolvedValue({
      accessToken: 'at',
      expiresIn: 1000,
      tokenType: 'Bearer',
    });
    getProfile.mockResolvedValue({
      userdId: 'ig-1',
      username: 'user',
      name: 'Name',
      profilePictureUrl: 'https://p.jpg',
      followersCount: 5,
      mediaCount: 2,
    });
    const res = await GET(makeRequest('?code=c&state=s'));
    expect(await res.text()).toBe('popup');
    expect(upsertSocialAccount).toHaveBeenCalledTimes(1);
    expect(oauthPopupResponse).toHaveBeenCalledWith(
      'instagram-oauth-success',
      expect.objectContaining({ account: expect.objectContaining({ igUserId: 'ig-1' }) }),
    );
  });

  it('returns error popup when database save fails', async () => {
    sessionMock(true);
    serviceKeyMock(true);
    exchangeCodeForLongLivedToken.mockResolvedValue({
      accessToken: 'at',
      expiresIn: 1000,
      tokenType: 'Bearer',
    });
    getProfile.mockResolvedValue({
      userdId: 'ig-1',
      username: 'user',
      name: 'Name',
      profilePictureUrl: 'https://p.jpg',
      followersCount: 5,
      mediaCount: 2,
    });
    vi.mocked(upsertSocialAccount).mockRejectedValue(new Error('db down'));
    await GET(makeRequest('?code=c&state=s'));
    expect(oauthPopupResponse).toHaveBeenCalledWith(
      'instagram-oauth-error',
      expect.objectContaining({ error: 'Failed to save account to database: db down' }),
    );
  });

  it('MCP flow: no session, consumes the state and persists with service client under the API key owner', async () => {
    sessionMock(false);
    vi.mocked(verifyOAuthNonce).mockReturnValue(false);
    // mocked decodeOAuthState (beforeEach) returns provider 'instagram', nonce 'n'
    oauthStateStoreMock({
      state_hash: 'hash-s',
      user_id: 'api-key-owner',
      provider: 'instagram',
      nonce: 'n',
      redirect_uri: 'https://post-engineer.com/api/instagram-auth/callback',
      expires_at: new Date(Date.now() + 600_000).toISOString(),
    });
    exchangeCodeForLongLivedToken.mockResolvedValue({
      accessToken: 'at',
      expiresIn: 1000,
      tokenType: 'Bearer',
    });
    getProfile.mockResolvedValue({
      userdId: 'ig-1',
      username: 'user',
      name: 'Name',
      profilePictureUrl: 'https://p.jpg',
      followersCount: 5,
      mediaCount: 2,
    });
    // the previous test sets mockRejectedValue; clearAllMocks does not reset the implementation
    vi.mocked(upsertSocialAccount).mockResolvedValue({} as never);
    const res = await GET(makeRequest('?code=c&state=s'));
    expect(await res.text()).toBe('popup');
    expect(oauthPopupResponse).toHaveBeenCalledWith(
      'instagram-oauth-success',
      expect.objectContaining({ account: expect.objectContaining({ igUserId: 'ig-1' }) }),
    );
    // account persists under the API key owner, not the session (which does not exist)
    expect(upsertSocialAccount).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ userId: 'api-key-owner', provider: 'instagram' }),
    );
    // without a browser session, persistence uses the service client
    expect(createSupabaseServiceClient).toHaveBeenCalled();
  });
});

describe('instagram callback logging', () => {
  // Self-contained setup: this describe is a sibling of the outer suite, so the
  // outer beforeEach (env vars, service constructor mock, mock clearing) does
  // not apply here. Every test starts from a clean, fully-wired slate.
  const REDIRECT_URI = 'https://post-engineer.com/api/instagram-auth/callback';

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.INSTAGRAM_REDIRECT_URI = REDIRECT_URI;
    process.env.INSTAGRAM_REDIRECT_URI_LOCAL =
      'http://localhost:3434/api/instagram-auth/callback';
    vi.mocked(InstagramService).mockImplementation(function () {
      return { exchangeCodeForLongLivedToken, getProfile } as never;
    });
    vi.mocked(verifyOAuthNonce).mockReturnValue(true);
    vi.mocked(decodeOAuthState).mockReturnValue({
      provider: 'instagram',
      nonce: 'n',
      redirectUri: REDIRECT_URI,
    } as never);
    vi.mocked(oauthPopupResponse).mockReturnValue(new Response('popup') as never);
  });

  afterEach(() => {
    delete process.env.INSTAGRAM_REDIRECT_URI;
    delete process.env.INSTAGRAM_REDIRECT_URI_LOCAL;
  });
  function setupSuccess(overrides: {
    code?: string;
    accessToken?: string;
    igUserId?: string;
    username?: string;
  } = {}) {
    const code = overrides.code ?? 'code-ok';
    sessionMock(true);
    serviceKeyMock(true);
    vi.mocked(decodeOAuthState).mockReturnValue({
      provider: 'instagram',
      nonce: 'n',
      redirectUri: process.env.INSTAGRAM_REDIRECT_URI,
    } as never);
    vi.mocked(verifyOAuthNonce).mockReturnValue(true);
    exchangeCodeForLongLivedToken.mockResolvedValue({
      accessToken: overrides.accessToken ?? 'token-ok',
      expiresIn: 1000,
      tokenType: 'Bearer',
    });
    getProfile.mockResolvedValue({
      userdId: overrides.igUserId ?? 'ig-9',
      username: overrides.username ?? 'newuser',
      name: 'New',
      profilePictureUrl: 'https://p.jpg',
      followersCount: 1,
      mediaCount: 1,
    });
    vi.mocked(upsertSocialAccount).mockResolvedValue({} as never);
    return { code };
  }

  function allLogCalls(): unknown[][] {
    return [
      ...vi.mocked(logger.info).mock.calls,
      ...vi.mocked(logger.warn).mock.calls,
      ...vi.mocked(logger.error).mock.calls,
      ...vi.mocked(logger.debug).mock.calls,
    ];
  }

  it('logs every step on the success path without leaking secrets', async () => {
    const CODE = 'super-secret-code-abc123';
    const STATE = 'super-secret-state-abc123';
    const TOKEN = 'super-secret-token-abc123';
    const { code } = setupSuccess({ code: CODE, accessToken: TOKEN });
    expect(code).toBe(CODE);

    await GET(makeRequest(`?code=${CODE}&state=${STATE}`));

    const calls = allLogCalls();
    expect(calls.length).toBeGreaterThan(0);
    const serialized = JSON.stringify(calls);
    // step markers are present ...
    expect(serialized).toMatch(/received/);
    expect(serialized).toMatch(/auth ok/);
    expect(serialized).toMatch(/profile/i);
    // ... but the raw code, state and access token never hit the logs
    expect(serialized).not.toContain(CODE);
    expect(serialized).not.toContain(STATE);
    expect(serialized).not.toContain(TOKEN);
  });

  it('logs auth failures with the reason', async () => {
    sessionMock(false);
    await GET(makeRequest('?code=c&state=s'));
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('auth failed'),
      expect.objectContaining({ error: expect.stringContaining('Authentication required') })
    );
  });

  it('logs token exchange failures', async () => {
    setupSuccess();
    exchangeCodeForLongLivedToken.mockRejectedValue(new Error('bad code'));
    await GET(makeRequest('?code=c&state=s'));
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('token exchange failed'),
      expect.any(Error),
      expect.anything()
    );
  });

  it('logs database save failures', async () => {
    setupSuccess();
    vi.mocked(upsertSocialAccount).mockRejectedValue(new Error('db down'));
    await GET(makeRequest('?code=c&state=s'));
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('database'),
      expect.any(Error),
      expect.objectContaining({ igUserId: 'ig-9', username: 'newuser' })
    );
  });

  it('logs the successful persist with the account identity', async () => {
    setupSuccess({ igUserId: 'ig-42', username: 'forty two' });
    await GET(makeRequest('?code=c&state=s'));
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('persisted'),
      expect.objectContaining({ igUserId: 'ig-42', username: 'forty two' })
    );
  });
});
