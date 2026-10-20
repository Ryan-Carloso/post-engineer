import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

// auth-js is not a direct dependency of the web app. These objects match
// the fields getUser() puts on AuthSessionMissingError, AuthApiError, and
// AuthRetryableFetchError (name + status). Middleware must key off those,
// not a class it would have to import into the edge bundle.

const { getUser } = vi.hoisted(() => ({
  getUser: vi.fn(),
}));

vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({
    auth: { getUser },
  }),
}));

import { middleware } from '@/middleware';

// The coverage Cypress job fails when a client navigation to
// /posts/<slotId> lands on /landing. Middleware is the only redirect
// to that path. getUser() reports aborted fetches, HTTP 429, and 5xx
// as { user: null, error } and leaves the cookie in place; a 307 still
// follows, and the matcher never runs on /landing, so the browser stays
// there for the whole assertion window.

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

describe('middleware auth redirect', () => {
  beforeEach(() => {
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
    getUser.mockResolvedValue({
      data: { user: null },
      error: authError('AuthSessionMissingError', 400, 'Auth session missing!'),
    });

    const response = await middleware(requestFor('/posts/slot-e2e-new'));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('http://localhost:3434/landing');
    expect(warnCalls()).toHaveLength(0);
  });

  it('redirects to /landing when getUser returns no user and no error', async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });

    const response = await middleware(requestFor('/posts/slot-e2e-new'));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('http://localhost:3434/landing');
  });

  it('redirects to /landing when the access token is rejected', async () => {
    getUser.mockResolvedValue({
      data: { user: null },
      error: authError('AuthApiError', 401, 'invalid jwt'),
    });

    const response = await middleware(requestFor('/posts/slot-e2e-new'));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('http://localhost:3434/landing');
  });

  it('does not redirect when getUser fails with a retryable fetch error', async () => {
    const secret = 'api_key=super-secret-value';
    getUser.mockResolvedValue({
      data: { user: null },
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
    'does not redirect when getUser fails with HTTP %s',
    async (status) => {
      getUser.mockResolvedValue({
        data: { user: null },
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
    getUser.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    });

    const response = await middleware(requestFor('/posts/slot-e2e-new'));

    expect(response.status).not.toBe(307);
    expect(response.headers.get('location')).toBeNull();
  });

  it('sends an authenticated visitor from /login to /', async () => {
    getUser.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    });

    const response = await middleware(requestFor('/login'));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('http://localhost:3434/');
  });
});
