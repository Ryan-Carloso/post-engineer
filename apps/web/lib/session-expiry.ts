import { HttpStatusError } from './errors';

//---------------
// Global session-expiry handling: one host-wide reaction to any dashboard
// query failing with 401. The shared React Query defaults (lib/query-retry)
// no longer retry a 401, so the very first failed read surfaces the dead
// session; here the user is sent to /login once, and the loginCallback flow
// returns to the same screen afterwards via ?next=<current relative path>.
//---------------

/** Public paths reachable while logged out — never redirect from these. */
const PUBLIC_PATH_PREFIXES = ['/login', '/auth/', '/landing', '/privacy', '/terms'];

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
