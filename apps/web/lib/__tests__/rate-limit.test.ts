import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/service', () => ({
  createSupabaseServiceClient: vi.fn(),
}));

import { applyRateLimit, getClientIp, MAX_TRACKED_KEYS, RATE_LIMITS } from '@/lib/rate-limit';

function makeRequest(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost/api/test', {
    method: 'POST',
    headers,
  });
}

const g = globalThis as unknown as { __rateLimitStore?: Map<string, unknown> };

describe('rate-limit', () => {
  beforeEach(() => {
    g.__rateLimitStore = new Map();
  });

  describe('getClientIp', () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('prefers x-vercel-forwarded-for on Vercel (the platform-provided client IP)', () => {
      vi.stubEnv('VERCEL', '1');
      const req = makeRequest({
        'x-vercel-forwarded-for': '1.2.3.4',
        'x-forwarded-for': '9.9.9.9, 5.6.7.8',
      });
      expect(getClientIp(req)).toBe('1.2.3.4');
    });

    it('ignores x-vercel-forwarded-for off Vercel (client-controlled header)', () => {
      vi.stubEnv('VERCEL', '');
      const req = makeRequest({
        'x-vercel-forwarded-for': '1.2.3.4',
        'x-forwarded-for': '9.9.9.9, 5.6.7.8',
      });
      expect(getClientIp(req)).toBe('5.6.7.8');
    });

    it('ignores x-vercel-forwarded-for when VERCEL is unset', () => {
      const req = makeRequest({
        'x-vercel-forwarded-for': 'random-fresh-ip',
        'x-forwarded-for': '10.20.30.40',
      });
      expect(getClientIp(req)).toBe('10.20.30.40');
    });

    it('uses the last x-forwarded-for entry (trusted proxy side), never the first', () => {
      const req = makeRequest({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8' });
      expect(getClientIp(req)).toBe('5.6.7.8');
    });

    it('falls back to x-real-ip', () => {
      const req = makeRequest({ 'x-real-ip': '9.9.9.9' });
      expect(getClientIp(req)).toBe('9.9.9.9');
    });

    it('returns unknown when no headers', () => {
      expect(getClientIp(makeRequest())).toBe('unknown');
    });
  });

  describe('applyRateLimit', () => {
    it('allows requests under the limit', async () => {
      const profile = { name: 'test-under', limit: 3, windowMs: 60_000 };
      for (let i = 0; i < 3; i++) {
        const res = await applyRateLimit(makeRequest(), profile, 'ip-a');
        expect(res).toBeNull();
      }
    });

    it('blocks requests over the limit with 429', async () => {
      const profile = { name: 'test-over', limit: 2, windowMs: 60_000 };
      await applyRateLimit(makeRequest(), profile, 'ip-b');
      await applyRateLimit(makeRequest(), profile, 'ip-b');
      const res = await applyRateLimit(makeRequest(), profile, 'ip-b');
      expect(res).not.toBeNull();
      expect(res?.status).toBe(429);
      const body = (await res?.json()) as { errorType: string; retryAfterSeconds: number };
      expect(body.errorType).toBe('RATE_LIMITED');
      expect(body.retryAfterSeconds).toBeGreaterThan(0);
      expect(res?.headers.get('Retry-After')).toBeTruthy();
    });

    it('resets after the window expires', async () => {
      const profile = { name: 'test-window', limit: 1, windowMs: 50 };
      await applyRateLimit(makeRequest(), profile, 'ip-c');
      const blocked = await applyRateLimit(makeRequest(), profile, 'ip-c');
      expect(blocked?.status).toBe(429);

      await new Promise((r) => setTimeout(r, 60));
      const after = await applyRateLimit(makeRequest(), profile, 'ip-c');
      expect(after).toBeNull();
    });

    it('answers with the profile message when the profile carries one', async () => {
      const profile = { name: 'test-message', limit: 1, windowMs: 60_000, message: 'Poll at most once per minute.' };
      await applyRateLimit(makeRequest(), profile, 'ip-m');
      const res = await applyRateLimit(makeRequest(), profile, 'ip-m');
      const body = (await res?.json()) as { error: string; errorType: string };
      expect(body.error).toBe('Poll at most once per minute.');
      expect(body.errorType).toBe('RATE_LIMITED');
    });

    it('answers with the generic message when the profile carries none', async () => {
      const profile = { name: 'test-generic', limit: 1, windowMs: 60_000 };
      await applyRateLimit(makeRequest(), profile, 'ip-n');
      const res = await applyRateLimit(makeRequest(), profile, 'ip-n');
      const body = (await res?.json()) as { error: string };
      expect(body.error).toBe('Too many requests. Please wait before trying again.');
    });

    it('tracks identifiers independently', async () => {
      const profile = { name: 'test-id', limit: 1, windowMs: 60_000 };
      await applyRateLimit(makeRequest(), profile, 'ip-d');
      const other = await applyRateLimit(makeRequest(), profile, 'ip-e');
      expect(other).toBeNull();
    });

    it('exposes RATE_LIMITS profiles with sane values', () => {
      expect(RATE_LIMITS.youtubeUpload.limit).toBeGreaterThan(0);
      expect(RATE_LIMITS.youtubeUpload.windowMs).toBeGreaterThan(0);
      expect(RATE_LIMITS.instagramPost.name).toBe('instagram-post');
      expect(RATE_LIMITS.slotApprove).toEqual({ name: 'slot-approve', limit: 30, windowMs: 60_000 });
    });

    it('exposes the auth/credential profiles added for the public release', () => {
      for (const key of [
        'oauthToken',
        'oauthRegister',
        'apiKeyManage',
        'blueskyConnect',
        'connectUrl',
        'oauthStart',
      ] as const) {
        expect(RATE_LIMITS[key].limit).toBeGreaterThan(0);
        expect(RATE_LIMITS[key].windowMs).toBeGreaterThan(0);
        expect(typeof RATE_LIMITS[key].name).toBe('string');
      }
    });

    it('429s an auth profile after its limit is exhausted', async () => {
      vi.stubEnv('VERCEL', '1');
      const profile = RATE_LIMITS.oauthToken;
      const headers = { 'x-vercel-forwarded-for': '10.9.9.9' };
      for (let i = 0; i < profile.limit; i++) {
        const res = await applyRateLimit(makeRequest(headers), profile);
        expect(res).toBeNull();
      }
      const blocked = await applyRateLimit(makeRequest(headers), profile);
      expect(blocked?.status).toBe(429);
    });

    it('spoofing the first x-forwarded-for entry cannot reset the bucket', async () => {
      const profile = { name: 'test-spoof', limit: 1, windowMs: 60_000 };
      const first = await applyRateLimit(
        makeRequest({ 'x-forwarded-for': 'spoofed-1, 10.20.30.40' }),
        profile,
      );
      expect(first).toBeNull();
      const second = await applyRateLimit(
        makeRequest({ 'x-forwarded-for': 'spoofed-2, 10.20.30.40' }),
        profile,
      );
      expect(second?.status).toBe(429);
    });
  });

  describe('table eviction', () => {
    const START = 1_800_000_000_000;
    let now = START;

    beforeEach(() => {
      now = START;
      vi.spyOn(Date, 'now').mockImplementation(() => now);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    async function fill(profile: { name: string; limit: number; windowMs: number }, count: number, prefix: string): Promise<void> {
      for (let i = 0; i < count; i++) {
        await applyRateLimit(makeRequest(), profile, `${prefix}-${i}`);
      }
    }

    it('keeps every live counter except the least recently used one when the table is full', async () => {
      const profile = { name: 'test-full', limit: 1, windowMs: 60_000 };
      await applyRateLimit(makeRequest(), profile, 'victim');
      await fill(profile, MAX_TRACKED_KEYS - 1, 'filler');
      expect(g.__rateLimitStore?.size).toBe(MAX_TRACKED_KEYS);
      expect((await applyRateLimit(makeRequest(), profile, 'victim'))?.status).toBe(429);

      await applyRateLimit(makeRequest(), profile, 'newcomer');

      expect(g.__rateLimitStore?.size).toBe(MAX_TRACKED_KEYS);
      expect(g.__rateLimitStore?.has('test-full:filler-0')).toBe(false);
      expect((await applyRateLimit(makeRequest(), profile, 'victim'))?.status).toBe(429);
      expect((await applyRateLimit(makeRequest(), profile, 'filler-5'))?.status).toBe(429);
      expect((await applyRateLimit(makeRequest(), profile, 'newcomer'))?.status).toBe(429);
    });

    it('evicts the least recently used entry when every entry is still live', async () => {
      const profile = { name: 'test-lru', limit: 1, windowMs: 60_000 };
      const watched = { name: 'test-lru', limit: 5, windowMs: 60_000 };
      await applyRateLimit(makeRequest(), watched, 'oldest-but-touched');
      await fill(profile, MAX_TRACKED_KEYS - 1, 'filler');
      await applyRateLimit(makeRequest(), watched, 'oldest-but-touched');

      await applyRateLimit(makeRequest(), profile, 'newcomer');

      expect(g.__rateLimitStore?.has('test-lru:oldest-but-touched')).toBe(true);
      expect(g.__rateLimitStore?.has('test-lru:filler-0')).toBe(false);
      expect(g.__rateLimitStore?.has('test-lru:filler-1')).toBe(true);
    });

    it('sweeps entries expired by their own window before evicting live ones', async () => {
      const short = { name: 'test-short', limit: 1, windowMs: 1_000 };
      const long = { name: 'test-long', limit: 1, windowMs: 60_000 };
      await fill(long, 10, 'live');
      await fill(short, MAX_TRACKED_KEYS - 10, 'stale');
      now += 2_000;

      await applyRateLimit(makeRequest(), long, 'newcomer');

      expect(g.__rateLimitStore?.size).toBe(11);
      expect((await applyRateLimit(makeRequest(), long, 'live-0'))?.status).toBe(429);
    });

    it('does not evict 1h-window entries when a 60s-window request fills the table', async () => {
      const hourly = { name: 'test-hourly', limit: 1, windowMs: 60 * 60 * 1000 };
      const minute = { name: 'test-minute', limit: 1, windowMs: 60_000 };
      await applyRateLimit(makeRequest(), hourly, 'victim');
      await fill(minute, MAX_TRACKED_KEYS - 1, 'filler');
      now += 5 * 60_000;

      await applyRateLimit(makeRequest(), minute, 'newcomer');

      expect(g.__rateLimitStore?.has('test-hourly:victim')).toBe(true);
      expect((await applyRateLimit(makeRequest(), hourly, 'victim'))?.status).toBe(429);
      expect(g.__rateLimitStore?.size).toBe(2);
    });

    it('keeps a long-window counter blocked after a shorter time than its window', async () => {
      const hourly = { name: 'test-hourly-window', limit: 1, windowMs: 60 * 60 * 1000 };
      await applyRateLimit(makeRequest(), hourly, 'user');
      now += 30 * 60_000;
      const blocked = await applyRateLimit(makeRequest(), hourly, 'user');
      expect(blocked?.status).toBe(429);
      expect(blocked?.headers.get('Retry-After')).toBe(String(30 * 60));
      now += 30 * 60_000;
      expect(await applyRateLimit(makeRequest(), hourly, 'user')).toBeNull();
    });
  });

  describe('client address buckets', () => {
    it('shares one bucket between two IPv6 addresses of one /64', async () => {
      const profile = { name: 'test-v6', limit: 1, windowMs: 60_000 };
      expect(await applyRateLimit(makeRequest({ 'x-forwarded-for': '2001:db8:1:2::1' }), profile)).toBeNull();
      const second = await applyRateLimit(makeRequest({ 'x-forwarded-for': '2001:db8:1:2:aaaa:bbbb:cccc:dddd' }), profile);
      expect(second?.status).toBe(429);
    });

    it('keeps IPv6 addresses of different /64 prefixes apart', async () => {
      const profile = { name: 'test-v6-apart', limit: 1, windowMs: 60_000 };
      expect(await applyRateLimit(makeRequest({ 'x-forwarded-for': '2001:db8:1:2::1' }), profile)).toBeNull();
      expect(await applyRateLimit(makeRequest({ 'x-forwarded-for': '2001:db8:1:3::1' }), profile)).toBeNull();
    });

    it('counts an IPv4-mapped IPv6 address against the IPv4 bucket', async () => {
      const profile = { name: 'test-v4-mapped', limit: 1, windowMs: 60_000 };
      expect(await applyRateLimit(makeRequest({ 'x-forwarded-for': '1.2.3.4' }), profile)).toBeNull();
      const mapped = await applyRateLimit(makeRequest({ 'x-forwarded-for': '::ffff:1.2.3.4' }), profile);
      expect(mapped?.status).toBe(429);
    });

    it('keeps distinct IPv4 addresses apart', async () => {
      const profile = { name: 'test-v4', limit: 1, windowMs: 60_000 };
      expect(await applyRateLimit(makeRequest({ 'x-forwarded-for': '1.2.3.4' }), profile)).toBeNull();
      expect(await applyRateLimit(makeRequest({ 'x-forwarded-for': '1.2.3.5' }), profile)).toBeNull();
    });

    it('never buckets an explicit identifier', async () => {
      const profile = { name: 'test-explicit', limit: 1, windowMs: 60_000 };
      await applyRateLimit(makeRequest(), profile, '2001:db8:1:2::1');
      expect(g.__rateLimitStore?.has('test-explicit:2001:db8:1:2::1')).toBe(true);
    });
  });
});
