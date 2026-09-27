import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withTimeout, withUploadTimeout, withOAuthTimeout, withHealthCheckTimeout, TIMEOUT_CONFIG } from '@/lib/timeout';
import { TimeoutError } from '@/lib/errors';

describe('withTimeout', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('resolves before timeout', async () => {
    const result = await withTimeout(Promise.resolve('ok'), { timeoutMs: 1000 });
    expect(result).toBe('ok');
  });

  it('rejects with TimeoutError after timeout', async () => {
    const p = new Promise<string>(() => {}); // never resolves
    const promise = withTimeout(p, { timeoutMs: 500 });
    vi.advanceTimersByTime(600);
    await expect(promise).rejects.toThrow(TimeoutError);
  });

  it('calls onProgress during long promise', async () => {
    const onProgress = vi.fn();
    const p = new Promise<string>((resolve) => {
      setTimeout(() => resolve('done'), 3000);
    });
    const resultPromise = withTimeout(p, { timeoutMs: 5000, onProgress });
    vi.advanceTimersByTime(1500);
    expect(onProgress).toHaveBeenCalled();
    vi.advanceTimersByTime(1500);
    const result = await resultPromise;
    expect(result).toBe('done');
  });

  it('does not call onProgress when promise resolves quickly', async () => {
    const onProgress = vi.fn();
    await withTimeout(Promise.resolve('fast'), { timeoutMs: 1000, onProgress });
    expect(onProgress).not.toHaveBeenCalled();
  });
});

describe('TIMEOUT_CONFIG', () => {
  it('has correct values', () => {
    expect(TIMEOUT_CONFIG.UPLOAD_TIMEOUT).toBe(30 * 60 * 1000);
    expect(TIMEOUT_CONFIG.OAUTH_TIMEOUT).toBe(5 * 60 * 1000);
    expect(TIMEOUT_CONFIG.HEALTH_CHECK_TIMEOUT).toBe(10 * 1000);
    expect(TIMEOUT_CONFIG.CONNECTION_TIMEOUT).toBe(30 * 1000);
    expect(TIMEOUT_CONFIG.VALIDATION_TIMEOUT).toBe(5 * 1000);
  });
});

describe('withUploadTimeout', () => {
  it('resolves within upload timeout', async () => {
    const result = await withUploadTimeout(Promise.resolve('ok'));
    expect(result).toBe('ok');
  });
});

describe('withOAuthTimeout', () => {
  it('resolves within oauth timeout', async () => {
    const result = await withOAuthTimeout(Promise.resolve('ok'));
    expect(result).toBe('ok');
  });
});

describe('withHealthCheckTimeout', () => {
  it('resolves within health check timeout', async () => {
    const result = await withHealthCheckTimeout(Promise.resolve('ok'));
    expect(result).toBe('ok');
  });
});
