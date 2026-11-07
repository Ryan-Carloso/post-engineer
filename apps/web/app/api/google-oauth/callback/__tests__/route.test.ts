import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
}));
vi.mock('@/lib/supabase/service', () => ({
  createSupabaseServiceClient: vi.fn(),
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
const { channelsList } = vi.hoisted(() => ({ channelsList: vi.fn() }));
vi.mock('@/lib/youtube', () => ({
  createGoogleOAuth2Client: vi.fn(),
  getYouTubeClient: vi.fn(() => ({ channels: { list: channelsList } })),
}));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/account-profile-telemetry', () => ({
  reportProfileFetched: vi.fn(),
  reportProfileFetchFailed: vi.fn(),
}));
vi.mock('@/lib/metrics/reset-retention', () => ({
  resetYouTubeRetentionWindows: vi.fn(),
}));
vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));
const CHANNEL = {
  id: 'chan-1',
  snippet: {
    title: 'My Channel',
    thumbnails: {
      default: { url: 'https://yt3.googleusercontent.com/small.jpg' },
      medium: { url: 'https://yt3.googleusercontent.com/medium.jpg' },
    },
    customUrl: '@mychannel',
  },
  statistics: { subscriberCount: '10', viewCount: '100', videoCount: '5' },
};

import { GET } from '@/app/api/google-oauth/callback/route';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { hashOAuthState } from '@/lib/oauth-connect';
import { makeOAuthStateStore, type FakeOAuthStateStore } from '@/test/oauth-state-store';
import { decodeOAuthState, verifyOAuthNonce, oauthPopupResponse } from '@/lib/oauth-utils';
import { upsertSocialAccount } from '@/lib/social-accounts';
import { createGoogleOAuth2Client } from '@/lib/youtube';
import { logger } from '@/lib/logger';
import { reportProfileFetched, reportProfileFetchFailed } from '@/lib/account-profile-telemetry';
import { resetYouTubeRetentionWindows } from '@/lib/metrics/reset-retention';

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
  return new NextRequest(`http://localhost/api/google-oauth/callback${query}`);
}

// Connect-url (MCP) flow: the service client only serves oauth_states,
// backed by the shared fake that applies every filter of the real chain.
// The mocked decodeOAuthState (beforeEach) yields provider 'youtube', nonce 'n'.
function connectUrlState(ownerId: string): { store: FakeOAuthStateStore; hash: string } {
  const store = makeOAuthStateStore();
  const hash = hashOAuthState('s');
  store.rows.set(hash, {
    state_hash: hash,
    user_id: ownerId,
    provider: 'youtube',
    nonce: 'n',
    redirect_uri: 'https://post-engineer.com/api/google-oauth/callback',
    expires_at: new Date(Date.now() + 600_000).toISOString(),
  });
  vi.mocked(createSupabaseServiceClient).mockReturnValue(store as never);
  return { store, hash };
}

function sessionAs(userId: string | null): { auth: { getUser: ReturnType<typeof vi.fn> } } {
  const client = {
    auth: {
      getUser: vi.fn().mockResolvedValue(
        userId === null
          ? { data: { user: null }, error: { message: 'no session' } }
          : { data: { user: { id: userId } }, error: null },
      ),
    },
  };
  vi.mocked(createSupabaseServerClient).mockResolvedValue(client as never);
  return client;
}

describe('/api/google-oauth/callback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(verifyOAuthNonce).mockReturnValue(true);
    vi.mocked(decodeOAuthState).mockReturnValue({
      api_key_id: 'key-1',
      provider: 'youtube',
      nonce: 'n',
    } as never);
    vi.mocked(upsertSocialAccount).mockResolvedValue({} as never);
    vi.mocked(createGoogleOAuth2Client).mockResolvedValue({
      getToken: vi.fn().mockResolvedValue({
        tokens: {
          access_token: 'at',
          refresh_token: 'rt',
          token_type: 'Bearer',
          expiry_date: 12345,
        },
      }),
      setCredentials: vi.fn(),
    } as never);
    vi.mocked(oauthPopupResponse).mockReturnValue(new Response('popup') as never);
    channelsList.mockReset();
    channelsList.mockResolvedValue({ data: { items: [CHANNEL] } });
    vi.mocked(reportProfileFetched).mockReset();
    vi.mocked(reportProfileFetchFailed).mockReset();
  });

  it('returns error popup on oauth error param', async () => {
    const res = await GET(makeRequest('?error=access_denied'));
    expect(await res.text()).toBe('popup');
    expect(oauthPopupResponse).toHaveBeenCalledWith(
      'youtube-oauth-error',
      expect.objectContaining({ error: expect.stringContaining('access_denied') }),
    );
  });

  it('returns error popup when code missing', async () => {
    await GET(makeRequest('?'));
    expect(oauthPopupResponse).toHaveBeenCalledWith(
      'youtube-oauth-error',
      expect.objectContaining({ error: 'Missing authorization code' }),
    );
  });

  it('returns error popup when not logged in', async () => {
    sessionMock(false);
    await GET(makeRequest('?code=c'));
    expect(oauthPopupResponse).toHaveBeenCalledWith(
      'youtube-oauth-error',
      expect.objectContaining({ error: expect.stringContaining('Authentication required') }),
    );
  });

  it('returns error popup when nonce invalid', async () => {
    sessionMock(true);
    vi.mocked(verifyOAuthNonce).mockReturnValue(false);
    await GET(makeRequest('?code=c&state=s'));
    expect(oauthPopupResponse).toHaveBeenCalledWith(
      'youtube-oauth-error',
      expect.objectContaining({ error: expect.stringContaining('Invalid or expired') }),
    );
  });

  it('persists account and returns success popup', async () => {
    sessionMock(true);
    serviceKeyMock(true);
    const res = await GET(makeRequest('?code=c&state=s'));
    expect(await res.text()).toBe('popup');
    expect(upsertSocialAccount).toHaveBeenCalledTimes(1);
    // A reconnect must reopen the retention windows the old token closed.
    expect(resetYouTubeRetentionWindows).toHaveBeenCalledWith('user-1', 'chan-1');
    expect(oauthPopupResponse).toHaveBeenCalledWith(
      'youtube-oauth-success',
      expect.objectContaining({ account: expect.objectContaining({ channelId: 'chan-1' }) }),
    );
  });

  it('stores the medium avatar, channel name and sync stamp, and reports the profile', async () => {
    sessionMock(true);
    serviceKeyMock(true);
    await GET(makeRequest('?code=c&state=s'));
    expect(channelsList).toHaveBeenCalledWith({ part: ['snippet', 'statistics'], mine: true }, { timeout: 15_000 });
    expect(upsertSocialAccount).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        providerAccountId: 'chan-1',
        accountName: 'My Channel',
        accountMetadata: expect.objectContaining({
          thumbnail: 'https://yt3.googleusercontent.com/medium.jpg',
          customUrl: '@mychannel',
          profileSyncedAt: expect.any(String),
        }),
      }),
    );
    expect(reportProfileFetched).toHaveBeenCalledWith('youtube', 'connect', {
      accountName: 'My Channel',
      pictureUrl: 'https://yt3.googleusercontent.com/medium.jpg',
    });
  });

  it('fails the connect (no placeholder row) when the channel read throws', async () => {
    sessionMock(true);
    serviceKeyMock(true);
    const failure = new Error('quota');
    channelsList.mockRejectedValue(failure);
    await GET(makeRequest('?code=c&state=s'));
    expect(upsertSocialAccount).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith('[youtube-oauth] channel read failed', failure);
    expect(reportProfileFetchFailed).toHaveBeenCalledWith('youtube', 'connect', failure);
    expect(oauthPopupResponse).toHaveBeenCalledWith(
      'youtube-oauth-error',
      { error: 'Could not read your YouTube channel. Please try again.' },
    );
  });

  it('fails the connect when the Google account has no YouTube channel', async () => {
    sessionMock(true);
    serviceKeyMock(true);
    channelsList.mockResolvedValue({ data: { items: [] } });
    await GET(makeRequest('?code=c&state=s'));
    expect(upsertSocialAccount).not.toHaveBeenCalled();
    expect(reportProfileFetchFailed).toHaveBeenCalledWith(
      'youtube',
      'connect',
      expect.objectContaining({ message: 'YOUTUBE_NO_CHANNEL: no channel' }),
    );
    expect(oauthPopupResponse).toHaveBeenCalledWith(
      'youtube-oauth-error',
      expect.objectContaining({ error: expect.stringContaining('has no YouTube channel') }),
    );
  });

  it('returns error popup when token exchange fails', async () => {
    sessionMock(true);
    vi.mocked(createGoogleOAuth2Client).mockRejectedValue(new Error('token fail'));
    await GET(makeRequest('?code=c&state=s'));
    expect(oauthPopupResponse).toHaveBeenCalledWith(
      'youtube-oauth-error',
      expect.objectContaining({ error: 'token fail' }),
    );
  });

  it('logs the failure when the callback flow throws', async () => {
    sessionMock(true);
    vi.mocked(createGoogleOAuth2Client).mockRejectedValue(new Error('token fail'));
    await GET(makeRequest('?code=c&state=s'));
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('callback failed'),
      expect.objectContaining({ message: 'token fail' }),
    );
  });

  it('MCP flow: the signed-in owner consumes the state and persists with the session client', async () => {
    const sessionClient = sessionAs('api-key-owner');
    vi.mocked(verifyOAuthNonce).mockReturnValue(false);
    const { store, hash } = connectUrlState('api-key-owner');
    const res = await GET(makeRequest('?code=c&state=s'));
    expect(await res.text()).toBe('popup');
    expect(oauthPopupResponse).toHaveBeenCalledWith(
      'youtube-oauth-success',
      expect.objectContaining({ account: expect.objectContaining({ channelId: 'chan-1' }) }),
    );
    expect(store.rows.has(hash)).toBe(false);
    // persisted under the signed-in owner through the RLS-bound session client
    expect(upsertSocialAccount).toHaveBeenCalledWith(
      sessionClient,
      expect.objectContaining({ userId: 'api-key-owner', provider: 'youtube' }),
    );
    // the service role only ever touched oauth_states
    expect(store.tables).toEqual(['oauth_states']);
  });

  it('MCP flow: another signed-in user cannot complete the owner connect URL', async () => {
    sessionAs('victim-session-user');
    vi.mocked(verifyOAuthNonce).mockReturnValue(false);
    const { store, hash } = connectUrlState('attacker-user');
    await GET(makeRequest('?code=c&state=s'));
    expect(oauthPopupResponse).toHaveBeenCalledWith(
      'youtube-oauth-error',
      expect.objectContaining({ error: 'Invalid or expired OAuth state.' }),
    );
    expect(createGoogleOAuth2Client).not.toHaveBeenCalled();
    expect(upsertSocialAccount).not.toHaveBeenCalled();
    expect(store.rows.has(hash)).toBe(true);
  });

  it('MCP flow: a browser without a session cannot complete the connect URL', async () => {
    sessionAs(null);
    vi.mocked(verifyOAuthNonce).mockReturnValue(false);
    const { store, hash } = connectUrlState('api-key-owner');
    await GET(makeRequest('?code=c&state=s'));
    expect(oauthPopupResponse).toHaveBeenCalledWith(
      'youtube-oauth-error',
      expect.objectContaining({ error: 'Authentication required. Please log in.' }),
    );
    expect(createGoogleOAuth2Client).not.toHaveBeenCalled();
    expect(upsertSocialAccount).not.toHaveBeenCalled();
    expect(store.rows.has(hash)).toBe(true);
  });
});
