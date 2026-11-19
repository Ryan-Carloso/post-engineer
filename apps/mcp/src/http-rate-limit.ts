import type { IncomingMessage } from 'node:http';
export interface HttpRateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export interface HttpRateLimiterOptions {
  limit: number;
  windowMs: number;
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

export const PRE_AUTH_IP_LIMIT_PER_MINUTE = 300;
export const PRE_AUTH_IP_WINDOW_MS = 60_000;

export function createPreAuthIpRateLimiter(
  options: Partial<HttpRateLimiterOptions> = {},
): HttpRateLimiter {
  return createHttpRateLimiter({
    limit: options.limit ?? PRE_AUTH_IP_LIMIT_PER_MINUTE,
    windowMs: options.windowMs ?? PRE_AUTH_IP_WINDOW_MS,
    now: options.now,
  });
}

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
