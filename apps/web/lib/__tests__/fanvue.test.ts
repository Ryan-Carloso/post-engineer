// @vitest-environment node
import { createHash } from 'node:crypto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  FANVUE_SCOPES,
  buildFanvueAuthUrl,
  exchangeFanvueCode,
  fanvueCodeChallenge,
  fetchFanvueProfile,
  generateFanvueCodeVerifier,
  refreshFanvueAccessToken,
} from '@/lib/fanvue';
import { FANVUE_API_VERSION } from '@/lib/fanvue-http';
import { FanvueError } from '@/lib/errors';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function call(index: number): { url: URL; init: RequestInit } {
  const [url, init] = mockFetch.mock.calls[index] as [string, RequestInit];
  return { url: new URL(url), init };
}

function headersOf(init: RequestInit): Record<string, string> {
  return (init.headers ?? {}) as Record<string, string>;
}

beforeEach(() => {
  mockFetch.mockReset();
  vi.stubEnv('FANVUE_CLIENT_ID', 'fan-cid');
  vi.stubEnv('FANVUE_CLIENT_SECRET', 'fan-secret');
  vi.stubEnv('FANVUE_REDIRECT_URI', 'https://app.example/fan/cb');
});

describe('PKCE helpers', () => {
  it('generates a 43-char base64url verifier and the S256 challenge for it', () => {
    const verifier = generateFanvueCodeVerifier();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(fanvueCodeChallenge(verifier)).toBe(
      createHash('sha256').update(verifier, 'utf8').digest('base64url'),
    );
    expect(fanvueCodeChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });
});

describe('buildFanvueAuthUrl', () => {
  it('requests the Fanvue scopes with PKCE S256 and the app id, state and redirect', () => {
    const { authUrl, codeVerifier } = buildFanvueAuthUrl('st-1');
    const url = new URL(authUrl);
    expect(`${url.origin}${url.pathname}`).toBe('https://auth.fanvue.com/oauth2/auth');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('fan-cid');
    expect(url.searchParams.get('state')).toBe('st-1');
    expect(url.searchParams.get('redirect_uri')).toBe('https://app.example/fan/cb');
    expect(url.searchParams.get('scope')).toBe(
      'read:self read:post write:post read:media write:media offline_access',
    );
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBe(fanvueCodeChallenge(codeVerifier));
    expect(codeVerifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(FANVUE_SCOPES).toContain('offline_access');
    expect(FANVUE_SCOPES).toContain('write:media');
  });

  it('uses the redirect override when given', () => {
    const { authUrl } = buildFanvueAuthUrl('st-1', 'http://localhost:3434/api/fanvue-auth/callback');
    expect(new URL(authUrl).searchParams.get('redirect_uri')).toBe(
      'http://localhost:3434/api/fanvue-auth/callback',
    );
  });

  it('fails explicitly when the client id is missing or empty', () => {
    vi.stubEnv('FANVUE_CLIENT_ID', undefined);
    expect(() => buildFanvueAuthUrl('st-1')).toThrow('FANVUE_ENV_MISSING: FANVUE_CLIENT_ID');
    vi.stubEnv('FANVUE_CLIENT_ID', '');
    expect(() => buildFanvueAuthUrl('st-1')).toThrow(FanvueError);
  });
});

describe('exchangeFanvueCode', () => {
  it('swaps the code + PKCE verifier for tokens with HTTP Basic auth', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ access_token: 'at-1', refresh_token: 'rt-1', expires_in: 3600, token_type: 'Bearer' }),
    );

    const token = await exchangeFanvueCode('code-1', 'verifier-1');
    expect(token).toEqual({ access_token: 'at-1', refresh_token: 'rt-1', expires_in: 3600, token_type: 'Bearer' });

    const first = call(0);
    expect(`${first.url.origin}${first.url.pathname}`).toBe('https://auth.fanvue.com/oauth2/token');
    expect(first.init.method).toBe('POST');
    expect(headersOf(first.init).Authorization).toBe(`Basic ${Buffer.from('fan-cid:fan-secret').toString('base64')}`);
    const body = new URLSearchParams(String(first.init.body));
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('code-1');
    expect(body.get('code_verifier')).toBe('verifier-1');
    expect(body.get('redirect_uri')).toBe('https://app.example/fan/cb');
  });

  it('defaults a missing expires_in to one hour', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ access_token: 'at-1', refresh_token: null }));
    const token = await exchangeFanvueCode('code-1', 'verifier-1');
    expect(token.expires_in).toBe(3600);
    expect(token.refresh_token).toBeNull();
  });

  it('throws the Fanvue status when the exchange fails', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ error: 'invalid_grant', error_description: 'bad code' }, 400));
    await expect(exchangeFanvueCode('code-1', 'verifier-1')).rejects.toMatchObject({ statusCode: 400 });
  });

  it('throws when the response carries no access token', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ refresh_token: 'rt-1' }));
    await expect(exchangeFanvueCode('code-1', 'verifier-1')).rejects.toThrow('missing access_token');
  });
});

describe('refreshFanvueAccessToken', () => {
  it('exchanges the refresh token for a new pair', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ access_token: 'at-2', refresh_token: 'rt-2', expires_in: 3600, token_type: 'Bearer' }),
    );
    const token = await refreshFanvueAccessToken('rt-1');
    expect(token.access_token).toBe('at-2');
    expect(token.refresh_token).toBe('rt-2');
    const body = new URLSearchParams(String(call(0).init.body));
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('rt-1');
  });
});

describe('fetchFanvueProfile', () => {
  it('reads the /users/me uuid, handle, display name, avatar and creator flag', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        uuid: 'user-1',
        handle: 'maker',
        displayName: 'Maker',
        email: 'maker@example.com',
        avatarUrl: 'https://cdn.fanvue.com/a.jpg',
        isCreator: true,
        createdAt: '2026-01-01T00:00:00.000Z',
      }),
    );
    await expect(fetchFanvueProfile('at-1')).resolves.toEqual({
      uuid: 'user-1',
      username: 'maker',
      displayName: 'Maker',
      email: 'maker@example.com',
      avatarUrl: 'https://cdn.fanvue.com/a.jpg',
      isCreator: true,
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    const first = call(0);
    expect(`${first.url.origin}${first.url.pathname}`).toBe('https://api.fanvue.com/users/me');
    expect(headersOf(first.init).Authorization).toBe('Bearer at-1');
    expect(headersOf(first.init)['X-Fanvue-API-Version']).toBe(FANVUE_API_VERSION);
    expect(FANVUE_API_VERSION).toBe('2025-06-26');
  });

  it('reads the handle, not the absent username field, as the account name fallback', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ uuid: 'user-1', handle: 'maker' }));
    const profile = await fetchFanvueProfile('at-1');
    expect(profile.username).toBe('maker');
    expect(profile.displayName).toBeNull();
  });

  it('throws when the profile carries no uuid', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ handle: 'maker' }));
    await expect(fetchFanvueProfile('at-1')).rejects.toThrow('missing uuid');
  });

  it('throws a Fanvue error with the API status on a non-2xx profile read', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ message: 'unauthorized' }, 401));
    await expect(fetchFanvueProfile('bad')).rejects.toMatchObject({ statusCode: 401 });
  });

  it('throws on a non-JSON profile body', async () => {
    mockFetch.mockResolvedValueOnce(new Response('<html>proxy error</html>', { status: 200 }));
    await expect(fetchFanvueProfile('at-1')).rejects.toThrow('invalid response body');
  });
});
