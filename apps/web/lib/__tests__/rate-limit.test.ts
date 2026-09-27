import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/supabase/service', () => ({
  createSupabaseServiceClient: vi.fn(),
}));

import { applyRateLimit, getClientIp, RATE_LIMITS } from '@/lib/rate-limit';

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

    it('tracks identifiers independently', async () => {
      const profile = { name: 'test-id', limit: 1, windowMs: 60_000 };
      await applyRateLimit(makeRequest(), profile, 'ip-d');
      const other = await applyRateLimit(makeRequest(), profile, 'ip-e');
      expect(other).toBeNull();
    });

    it('exposes RATE_LIMITS profiles with sane values', () => {
      expect(RATE_LIMITS.youtubeUpload.limit).toBeGreaterThan(0);
      expect(RATE_LIMITS.mediaUpload.windowMs).toBeGreaterThan(0);
      expect(RATE_LIMITS.instagramPost.name).toBe('instagram-post');
    });

    it('exposes the auth/credential profiles added for the public release', () => {
      for (const key of [
        'oauthToken',
        'oauthRegister',
        'apiKeyManage',
        'blueskyConnect',
        'billingCheckout',
        'videoJob',
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
      // Attacker controls the first entry; the trusted proxy appends the real one last.
      const first = await applyRateLimit(
        makeRequest({ 'x-forwarded-for': 'spoofed-1, 10.20.30.40' }),
        profile,
      );
      expect(first).toBeNull();
      // Same real client, different spoofed first entry: same bucket → blocked.
      const second = await applyRateLimit(
        makeRequest({ 'x-forwarded-for': 'spoofed-2, 10.20.30.40' }),
        profile,
      );
      expect(second?.status).toBe(429);
    });
  });
});
