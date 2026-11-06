import { HttpStatusError } from './errors';

//---------------
// Global session-expiry handling: one host-wide reaction to any dashboard
// query failing with 401. The shared React Query defaults (lib/query-retry)
// no longer retry a 401, so the very first failed read surfaces the dead
// session; here the user is sent to /login once, and the loginCallback flow
// returns to the same screen afterwards via ?next=<current relative path>.
//---------------

/** Public paths reachable while logged out — never redirect from these.
 * Keep in sync with the middleware's publicPaths list (and its matcher's
 * auth/, oauth/ exemptions) — pinned by the sync test in
 * lib/__tests__/session-expiry.test.tsx. */
const PUBLIC_PATH_PREFIXES = ['/login', '/auth/', '/landing', '/privacy', '/terms', '/recipes', '/oauth/'];

export function isSessionExpiredError(error: unknown): boolean {
  return error instanceof HttpStatusError && error.status === 401;
}

export function currentRelativePath(): string | null {
  if (typeof window === 'undefined') return null;
  return window.location.pathname + window.location.search;
}

export function loginRedirectTarget(): string | null {
  const path = currentRelativePath();
  if (path === null) return null;
  if (PUBLIC_PATH_PREFIXES.some((prefix) => path.startsWith(prefix))) return null;
  return `/login?next=${encodeURIComponent(path)}`;
}

let redirecting = false;

export function handleSessionExpiredError(error: unknown): void {
  if (!isSessionExpiredError(error) || redirecting) return;
  const target = loginRedirectTarget();
  if (target === null) return;
  redirecting = true;
  window.location.assign(target);
}

//---------------
// Mutation fetchers swallow failures into { success: false, error } (the
// client-helper pattern in this repo), so a dead session can hide there
// without any exception reaching the QueryCache. Callers invoke this on
// every non-OK response before building the failure object; the same latch
// keeps it to a single navigation.
//---------------
export function notifyIfSessionExpired(response: Response): void {
  if (response.status !== 401) return;
  handleSessionExpiredError(new HttpStatusError('Session expired', 401));
}
