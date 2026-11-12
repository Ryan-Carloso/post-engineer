import { describe, it, expect } from 'vitest';
import {
  createHttpRateLimiter,
  createPreAuthIpRateLimiter,
  clientIpKey,
  PRE_AUTH_IP_LIMIT_PER_MINUTE,
} from '../http-rate-limit.js';

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

  it('keeps the per-subject limiter working alongside the IP limiter', () => {
    const subjectLimiter = createHttpRateLimiter({ limit: 1, windowMs: 60_000, now: () => 0 });
    const ipLimiter = createPreAuthIpRateLimiter({ limit: 5, windowMs: 60_000, now: () => 0 });
    expect(subjectLimiter.check('user-1').allowed).toBe(true);
    expect(subjectLimiter.check('user-1').allowed).toBe(false);
    expect(ipLimiter.check('203.0.113.1').allowed).toBe(true);
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

describe('createPreAuthIpRateLimiter', () => {
  it('limits per IP so one address cannot starve another', () => {
    const limiter = createPreAuthIpRateLimiter({ limit: 2, windowMs: 60_000, now: () => 0 });
    expect(limiter.check('203.0.113.1').allowed).toBe(true);
    expect(limiter.check('203.0.113.1').allowed).toBe(true);
    expect(limiter.check('203.0.113.1').allowed).toBe(false);
    expect(limiter.check('203.0.113.2').allowed).toBe(true);
  });

  it('defaults to a bounded per-minute limit', () => {
    expect(PRE_AUTH_IP_LIMIT_PER_MINUTE).toBeGreaterThan(0);
    const limiter = createPreAuthIpRateLimiter({ now: () => 0 });
    for (let i = 0; i < PRE_AUTH_IP_LIMIT_PER_MINUTE; i += 1) {
      expect(limiter.check('203.0.113.9').allowed).toBe(true);
    }
    expect(limiter.check('203.0.113.9').allowed).toBe(false);
  });
});

describe('clientIpKey', () => {
  it('uses the socket remote address and normalizes IPv4-mapped IPv6', () => {
    expect(clientIpKey({ socket: { remoteAddress: '203.0.113.7' } } as never)).toBe('203.0.113.7');
    expect(clientIpKey({ socket: { remoteAddress: '::ffff:203.0.113.7' } } as never)).toBe('203.0.113.7');
    expect(clientIpKey({ socket: { remoteAddress: '2001:db8::1' } } as never)).toBe('2001:db8::1');
  });

  it('buckets by the last forwarded hop, ignoring a spoofed first entry and the proxy socket', () => {
    const req = {
      socket: { remoteAddress: '172.17.0.1' },
      headers: { 'x-forwarded-for': '1.2.3.4, 203.0.113.7' },
    };
    expect(clientIpKey(req as never)).toBe('203.0.113.7');
    expect(clientIpKey({ socket: { remoteAddress: '172.17.0.1' }, headers: { 'x-forwarded-for': ['::ffff:198.51.100.10'] } } as never)).toBe('198.51.100.10');
  });

  it('falls back to x-real-ip, then the socket, then unknown', () => {
    expect(clientIpKey({ socket: { remoteAddress: '172.17.0.1' }, headers: { 'x-real-ip': '203.0.113.8' } } as never)).toBe('203.0.113.8');
    expect(clientIpKey({ socket: { remoteAddress: '203.0.113.7' }, headers: { 'x-forwarded-for': '   ' } } as never)).toBe('203.0.113.7');
    expect(clientIpKey({ socket: {} } as never)).toBe('unknown');
    expect(clientIpKey({} as never)).toBe('unknown');
  });
});
