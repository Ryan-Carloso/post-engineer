import { describe, it, expect, vi, afterEach } from 'vitest';
import { clampProgress, fetchEngineTaskProgress, ENGINE_TASK_PROGRESS_TIMEOUT_MS } from '../engine-tasks';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('clampProgress', () => {
  it('passes through valid 0–100 values', () => {
    expect(clampProgress(0)).toBe(0);
    expect(clampProgress(45)).toBe(45);
    expect(clampProgress(100)).toBe(100);
  });

  it('clamps out-of-range values', () => {
    expect(clampProgress(137)).toBe(100);
    expect(clampProgress(-5)).toBe(0);
  });

  it('rounds fractional values', () => {
    expect(clampProgress(45.6)).toBe(46);
    expect(clampProgress(45.4)).toBe(45);
  });

  it('coerces non-numeric payloads to 0', () => {
    expect(clampProgress('45')).toBe(0);
    expect(clampProgress(null)).toBe(0);
    expect(clampProgress(undefined)).toBe(0);
    expect(clampProgress(NaN)).toBe(0);
    expect(clampProgress(Infinity)).toBe(0);
  });
});

describe('fetchEngineTaskProgress', () => {
  const TASK_ID = 'abc-123_DEF.4';

  function mockEngine(body: unknown, ok = true, status = 200) {
    vi.stubEnv('MONEYPRINT_API_URL', 'https://engine.test');
    vi.stubEnv('MONEYPRINT_API_SECRET', 'secret');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok,
        status,
        json: async () => body,
      })),
    );
  }

  it('rejects unsafe task ids without touching the network', async () => {
    mockEngine({});
    await expect(fetchEngineTaskProgress('../evil', 'user-1')).rejects.toThrow(/taskId/i);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it('throws when the engine URL is not configured', async () => {
    vi.stubEnv('MONEYPRINT_API_URL', '');
    vi.stubEnv('MONEYPRINT_API_SECRET', 'secret');
    vi.stubGlobal('fetch', vi.fn());
    await expect(fetchEngineTaskProgress(TASK_ID, 'user-1')).rejects.toThrow(/MONEYPRINT_API_URL/);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it('throws on non-OK engine responses', async () => {
    mockEngine({ error: 'nope' }, false, 502);
    await expect(fetchEngineTaskProgress(TASK_ID, 'user-1')).rejects.toThrow(/502/);
  });

  it('reports a gone task as terminal instead of throwing', async () => {
    mockEngine({ message: 'req-1: task not found' }, false, 404);
    const result = await fetchEngineTaskProgress(TASK_ID, 'user-1');
    expect(result.gone).toBe(true);
    expect(result.state).toBe(-1);
    expect(result.progress).toBe(0);
  });

  it('reports a live task as not gone', async () => {
    mockEngine({ body: { progress: 45, state: 4 } });
    const result = await fetchEngineTaskProgress(TASK_ID, 'user-1');
    expect(result.gone).toBe(false);
  });

  it('never reports gone for a non-404 engine error', async () => {
    mockEngine({ error: 'nope' }, false, 500);
    await expect(fetchEngineTaskProgress(TASK_ID, 'user-1')).rejects.toThrow(/500/);
  });

  it('reads progress from the data-wrapped task payload', async () => {
    mockEngine({ body: { progress: 45, state: 4 } });
    const result = await fetchEngineTaskProgress(TASK_ID, 'user-1');
    expect(result.progress).toBe(45);
    const url = vi.mocked(fetch).mock.calls[0][0] as string;
    expect(url).toBe('https://engine.test/api/v1/tasks/abc-123_DEF.4');
  });

  it('reads progress from an unwrapped payload', async () => {
    mockEngine({ progress: 30 });
    const result = await fetchEngineTaskProgress(TASK_ID, 'user-1');
    expect(result.progress).toBe(30);
  });

  it('clamps the engine progress defensively', async () => {
    mockEngine({ body: { progress: 250 } });
    const result = await fetchEngineTaskProgress(TASK_ID, 'user-1');
    expect(result.progress).toBe(100);
  });

  it('returns 0 when the payload carries no progress', async () => {
    mockEngine({ body: { state: 4 } });
    const result = await fetchEngineTaskProgress(TASK_ID, 'user-1');
    expect(result.progress).toBe(0);
  });

  it('sends the engine auth headers for the user', async () => {
    mockEngine({ body: { progress: 10 } });
    await fetchEngineTaskProgress(TASK_ID, 'user-1');
    const headers = vi.mocked(fetch).mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer secret');
    expect(headers['x-user-id']).toBe('user-1');
  });

  it('aborts a hung engine lookup instead of blocking forever', async () => {
    vi.stubEnv('MONEYPRINT_API_URL', 'https://engine.test');
    vi.stubEnv('MONEYPRINT_API_SECRET', 'secret');
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: unknown, init?: { signal?: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(new DOMException('The operation was aborted.', 'AbortError')),
            );
          }),
      ),
    );
    vi.useFakeTimers();
    try {
      const pending = fetchEngineTaskProgress(TASK_ID, 'user-1');
      pending.catch(() => {});
      await vi.advanceTimersByTimeAsync(ENGINE_TASK_PROGRESS_TIMEOUT_MS + 100);
      await expect(pending).rejects.toThrow();
    } finally {
      vi.useRealTimers();
    }
  });

  it('repasses the engine stage as-is', async () => {
    mockEngine({ body: { progress: 45, stage: 'lipsync' } });
    const result = await fetchEngineTaskProgress(TASK_ID, 'user-1');
    expect(result.stage).toBe('lipsync');
  });

  it('returns null stage when the payload carries none', async () => {
    mockEngine({ body: { progress: 45 } });
    const result = await fetchEngineTaskProgress(TASK_ID, 'user-1');
    expect(result.stage).toBeNull();
  });

  it('returns null stage for non-string stage values', async () => {
    mockEngine({ body: { progress: 45, stage: 42 } });
    const result = await fetchEngineTaskProgress(TASK_ID, 'user-1');
    expect(result.stage).toBeNull();
  });
});