import { isLocalHostname } from '@/lib/oauth-utils';

export const REDIRECT_URI_NOT_ALLOWED = 'redirect_uri is not allowed.';

export function redirectUriAllowed(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (parsed.hash && parsed.hash.length > 0) return false;
  if (parsed.protocol === 'https:') return true;
  if (parsed.protocol === 'http:' && isLocalHostname(parsed.hostname)) return true;
  return false;
}

export function clientRedirectUrl(
  redirectUri: string,
  params: Record<string, string | undefined>,
): URL | null {
  if (!redirectUriAllowed(redirectUri)) return null;
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value.length > 0) url.searchParams.set(key, value);
  }
  return url;
}
