import { describe, it, expect, vi } from 'vitest';

import { HttpStatusError } from '../errors';
import {
  currentRelativePath,
  isSessionExpiredError,
  loginRedirectTarget,
} from '../session-expiry';

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
  ])('returns null on %s', (_name, pathname, search) => {
    stubWindowLocation(pathname, search, undefined);
    expect(loginRedirectTarget()).toBeNull();
  });
});

//---------------
// The full handler: react once to a 401, never on other failures. The module
// keeps a "redirecting" latch, so each case needing a fresh latch re-imports
// the module after vi.resetModules.
//---------------
describe('handleSessionExpiredError', () => {
  it('assigns /login?next=<current path> exactly once for 401s', async () => {
    const assign = vi.fn();
    stubWindowLocation('/dashboard', '', assign);
    vi.resetModules();
    // The handler checks `instanceof HttpStatusError`: after resetModules that
    // class must be the fresh copy this module graph re-imports, not the
    // statically imported one at the top of this file.
    const { HttpStatusError } = await import('../errors');
    const { handleSessionExpiredError } = await import('../session-expiry');

    handleSessionExpiredError(new HttpStatusError('expired', 401));
    // A second concurrent 401 must not fire a second navigation.
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
    handleSessionExpiredError(new HttpStatusError('expired', 401)); // 401 but already on /login

    expect(assign).not.toHaveBeenCalled();
  });
});

//---------------
// Mutation fetchers swallow failures into { success: false } (see lib/api.ts),
// so the 401 detection runs on the swallowed HTTP response instead. Each case
// uses a fresh module graph (fresh latch) and stubs fetch.
//---------------
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
    // A second concurrent swallow must not fire a second navigation.
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

  it('updatePersonaImage on a 401 still returns its failure object and triggers the redirect', async () => {
    const assign = vi.fn();
    stubWindowLocation('/persona', '', assign);
    vi.resetModules();
    const { updatePersonaImage } = await import('../api');

    vi.stubGlobal('fetch', vi.fn(async () => response(401)));
    const result = await updatePersonaImage({ id: 'img-1' });

    expect(result.success).toBe(false);
    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith('/login?next=%2Fpersona');
  });
});
