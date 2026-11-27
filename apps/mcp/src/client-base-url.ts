const PRODUCTION_API_URL = 'https://post-engineer.com';

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
  return url.origin + url.pathname.replace(/\/+$/, '');
}
