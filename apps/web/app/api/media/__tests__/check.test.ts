// @vitest-environment node
//---------------
// Tests for POST /api/media/check (MCP check_media).
//
// The route authenticates the caller and proxies to the engine's
// /api/v1/media/check with the server secret; the engine runs the
// SSRF-safe download and the mechanical checks. The response carries
// only the code — never the checked URL.
//---------------

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextResponse } from 'next/server';

vi.mock('@/lib/request-auth', () => ({
  requireSupabaseSession: vi.fn(),
  engineAuthHeaders: vi.fn(() => ({})),
}));
vi.mock('@/lib/rate-limit', () => ({
  applyRateLimit: vi.fn(async () => null),
  RATE_LIMITS: { mediaUpload: {} },
}));
vi.mock('@/lib/posthog-server', () => ({
  getPostHogServer: vi.fn(() => ({ capture: vi.fn(), captureAs: vi.fn() })),
}));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { POST } from '../check/route';
import { requireSupabaseSession } from '@/lib/request-auth';

function checkRequest(url: string, videoAspect?: string): Request {
  return new Request('https://post-engineer.com/api/media/check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(
      videoAspect === undefined ? { url } : { url, videoAspect },
    ),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireSupabaseSession).mockResolvedValue({
    auth: { userId: 'user-uuid-1', accessToken: 'token' },
    error: null,
  } as never);
  vi.stubEnv('MONEYPRINT_API_URL', 'https://engine.test');
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ status: 200, body: { code: 'face_detected' } }),
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('POST /api/media/check', () => {
  it('returns only the engine code, never the checked URL', async () => {
    const url = 'https://e.com/porto.jpg?token=secret-value';
    const response = await POST(checkRequest(url));
    expect(response.status).toBe(200);
    const payload = (await response.json()) as Record<string, unknown>;
    expect(payload.success).toBe(true);
    expect(payload.code).toBe('face_detected');
    expect(JSON.stringify(payload)).not.toContain('secret-value');
    const fetchCall = vi.mocked(global.fetch).mock.calls[0];
    expect(fetchCall?.[0]).toBe('https://engine.test/api/v1/media/check');
    expect(JSON.parse(String(fetchCall?.[1]?.body))).toEqual({ url });
  });

  it('forwards videoAspect and passes wrong_aspect with dimensions through', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: 200, body: { code: 'wrong_aspect', width: 1920, height: 1080 } }),
    } as never);
    const response = await POST(checkRequest('https://e.com/porto.jpg', '9:16'));
    expect(response.status).toBe(200);
    const payload = (await response.json()) as Record<string, unknown>;
    expect(payload.code).toBe('wrong_aspect');
    expect(payload.width).toBe(1920);
    expect(payload.height).toBe(1080);
    const fetchCall = vi.mocked(global.fetch).mock.calls[0];
    expect(JSON.parse(String(fetchCall?.[1]?.body))).toEqual({
      url: 'https://e.com/porto.jpg',
      video_aspect: '9:16',
    });
  });

  it('forwards a square aspect: the engine contract includes 1:1', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: 200, body: { code: 'ok', width: 1080, height: 1080 } }),
    } as never);
    const response = await POST(checkRequest('https://e.com/porto.jpg', '1:1'));
    expect(response.status).toBe(200);
    const fetchCall = vi.mocked(global.fetch).mock.calls[0];
    expect(JSON.parse(String(fetchCall?.[1]?.body))).toEqual({
      url: 'https://e.com/porto.jpg',
      video_aspect: '1:1',
    });
  });

  it('passes an expired media id code through instead of a 502', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: 200, body: { code: 'media_expired', width: null, height: null } }),
    } as never);
    const response = await POST(checkRequest('https://e.com/porto.jpg'));
    expect(response.status).toBe(200);
    const payload = (await response.json()) as Record<string, unknown>;
    expect(payload.code).toBe('media_expired');
  });

  it('rejects an unknown videoAspect before calling the engine', async () => {
    const response = await POST(checkRequest('https://e.com/porto.jpg', '4:3'));
    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('rejects a non-http URL before calling the engine', async () => {
    const response = await POST(checkRequest('ftp://e.com/porto.jpg'));
    expect(response.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns 502 when the engine check fails', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({ ok: false, json: async () => ({}) } as never);
    const response = await POST(checkRequest('https://e.com/porto.jpg'));
    expect(response.status).toBe(502);
  });

  it('returns 502 when the engine returns an unknown code', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: 200, body: { code: 'maybe' } }),
    } as never);
    const response = await POST(checkRequest('https://e.com/porto.jpg'));
    expect(response.status).toBe(502);
  });

  it('rejects unauthenticated callers before calling the engine', async () => {
    vi.mocked(requireSupabaseSession).mockResolvedValueOnce({
      auth: null,
      error: NextResponse.json({ success: false, error: 'Authentication required.' }, { status: 401 }),
    } as never);
    const response = await POST(checkRequest('https://e.com/porto.jpg'));
    expect(response.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
