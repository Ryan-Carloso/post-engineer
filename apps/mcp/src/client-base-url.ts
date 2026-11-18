// Base-URL resolution for the Post Engineer API client.
//
// Extracted from client.ts so client.ts stays under the file-size ratchet.
// The bearer <redacted> is sent to this URL, so fail fast on a malformed or
// non-https override instead of silently targeting it. Loopback http is
// allowed for local staging; anything else must be https so the key never
// travels in cleartext.

export const PRODUCTION_API_URL = 'https://post-engineer.com';

export function resolveBaseUrl(override: string | undefined): string {
  const raw = override ?? PRODUCTION_API_URL;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('Invalid POST_ENGINEER_API_URL: not an absolute URL (use https:)');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`Invalid POST_ENGINEER_API_URL: protocol "${url.protocol}" is not allowed (use https:)`);
  }
  const loopback =
    url.hostname === 'localhost' ||
    url.hostname === '127.0.0.1' ||
    url.hostname === '::1' ||
    url.hostname === '[::1]';
  if (url.protocol === 'http:' && !loopback) {
    throw new Error('Invalid POST_ENGINEER_API_URL: http: is only allowed for loopback hosts (use https:)');
  }
  // Never echo the raw value: it may embed credentials (userinfo/query).
  // Return the normalized form so the validated value and the used value are
  // identical: origin drops userinfo, trailing slashes are stripped so
  // `${baseUrl}${path}` never yields `//api/...`.
  return url.origin + url.pathname.replace(/\/+$/, '');
}
