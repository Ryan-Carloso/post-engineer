// Per-key fixed-window rate limiter for the MCP HTTP endpoint (Phase 6,
// P6-2). Zero dependencies, in-memory only — same shape and same
// limitation as the web's rate-limit module: on a multi-instance deploy
// the limit is per instance, but it still blocks trivial abuse with no
// external service. The key is the verified token subject (per-user, as
// decided for P6-2), never an IP or a client id: it is the token owner
// who pays for the videos, so the owner is who gets limited.
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
