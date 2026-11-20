import { isLocalHostname } from '@/lib/oauth-utils';
import { isOwnVercelPreviewHost } from '@/lib/vercel-preview-host';

const AUTH_CALLBACK_PATH = '/auth/callback';

function parseAbsoluteUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

export function isCodeRelayTarget(value: string): boolean {
  const target = parseAbsoluteUrl(value);
  if (target === null) return false;
  if (target.username !== '' || target.password !== '') return false;
  if (target.pathname !== AUTH_CALLBACK_PATH || target.hash !== '') return false;
  if (target.protocol === 'https:') {
    return target.port === '' && isOwnVercelPreviewHost(target.hostname);
  }
  if (target.protocol === 'http:') return isLocalHostname(target.hostname);
  return false;
}
