import { HttpStatusError } from './errors';

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

export function notifyIfSessionExpired(response: Response): void {
  if (response.status !== 401) return;
  handleSessionExpiredError(new HttpStatusError('Session expired', 401));
}
