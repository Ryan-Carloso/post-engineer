import { afterEach, describe, expect, it, vi } from 'vitest';
import { startEngineVideoTask } from '../video-generation';

function mockEngineResponse(payload: unknown, status = 200) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(payload), { status })),
  );
}

describe('startEngineVideoTask', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('extracts the task id from the engine body envelope', async () => {
    vi.stubEnv('MONEYPRINT_API_URL', 'http://engine.test');
    vi.stubEnv('MONEYPRINT_API_SECRET', 'test-secret');
    mockEngineResponse({ status: 200, message: 'success', body: { task_id: 'task-9' } });

    const result = await startEngineVideoTask('user-1', { prompt: 'x' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.taskId).toBe('task-9');
    }
  });

  it('returns an undefined task id when the body envelope is missing', async () => {
    vi.stubEnv('MONEYPRINT_API_URL', 'http://engine.test');
    vi.stubEnv('MONEYPRINT_API_SECRET', 'test-secret');
    mockEngineResponse({ status: 200, message: 'success' });

    const result = await startEngineVideoTask('user-1', { prompt: 'x' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.taskId).toBeUndefined();
    }
  });
});
