import { describe, it, expect } from 'vitest';
import { createHttpRateLimiter } from '../http-rate-limit.js';

describe('createHttpRateLimiter', () => {
  it('allows requests up to the limit within one window', () => {
    const limiter = createHttpRateLimiter({ limit: 3, windowMs: 60_000, now: () => 0 });
    expect(limiter.check('user-1').allowed).toBe(true);
    expect(limiter.check('user-1').allowed).toBe(true);
    expect(limiter.check('user-1').allowed).toBe(true);
    const blocked = limiter.check('user-1');
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBe(60);
  });

  it('limits per key, so one subject cannot starve another', () => {
    const limiter = createHttpRateLimiter({ limit: 1, windowMs: 60_000, now: () => 0 });
    expect(limiter.check('user-1').allowed).toBe(true);
    expect(limiter.check('user-1').allowed).toBe(false);
    expect(limiter.check('user-2').allowed).toBe(true);
  });

  it('opens a fresh window once the old window expires', () => {
    let now = 0;
    const limiter = createHttpRateLimiter({ limit: 1, windowMs: 60_000, now: () => now });
    expect(limiter.check('user-1').allowed).toBe(true);
    expect(limiter.check('user-1').allowed).toBe(false);
    now = 60_001;
    expect(limiter.check('user-1').allowed).toBe(true);
  });

  it('reports the remaining window seconds while blocked', () => {
    let now = 0;
    const limiter = createHttpRateLimiter({ limit: 1, windowMs: 60_000, now: () => now });
    limiter.check('user-1');
    now = 45_000;
    const blocked = limiter.check('user-1');
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBe(15);
  });
});
