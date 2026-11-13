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

// isPublicIp mirrors CPython ipaddress is_global, the engine's SSRF rule
// (apps/engine/app/utils/ssrf.py checks ip.is_global): an address counts as
// public only when Python reports it globally reachable. The one deliberate
// divergence is multicast (224.0.0.0/4, ff00::/8): Python reports it global,
// the web blocks it anyway — stricter than the engine, never looser.
// Pinned by shared/ssrf/public-ip-cases.json via
// lib/generation/__tests__/public-ip-ssrf-sync.test.ts.
export function isPublicIp(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return isPublicIpv4(ip);
  if (family === 6) return isPublicIpv6(ip);
  return false;
}

function isPublicIpv4(ip: string): boolean {
  const [a, b, c, d] = ip.split('.').map(Number);
  if (a === 0 || a === 127) return false; // 0.0.0.0/8 "this network" + 127.0.0.0/8 loopback
  if (a === 10) return false; // 10.0.0.0/8
  if (a === 100 && b >= 64 && b <= 127) return false; // 100.64.0.0/10 shared address space
  if (a === 169 && b === 254) return false; // 169.254.0.0/16 link-local (cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return false; // 172.16.0.0/12
  if (a === 192 && b === 0 && c === 0) {
    // 192.0.0.0/24 IETF protocol assignments; Python exempts the two
    // anycast addresses below, and is_global follows it, so they stay public.
    return d === 9 || d === 10;
  }
  if (a === 192 && b === 0 && c === 2) return false; // 192.0.2.0/24 documentation
  if (a === 192 && b === 168) return false; // 192.168.0.0/16
  if (a === 198 && (b === 18 || b === 19)) return false; // 198.18.0.0/15 benchmarking
  if (a === 198 && b === 51 && c === 100) return false; // 198.51.100.0/24 documentation
  if (a === 203 && b === 0 && c === 113) return false; // 203.0.113.0/24 documentation
  if (a >= 224) return false; // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved (incl. broadcast)
  return true;
}

function ipv6ToBigInt(ip: string): bigint | null {
  let addr = ip.toLowerCase();
  if (addr.includes('.')) {
    // Embedded IPv4 tail (e.g. ::ffff:8.8.8.8) becomes two hex groups.
    const lastColon = addr.lastIndexOf(':');
    if (lastColon === -1) return null;
    const octets = addr.slice(lastColon + 1).split('.').map(Number);
    if (octets.length !== 4 || octets.some((o) => Number.isNaN(o))) return null;
    const hi = ((octets[0] << 8) | octets[1]).toString(16);
    const lo = ((octets[2] << 8) | octets[3]).toString(16);
    addr = `${addr.slice(0, lastColon)}:${hi}:${lo}`;
  }
  const halves = addr.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] === '' ? [] : halves[0].split(':');
  const tail = halves.length === 2 ? (halves[1] === '' ? [] : halves[1].split(':')) : [];
  if (halves.length === 1 && head.length !== 8) return null;
  if (head.length + tail.length > 8) return null;
  const groups = [...head, ...Array<string>(8 - head.length - tail.length).fill('0'), ...tail];
  let value = 0n;
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
    value = (value << 16n) | BigInt(parseInt(group, 16));
  }
  return value;
}

function inIpv6Network(addr: bigint, network: string, prefixLen: number): boolean {
  const net = ipv6ToBigInt(network);
  if (net === null) return false;
  const shift = BigInt(128 - prefixLen);
  return (addr >> shift) === (net >> shift);
}

const IPV6_NON_GLOBAL: ReadonlyArray<readonly [string, number]> = [
  ['::', 128], // unspecified
  ['::1', 128], // loopback
  ['64:ff9b:1::', 48], // local-use NAT64
  ['100::', 64], // discard-only
  ['2001::', 23], // Teredo / benchmarking / orchestid and peers (see exceptions)
  ['2001:db8::', 32], // documentation
  ['2002::', 16], // 6to4
  ['3fff::', 20], // documentation
  ['fc00::', 7], // unique-local
  ['fe80::', 10], // link-local
  ['ff00::', 8], // multicast (blocked beyond Python, see header note)
];

// Subnets of 2001::/23 that Python still reports global.
const IPV6_GLOBAL_EXCEPTIONS: ReadonlyArray<readonly [string, number]> = [
  ['2001:1::1', 128],
  ['2001:1::2', 128],
  ['2001:3::', 32],
  ['2001:4:112::', 48],
  ['2001:20::', 28],
  ['2001:30::', 28],
];

function isPublicIpv6(ip: string): boolean {
  const addr = ipv6ToBigInt(ip);
  if (addr === null) return false;
  if ((addr >> 32n) === 0xffffn) {
    // IPv4-mapped address: Python derives globality from the embedded IPv4.
    const mapped = [24, 16, 8, 0].map((shift) => Number((addr >> BigInt(shift)) & 0xffn)).join('.');
    return isPublicIpv4(mapped);
  }
  if (IPV6_GLOBAL_EXCEPTIONS.some(([net, len]) => inIpv6Network(addr, net, len))) return true;
  if (IPV6_NON_GLOBAL.some(([net, len]) => inIpv6Network(addr, net, len))) return false;
  return true;
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
