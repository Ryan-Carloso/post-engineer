import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server';

const { getClaims, getUser } = vi.hoisted(() => ({
  getClaims: vi.fn(),
  getUser: vi.fn(),
}));

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getClaims, getUser },
  }),
}));

import { config, middleware } from '@/middleware';

function requestFor(pathname: string): NextRequest {
  return new NextRequest(`http://localhost:3434${pathname}`);
}

function warnCalls(): unknown[][] {
  return vi.mocked(console.warn).mock.calls;
}

function authError(name: string, status: number, message: string = name): {
  name: string;
  status: number;
  message: string;
  __isAuthError: true;
} {
  return { name, status, message, __isAuthError: true };
}

function validClaims(sub: string): {
  claims: { sub: string; role: string; exp: number };
  header: { alg: string; kid: string };
  signature: Uint8Array;
} {
  return {
    claims: { sub, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 },
    header: { alg: 'ES256', kid: 'kid-1' },
    signature: new Uint8Array(),
  };
}

describe('middleware auth redirect', () => {
  beforeEach(() => {
    getClaims.mockReset();
    getUser.mockReset();
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'test-anon-key');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('redirects to /landing when the session is missing', async () => {
    getClaims.mockResolvedValue({
      data: null,
      error: authError('AuthSessionMissingError', 400, 'Auth session missing!'),
    });

    const response = await middleware(requestFor('/posts/slot-e2e-new'));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('http://localhost:3434/landing');
    expect(warnCalls()).toHaveLength(0);
  });

  it('does not redirect unauthenticated requests for the public /recipes page', async () => {
    getClaims.mockResolvedValue({ data: null, error: null });

    const response = await middleware(requestFor('/recipes'));

    expect(response.headers.get('location')).toBeNull();
  });

  it('does not redirect unauthenticated requests for a public /recipes detail page', async () => {
    getClaims.mockResolvedValue({ data: null, error: null });

    const response = await middleware(requestFor('/recipes/daily-news'));

    expect(response.headers.get('location')).toBeNull();
  });

  it('does not redirect unauthenticated requests for a public /s/<token> share page', async () => {
    getClaims.mockResolvedValue({ data: null, error: null });

    const response = await middleware(requestFor(`/s/${'a'.repeat(43)}`));

    expect(response.headers.get('location')).toBeNull();
  });

  it('redirects to /landing when getClaims finds no session and no error', async () => {
    getClaims.mockResolvedValue({ data: null, error: null });

    const response = await middleware(requestFor('/posts/slot-e2e-new'));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('http://localhost:3434/landing');
  });

  it('redirects to /landing when the access token is rejected', async () => {
    getClaims.mockResolvedValue({
      data: null,
      error: authError('AuthApiError', 401, 'invalid jwt'),
    });

    const response = await middleware(requestFor('/posts/slot-e2e-new'));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('http://localhost:3434/landing');
  });

  it('does not redirect when getClaims fails with a retryable fetch error', async () => {
    const secret = 'api_key=super-secret-value';
    getClaims.mockResolvedValue({
      data: null,
      error: authError('AuthRetryableFetchError', 0, secret),
    });

    const response = await middleware(requestFor('/posts/slot-e2e-new'));

    expect(response.status).not.toBe(307);
    expect(response.headers.get('location')).toBeNull();
    expect(warnCalls()).toEqual([
      [
        '[middleware] auth check failed transiently; continuing',
        { name: 'AuthRetryableFetchError', status: 0, pathname: '/posts/slot-e2e-new' },
      ],
    ]);
    expect(JSON.stringify(warnCalls())).not.toContain(secret);
  });

  it.each([429, 500, 503, 520])(
    'does not redirect when getClaims fails with HTTP %s',
    async (status) => {
      getClaims.mockResolvedValue({
        data: null,
        error: authError('AuthApiError', status, `HTTP ${status}`),
      });

      const response = await middleware(requestFor('/posts/slot-e2e-new'));

      expect(response.status).not.toBe(307);
      expect(response.headers.get('location')).toBeNull();
      expect(warnCalls()[0]?.[1]).toEqual({
        name: 'AuthApiError',
        status,
        pathname: '/posts/slot-e2e-new',
      });
    },
  );

  it('continues when the user is present', async () => {
    getClaims.mockResolvedValue({
      data: validClaims('user-1'),
      error: null,
    });

    const response = await middleware(requestFor('/posts/slot-e2e-new'));

    expect(response.status).not.toBe(307);
    expect(response.headers.get('location')).toBeNull();
  });

  it('verifies the session from the JWT claims and never fetches the user record', async () => {
    getClaims.mockResolvedValue({ data: validClaims('user-1'), error: null });

    await middleware(requestFor('/posts/slot-e2e-new'));

    expect(getClaims).toHaveBeenCalledTimes(1);
    expect(getUser).not.toHaveBeenCalled();
  });

  it('redirects to /landing when the verified claims carry no subject', async () => {
    getClaims.mockResolvedValue({
      data: { ...validClaims(''), claims: { role: 'anon', exp: 0 } },
      error: null,
    });

    const response = await middleware(requestFor('/posts/slot-e2e-new'));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('http://localhost:3434/landing');
  });

  it('redirects to /landing when the JWT signature is invalid', async () => {
    getClaims.mockResolvedValue({
      data: null,
      error: authError('AuthInvalidJwtError', 400, 'Invalid JWT signature'),
    });

    const response = await middleware(requestFor('/posts/slot-e2e-new'));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('http://localhost:3434/landing');
    expect(warnCalls()).toHaveLength(0);
  });

  it('does not redirect unauthenticated requests for public static assets (logo.png)', async () => {
    getClaims.mockResolvedValue({
      data: null,
      error: authError('AuthSessionMissingError', 400, 'Auth session missing!'),
    });

    const response = await middleware(requestFor('/logo.png'));

    expect(response.status).not.toBe(307);
    expect(response.headers.get('location')).toBeNull();
  });

  it('does not redirect unauthenticated requests for the public /openapi.json spec', async () => {
    getClaims.mockResolvedValue({
      data: null,
      error: authError('AuthSessionMissingError', 400, 'Auth session missing!'),
    });

    const response = await middleware(requestFor('/openapi.json'));

    expect(response.status).not.toBe(307);
    expect(response.headers.get('location')).toBeNull();
    expect(getClaims).not.toHaveBeenCalled();
  });

  it('still redirects unauthenticated requests for any other .json path', async () => {
    getClaims.mockResolvedValue({
      data: null,
      error: authError('AuthSessionMissingError', 400, 'Auth session missing!'),
    });

    const response = await middleware(requestFor('/posts/openapi.json'));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('http://localhost:3434/landing');
  });

  it('excludes /openapi.json from the matcher so the middleware never runs on it', () => {
    expect(config.matcher[0].includes('openapi\\.json$')).toBe(true);
  });

  it('does not redirect unauthenticated requests for /sitemap.xml', async () => {
    getClaims.mockResolvedValue({
      data: null,
      error: authError('AuthSessionMissingError', 400, 'Auth session missing!'),
    });

    const response = await middleware(requestFor('/sitemap.xml'));

    expect(response.status).not.toBe(307);
    expect(response.headers.get('location')).toBeNull();
    expect(getClaims).not.toHaveBeenCalled();
  });

  it('still redirects unauthenticated requests for any other .xml path under an app route', async () => {
    getClaims.mockResolvedValue({
      data: null,
      error: authError('AuthSessionMissingError', 400, 'Auth session missing!'),
    });

    const response = await middleware(requestFor('/posts/export.xml'));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('http://localhost:3434/landing');
  });

  it('excludes sitemap.xml from the matcher so the middleware never runs on it', () => {
    expect(config.matcher[0].includes('sitemap\\.xml$')).toBe(true);
  });

  it('does not redirect unauthenticated requests for /mcp', async () => {
    getClaims.mockResolvedValue({
      data: null,
      error: authError('AuthSessionMissingError', 400, 'Auth session missing!'),
    });

    const response = await middleware(requestFor('/mcp'));

    expect(response.status).not.toBe(307);
    expect(response.headers.get('location')).toBeNull();
    expect(getClaims).not.toHaveBeenCalled();
  });

  it('excludes /mcp from the matcher so the middleware never runs on it', () => {
    expect(config.matcher[0].includes('mcp$')).toBe(true);
  });
});

describe('middleware app-route gate', () => {
  const missingSession = authError('AuthSessionMissingError', 400, 'Auth session missing!');

  beforeEach(() => {
    getClaims.mockReset();
    getUser.mockReset();
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'test-anon-key');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it.each(['/some-unknown', '/landing-v2', '/termsxyz'])(
    'lets a signed-out request for unknown path %s reach the 404 page',
    async (pathname) => {
      getClaims.mockResolvedValue({ data: null, error: missingSession });

      const response = await middleware(requestFor(pathname));

      expect(response.status).not.toBe(307);
      expect(response.headers.get('location')).toBeNull();
      expect(getClaims).toHaveBeenCalledTimes(1);
    },
  );

  it('redirects a signed-out request for / to /landing', async () => {
    getClaims.mockResolvedValue({ data: null, error: missingSession });

    const response = await middleware(requestFor('/'));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('http://localhost:3434/landing');
  });

  it('passes a signed-in request for an unknown path through', async () => {
    getClaims.mockResolvedValue({ data: validClaims('user-1'), error: null });

    const response = await middleware(requestFor('/some-unknown'));

    expect(response.status).not.toBe(307);
    expect(response.headers.get('location')).toBeNull();
    expect(getClaims).toHaveBeenCalledTimes(1);
  });

  it('does not warn about a transient auth error on an unknown path because the gate does not apply', async () => {
    getClaims.mockResolvedValue({
      data: null,
      error: authError('AuthRetryableFetchError', 0, 'upstream down'),
    });

    const response = await middleware(requestFor('/some-unknown'));

    expect(response.headers.get('location')).toBeNull();
    expect(getClaims).toHaveBeenCalledTimes(1);
    expect(warnCalls()).toHaveLength(0);
  });
});

describe('middleware matcher', () => {
  const matches = (pathname: string): boolean =>
    unstable_doesMiddlewareMatch({ config, url: `http://localhost:3434${pathname}` });

  it.each([
    '/landing-v2',
    '/termsxyz',
    '/loginx',
    '/privacy-old',
    '/recipesfoo',
    '/docsx',
    '/helpx',
    '/sx',
    '/posts',
    '/',
    '/some-unknown',
  ])('runs the middleware on %s', (pathname) => {
    expect(matches(pathname)).toBe(true);
  });

  it.each([
    '/landing',
    '/landing/',
    '/login',
    '/terms',
    '/privacy',
    '/recipes',
    '/recipes/daily-news',
    '/s/abc',
    '/docs',
    '/docs/',
    '/docs/mcp',
    '/help',
    '/help/primeiros-passos',
    '/en/help',
    '/en/help/primeiros-passos',
    '/llms.txt',
    '/llms-full.txt',
    '/robots.txt',
    '/sitemap.xml',
    '/openapi.json',
    '/api/x',
    '/auth/callback',
    '/.well-known/x',
    '/oauth/authorize',
  ])('skips the middleware on %s', (pathname) => {
    expect(matches(pathname)).toBe(false);
  });
});
