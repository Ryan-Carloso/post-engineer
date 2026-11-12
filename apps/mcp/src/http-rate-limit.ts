// Per-key fixed-window rate limiter for the MCP HTTP endpoint (Phase 6,
// P6-2). Zero dependencies, in-memory only — same shape and same
// limitation as the web's rate-limit module: on a multi-instance deploy
// the limit is per instance, but it still blocks trivial abuse with no
// external service. Two limiters share this implementation: the
// per-subject limiter (key = verified token subject, checked after auth;
// the token owner pays for the videos, so the owner is who gets limited)
// and the pre-auth per-IP limiter below (key = client IP, checked before
// any JWKS verification so unauthenticated traffic cannot force
// unlimited asymmetric verifies).
import type { IncomingMessage } from 'node:http';
export interface HttpRateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export interface HttpRateLimiterOptions {
  limit: number;
  windowMs: number;
  /** Clock override for tests; defaults to the real clock. */
  now?: () => number;
}

export interface HttpRateLimiter {
  check(key: string): HttpRateLimitResult;
}

interface WindowCounter {
  count: number;
  windowStart: number;
}

export function createHttpRateLimiter(options: HttpRateLimiterOptions): HttpRateLimiter {
  const now = options.now ?? (() => Date.now());
  const counters = new Map<string, WindowCounter>();
  return {
    check(key: string): HttpRateLimitResult {
      const current = now();
      // Lazy cleanup: expired windows are dropped when found, so the
      // table tracks only subjects active in the current window.
      for (const [storedKey, counter] of counters) {
        if (current - counter.windowStart >= options.windowMs) {
          counters.delete(storedKey);
        }
      }
      const existing = counters.get(key);
      if (existing === undefined) {
        counters.set(key, { count: 1, windowStart: current });
        return { allowed: true, retryAfterSeconds: 0 };
      }
      existing.count += 1;
      if (existing.count <= options.limit) {
        return { allowed: true, retryAfterSeconds: 0 };
      }
      const remainingMs = existing.windowStart + options.windowMs - current;
      return { allowed: false, retryAfterSeconds: Math.ceil(remainingMs / 1000) };
    },
  };
}

// Default pre-auth budget per IP: deliberately above the per-subject
// limit (120/min) so one legitimate user is governed by the subject
// limiter, while an unauthenticated flood from one address is still
// bounded before any token verification runs.
export const PRE_AUTH_IP_LIMIT_PER_MINUTE = 300;
export const PRE_AUTH_IP_WINDOW_MS = 60_000;

// Pre-auth limiter factory: same fixed-window core as the per-subject
// limiter, keyed by client IP. Callers may override limit/window/clock.
export function createPreAuthIpRateLimiter(
  options: Partial<HttpRateLimiterOptions> = {},
): HttpRateLimiter {
  return createHttpRateLimiter({
    limit: options.limit ?? PRE_AUTH_IP_LIMIT_PER_MINUTE,
    windowMs: options.windowMs ?? PRE_AUTH_IP_WINDOW_MS,
    now: options.now,
  });
}

// Rate-limit key for one request. The public listener is published only
// on 127.0.0.1 and Caddy is the only path in, so the socket peer is the
// Docker gateway for every client. Use the same trust rule as the web
// limiter: the LAST X-Forwarded-For entry (the hop the edge proxy
// wrote; the proxy must overwrite the header, which Caddy does), then
// X-Real-IP, then the socket address. The first forwarded entry is
// client-controlled and is ignored. IPv4-mapped IPv6 peers
// (::ffff:a.b.c.d) normalize to the IPv4 form so one client cannot
// double its budget by alternating representations. Missing addresses
// share the 'unknown' bucket, which fails closed under flood.
function forwardedLast(value: string | string[] | undefined): string | undefined {
  if (value === undefined) return undefined;
  const raw = Array.isArray(value) ? value.join(',') : value;
  const entries = raw.split(',').map((entry) => entry.trim()).filter((entry) => entry.length > 0);
  return entries.length === 0 ? undefined : entries[entries.length - 1];
}

function normalizeIp(ip: string): string {
  return ip.startsWith('::ffff:') ? ip.slice('::ffff:'.length) : ip;
}

export function clientIpKey(req: Pick<IncomingMessage, 'socket' | 'headers'>): string {
  const forwarded = forwardedLast(req.headers?.['x-forwarded-for']);
  if (forwarded !== undefined) return normalizeIp(forwarded);
  const realIp = forwardedLast(req.headers?.['x-real-ip']);
  if (realIp !== undefined) return normalizeIp(realIp);
  const remote = req.socket?.remoteAddress;
  if (remote === undefined || remote === '') return 'unknown';
  return normalizeIp(remote);
}
