import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { GET } from '../route';
import { logger } from '@/lib/logger';
import { isPostHogServerConfigured } from '@/lib/posthog-server';

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
  isPostHogServerConfigured: vi.fn(() => false),
}));

const ENGINE_URL = 'https://engine.example.com';

function mockFetchOnce(response: { ok: boolean; status: number; json: () => Promise<unknown> }) {
  const fetchMock = vi.fn(async () => response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('GET /api/version', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('MONEYPRINT_API_URL', ENGINE_URL);
    vi.mocked(isPostHogServerConfigured).mockReturnValue(false);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('proxies the engine /version payload and adds posthogConfigured', async () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
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
      posthogConfigured: false,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `${ENGINE_URL}/version`,
      expect.objectContaining({ cache: 'no-store', signal: expect.any(AbortSignal) }),
    );
    expect(clearTimeoutSpy).toHaveBeenCalled();
  });

  it('reports posthogConfigured true when server telemetry is configured', async () => {
    vi.mocked(isPostHogServerConfigured).mockReturnValue(true);
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
      posthogConfigured: true,
    });
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
      posthogConfigured: false,
    });
  });

  it('strips trailing slashes from the engine base URL', async () => {
    vi.stubEnv('MONEYPRINT_API_URL', 'https://engine.example.com///');
    const fetchMock = mockFetchOnce({
      ok: true,
      status: 200,
      json: async () => ({ version: '1.8.0', build: 502, commit: 'abc123' }),
    });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://engine.example.com/version',
      expect.anything(),
    );
  });

  it('aborts the engine request when the timeout elapses', async () => {
    vi.useFakeTimers();
    try {
      let signal: AbortSignal | undefined;
      const fetchMock = vi.fn(async (_url: string, init?: { signal?: AbortSignal }) => {
        signal = init?.signal;
        // Hang until the request is aborted, like a stalled engine would.
        await new Promise<void>((resolve) => {
          signal?.addEventListener('abort', () => resolve(), { once: true });
        });
        throw new Error('aborted');
      });
      vi.stubGlobal('fetch', fetchMock);
      const pending = GET();
      await vi.advanceTimersByTimeAsync(6000);
      // Fails fast when the timeout callback never aborts (mutant: () => {}).
      expect(signal?.aborted).toBe(true);
      const res = await pending;
      expect(res.status).toBe(502);
    } finally {
      vi.useRealTimers();
    }
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
    expect(body.error).toBe('Engine version unavailable');
  });

  it('returns 502 when the engine answers non-ok', async () => {
    mockFetchOnce({ ok: false, status: 500, json: async () => ({}) });
    const res = await GET();
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.code).toBe('engine_unreachable');
    expect(body.error).toBe('Engine version unavailable');
    expect(vi.mocked(logger.error)).toHaveBeenCalledWith(
      expect.stringContaining('[GET /api/version] 502 Engine version unavailable'),
      undefined,
      expect.objectContaining({ engineStatus: 500 }),
    );
  });

  it('returns 502 when the engine payload is malformed', async () => {
    mockFetchOnce({ ok: true, status: 200, json: async () => ({ nope: true }) });
    const res = await GET();
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.code).toBe('engine_unreachable');
    expect(body.error).toBe('Engine version unavailable');
    expect(vi.mocked(logger.error)).toHaveBeenCalledWith(
      expect.stringContaining('Engine /version returned an unexpected payload'),
      undefined,
      expect.anything(),
    );
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
