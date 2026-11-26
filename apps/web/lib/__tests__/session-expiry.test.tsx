import { describe, it, expect, vi } from 'vitest';

import { config } from '../../middleware';
import { currentRelativePath, isSessionExpiredError, loginRedirectTarget } from '../session-expiry';
import { HttpStatusError } from '../errors';

describe('isSessionExpiredError', () => {
  it('is true for an HttpStatusError with status 401', () => {
    expect(isSessionExpiredError(new HttpStatusError('Session expired', 401))).toBe(true);
  });

  it.each([
    ['403', new HttpStatusError('Forbidden', 403)],
    ['500', new HttpStatusError('Boom', 500)],
    ['plain Error', new Error('no status')],
    ['non-Error', '401'],
    ['undefined', undefined],
  ])('is false for %s', (_name, error) => {
    expect(isSessionExpiredError(error)).toBe(false);
  });
});

function stubWindowLocation(pathname: string, search: string, assign: unknown): void {
  vi.stubGlobal('window', { location: { pathname, search, assign } });
}

describe('loginRedirectTarget', () => {
  it('returns /login?next=<current path and query>', () => {
    stubWindowLocation('/dashboard', '?tab=schedule', undefined);
    expect(loginRedirectTarget()).toBe('/login?next=%2Fdashboard%3Ftab%3Dschedule');
  });

  it.each(['/settings', '/sharing', '/s2/abc'])('still redirects the protected path %s that only starts with /s', (pathname) => {
    stubWindowLocation(pathname, '', undefined);
    expect(loginRedirectTarget()).toBe(`/login?next=${encodeURIComponent(pathname)}`);
  });

  it('returns null on the server (no window)', () => {
    vi.stubGlobal('window', undefined);
    expect(currentRelativePath()).toBeNull();
    expect(loginRedirectTarget()).toBeNull();
  });

  it.each([
    ['the login page itself', '/login', ''],
    ['/auth/', '/auth/callback', '?code=abc'],
    ['the landing page', '/landing', ''],
    ['the privacy page', '/privacy', ''],
    ['the terms page', '/terms', ''],
    ['a public recipe page', '/recipes', ''],
    ['/oauth/ pages', '/oauth/authorize', '?state=x'],
    ['a public share page', `/s/${'a'.repeat(43)}`, ''],
  ])('returns null on %s', (_name, pathname, search) => {
    stubWindowLocation(pathname, search, undefined);
    expect(loginRedirectTarget()).toBeNull();
  });
});

describe('PUBLIC_PATH_PREFIXES — middleware parity', () => {
  const matcherSource = config.matcher[0];
  const groupMatch = /\(\?:([a-z|/]+)\)\(\?:\/\|\$\)/.exec(matcherSource);
  const middlewarePublicPaths = (groupMatch === null ? [] : groupMatch[1].split('|')).map(
    (name) => `/${name}`,
  );

  it('extracts the public page segments from the matcher (guard for this very pin)', () => {
    expect(middlewarePublicPaths).toEqual([
      '/login',
      '/landing',
      '/privacy',
      '/terms',
      '/recipes',
      '/s',
      '/docs',
      '/help',
      '/en/help',
    ]);
  });

  it.each(middlewarePublicPaths)('never redirects from the middleware-public %s', (prefix) => {
    stubWindowLocation(prefix, '', undefined);
    expect(loginRedirectTarget()).toBeNull();
  });

  it.each([
    ['/auth/', '/auth/callback'],
    ['/oauth/', '/oauth/authorize'],
    ['/s/', `/s/${'a'.repeat(43)}`],
  ])('never redirects from the matcher exemption %s', (prefix, pathname) => {
    stubWindowLocation(pathname, '?state=1', undefined);
    expect(loginRedirectTarget()).toBeNull();
  });
});

describe('handleSessionExpiredError', () => {
  it('assigns /login?next=<current path> exactly once for 401s', async () => {
    const assign = vi.fn();
    stubWindowLocation('/dashboard', '', assign);
    vi.resetModules();
    const { HttpStatusError } = await import('../errors');
    const { handleSessionExpiredError } = await import('../session-expiry');

    handleSessionExpiredError(new HttpStatusError('expired', 401));
    handleSessionExpiredError(new HttpStatusError('expired-2', 401));

    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith('/login?next=%2Fdashboard');
  });

  it('does not navigate for non-401 errors or on public paths', async () => {
    const assign = vi.fn();
    stubWindowLocation('/login', '', assign);
    vi.resetModules();
    const { HttpStatusError } = await import('../errors');
    const { handleSessionExpiredError } = await import('../session-expiry');

    handleSessionExpiredError(new HttpStatusError('Forbidden', 403));
    handleSessionExpiredError(new Error('no status'));
    handleSessionExpiredError(new HttpStatusError('expired', 401));

    expect(assign).not.toHaveBeenCalled();
  });
});

describe('notifyIfSessionExpired — swallowed mutation failures', () => {
  function response(status: number): Response {
    return { ok: status >= 200 && status < 300, status, json: async () => ({ success: false, error: 'nope' }) } as unknown as Response;
  }

  it('redirects once when a swallowed mutation response is a 401', async () => {
    const assign = vi.fn();
    stubWindowLocation('/persona', '', assign);
    vi.resetModules();
    const { notifyIfSessionExpired } = await import('../session-expiry');

    notifyIfSessionExpired(response(401));
    notifyIfSessionExpired(response(401));

    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith('/login?next=%2Fpersona');
  });

  it('does not navigate for non-401 swallowed responses', async () => {
    const assign = vi.fn();
    stubWindowLocation('/persona', '', assign);
    vi.resetModules();
    const { notifyIfSessionExpired } = await import('../session-expiry');

    notifyIfSessionExpired(response(403));
    notifyIfSessionExpired(response(500));

    expect(assign).not.toHaveBeenCalled();
  });

  it('deletePersona on a 401 still returns its failure object and triggers the redirect', async () => {
    const assign = vi.fn();
    stubWindowLocation('/persona', '', assign);
    vi.resetModules();
    const { deletePersona } = await import('../api');

    vi.stubGlobal('fetch', vi.fn(async () => response(401)));
    const result = await deletePersona('p-1');

    expect(result.success).toBe(false);
    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith('/login?next=%2Fpersona');
  });

  it('fetchDeletePreview on a 401 still returns its failure object and triggers the redirect', async () => {
    const assign = vi.fn();
    stubWindowLocation('/persona', '', assign);
    vi.resetModules();
    const { fetchDeletePreview } = await import('../api');

    vi.stubGlobal('fetch', vi.fn(async () => response(401)));
    const result = await fetchDeletePreview('p-1');

    expect(result.success).toBe(false);
    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith('/login?next=%2Fpersona');
  });

});
