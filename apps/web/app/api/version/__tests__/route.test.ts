import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { GET } from '../route';

vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(() => 'test-error-id'),
    warn: vi.fn(() => 'test-error-id'),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@/lib/posthog-server', () => ({
  getPostHogServer: vi.fn(() => null),
  flushPostHog: vi.fn(async () => {}),
}));

const ENGINE_URL = 'https://engine.example.com';

function mockFetchOnce(response: { ok: boolean; status: number; json: () => Promise<unknown> }) {
  const fetchMock = vi.fn(async () => response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('GET /api/version', () => {
  beforeEach(() => {
    vi.stubEnv('MONEYPRINT_API_URL', ENGINE_URL);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('proxies the engine /version payload verbatim', async () => {
    const fetchMock = mockFetchOnce({
      ok: true,
      status: 200,
      json: async () => ({ version: '1.28.152', pr: 152, build: 152, commit: '8f31abc' }),
    });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      version: '1.28.152',
      pr: 152,
      build: 152,
      commit: '8f31abc',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `${ENGINE_URL}/version`,
      expect.objectContaining({ cache: 'no-store', signal: expect.any(AbortSignal) }),
    );
  });

  it('passes through a payload without a PR number (build-only engine)', async () => {
    mockFetchOnce({
      ok: true,
      status: 200,
      json: async () => ({ version: '1.8.0', build: 502, commit: 'abc123' }),
    });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      version: '1.8.0',
      pr: null,
      build: 502,
      commit: 'abc123',
    });
  });

  it('returns 502 with engine_unreachable when the engine is down', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('fetch failed');
      }),
    );
    const res = await GET();
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.code).toBe('engine_unreachable');
  });

  it('returns 502 when the engine answers non-ok', async () => {
    mockFetchOnce({ ok: false, status: 500, json: async () => ({}) });
    const res = await GET();
    expect(res.status).toBe(502);
    expect((await res.json()).code).toBe('engine_unreachable');
  });

  it('returns 502 when the engine payload is malformed', async () => {
    mockFetchOnce({ ok: true, status: 200, json: async () => ({ nope: true }) });
    const res = await GET();
    expect(res.status).toBe(502);
  });

  it('throws when MONEYPRINT_API_URL is not configured', async () => {
    vi.stubEnv('MONEYPRINT_API_URL', '');
    await expect(GET()).rejects.toThrow('MONEYPRINT_API_URL is not defined');
  });

  it('requires no authentication', async () => {
    mockFetchOnce({
      ok: true,
      status: 200,
      json: async () => ({ version: '1.8.0', build: 502, commit: 'abc123' }),
    });
    // GET takes no Request and never touches request-auth: no mock needed.
    const res = await GET();
    expect(res.status).toBe(200);
  });
});
