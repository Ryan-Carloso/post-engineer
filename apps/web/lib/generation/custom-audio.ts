import { lookup } from 'node:dns/promises';

import { logger } from '@/lib/logger';
import { requestPinned } from '@/lib/ssrf/pinned-request';
import { resolvePublicHost } from '@/lib/ssrf/resolve-public-host';

export { isPublicIp, unbracketIpLiteral } from '@/lib/ssrf/public-ip';

export const MAX_CUSTOM_AUDIO_BYTES = 20 * 1024 * 1024;
export const CUSTOM_AUDIO_HEAD_TIMEOUT_MS = 10_000;
export const SSRF_MAX_REDIRECTS = 5;

export type CustomAudioCheck = { ok: true } | { ok: false; error: string };

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

const NOT_PUBLIC =
  'audio_url must use a public address — private/internal URLs are not allowed ' +
  '(e.g. 127.0.0.1, 10.x.x.x, 169.254.169.254). Use a publicly accessible audio file.';

async function checkUrlIsPublic(
  url: string,
): Promise<{ ok: true; addresses: string[] } | { ok: false; error: string }> {
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return { ok: false, error: 'audio_url must be a valid http(s) URL.' };
  }
  const safety = await resolvePublicHost(hostname, (host, options) => lookup(host, options));
  if (!safety.ok) {
    if (safety.reason === 'unresolved') {
      return { ok: false, error: 'audio_url host could not be resolved. Use a publicly accessible audio file.' };
    }
    return { ok: false, error: NOT_PUBLIC };
  }
  return { ok: true, addresses: safety.addresses };
}

function redactUrlForLog(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.search = '';
    return parsed.toString();
  } catch {
    return '[unparseable url]';
  }
}

export async function checkCustomAudioUrl(url: string): Promise<CustomAudioCheck> {
  let current = url;
  for (let hop = 0; hop <= SSRF_MAX_REDIRECTS; hop++) {
    const safety = await checkUrlIsPublic(current);
    if (!safety.ok) return safety;

    let head: Response;
    try {
      head = await requestPinned(current, safety.addresses, {
        method: 'HEAD',
        timeoutMs: CUSTOM_AUDIO_HEAD_TIMEOUT_MS,
      });
    } catch (err) {
      logger.warn('[custom-audio] audio_url unreachable in HEAD check', { url: redactUrlForLog(current), err });
      return { ok: false, error: 'audio_url must point to an accessible audio file.' };
    }

    const location = head.headers.get('location');
    if (head.status >= 300 && head.status < 400 && location) {
      let next: URL;
      try {
        next = new URL(location, current);
      } catch {
        return { ok: false, error: 'audio_url has an invalid redirect target.' };
      }
      if (next.protocol !== 'http:' && next.protocol !== 'https:') {
        return { ok: false, error: 'audio_url must redirect to an http(s) URL.' };
      }
      if (hop === SSRF_MAX_REDIRECTS) {
        return { ok: false, error: 'audio_url redirected too many times.' };
      }
      current = next.toString();
      continue;
    }

    if (!head.ok) {
      return { ok: false, error: `audio_url returned HTTP ${head.status} during verification.` };
    }
    const contentType = head.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? '';
    if (!contentType.startsWith('audio/')) {
      return {
        ok: false,
        error: `audio_url must point to an audio file (content-type: ${contentType || 'unknown'}).`,
      };
    }
    const contentLength = Number(head.headers.get('content-length'));
    if (!Number.isFinite(contentLength) || contentLength <= 0) {
      return { ok: false, error: 'audio_url must report a valid content-length.' };
    }
    if (contentLength > MAX_CUSTOM_AUDIO_BYTES) {
      return {
        ok: false,
        error: `audio_url exceeds the ${MAX_CUSTOM_AUDIO_BYTES / 1024 / 1024} MB size limit.`,
      };
    }
    return { ok: true };
  }
  return { ok: false, error: 'audio_url redirected too many times.' };
}
