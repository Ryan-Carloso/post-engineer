//---------------
// custom-audio — SSRF-safe verification for per-video custom audio URLs.
//
// Moved here from app/api/persona/video-job/route.ts so the unified
// generate-and-schedule route reuses the exact same check. The audio URL
// is fetched server-side, so it must point to a public address: blocks
// private literal IPs, hostnames resolving to private IPs, and redirects
// to those destinations. Fail closed.
//---------------

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

import { logger } from '@/lib/logger';

export const MAX_CUSTOM_AUDIO_BYTES = 20 * 1024 * 1024; // 20 MB — fits 1 min of uncompressed audio
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

function isPublicIp(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) {
    const [a, b, c] = ip.split('.').map(Number);
    if (a === 0 || a === 127) return false; // "this network" + loopback
    if (a === 10) return false; // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return false; // 172.16.0.0/12
    if (a === 192 && b === 168) return false; // 192.168.0.0/16
    if (a === 169 && b === 254) return false; // 169.254.0.0/16 link-local (cloud metadata)
    if (a === 192 && b === 0 && c === 2) return false; // 192.0.2.0/24 documentation
    if (a === 198 && b === 51 && c === 100) return false; // 198.51.100.0/24 documentation
    if (a === 203 && b === 0 && c === 113) return false; // 203.0.113.0/24 documentation
    if (a >= 224) return false; // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved
    return true;
  }
  if (family === 6) {
    const normalized = ip.toLowerCase();
    if (normalized === '::1' || normalized === '::') return false;
    if (normalized.startsWith('::ffff:')) {
      return isPublicIp(normalized.slice('::ffff:'.length)); // mapped IPv4
    }
    const firstGroup = normalized.split(':')[0] ?? '';
    const first = parseInt(firstGroup, 16);
    if (Number.isNaN(first)) return false;
    if ((first & 0xffc0) === 0xfe80) return false; // fe80::/10 link-local
    if ((first & 0xfe00) === 0xfc00) return false; // fc00::/7 unique-local
    if ((first & 0xff00) === 0xff00) return false; // ff00::/8 multicast
    return true;
  }
  return false;
}

async function checkUrlIsPublic(url: string): Promise<CustomAudioCheck> {
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return { ok: false, error: 'audio_url must be a valid http(s) URL.' };
  }
  try {
    const addresses = isIP(hostname)
      ? [{ address: hostname }]
      : await lookup(hostname, { all: true });
    const allPublic = addresses.length > 0 && addresses.every((a) => isPublicIp(a.address));
    if (!allPublic) {
      return {
        ok: false,
        error:
          'audio_url must use a public address — private/internal URLs are not allowed ' +
          '(e.g. 127.0.0.1, 10.x.x.x, 169.254.169.254). Use a publicly accessible audio file.',
      };
    }
  } catch {
    return { ok: false, error: 'audio_url host could not be resolved. Use a publicly accessible audio file.' };
  }
  return { ok: true };
}

async function headWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CUSTOM_AUDIO_HEAD_TIMEOUT_MS);
  try {
    // codeql[js/request-forgery]: false positive — every URL reaching this
    // fetch passed checkUrlIsPublic (DNS resolution + private/loopback/
    // link-local IP rejection) on this hop, and redirects are followed
    // manually with the same check per hop (see checkCustomAudioUrl).
    return await fetch(url, { method: 'HEAD', redirect: 'manual', signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

// audio_url is commonly a pre-signed URL (?X-Amz-Signature=..., ?token=...).
// The query string carries credentials, so it must never land in server logs;
// origin + path stay so the log remains useful for debugging.
function redactUrlForLog(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.search = '';
    return parsed.toString();
  } catch {
    return '[unparseable url]';
  }
}

// Custom per-video audio: real audio files only. The max duration (60s,
// temporary product limit) is verified in the engine with ffprobe — here
// HEAD only guarantees type + size, before any token charge.
export async function checkCustomAudioUrl(url: string): Promise<CustomAudioCheck> {
  let current = url;
  for (let hop = 0; hop <= SSRF_MAX_REDIRECTS; hop++) {
    const safety = await checkUrlIsPublic(current);
    if (!safety.ok) return safety;

    let head: Response;
    try {
      head = await headWithTimeout(current);
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
