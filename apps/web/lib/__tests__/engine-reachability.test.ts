import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { createEngineProbe, isEngineUnreachableError } from '../engine-reachability';
import { EngineTaskLookupError } from '../engine-tasks';
import { logger } from '@/lib/logger';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('isEngineUnreachableError', () => {
  it('treats a network failure (TypeError from fetch) as unreachable', () => {
    expect(isEngineUnreachableError(new TypeError('fetch failed'))).toBe(true);
  });

  it('treats a lookup timeout (AbortError) as unreachable', () => {
    expect(isEngineUnreachableError(new DOMException('aborted', 'AbortError'))).toBe(true);
  });

  it.each([502, 503, 504])('treats an engine %i as unreachable', (status) => {
    expect(isEngineUnreachableError(new EngineTaskLookupError(status))).toBe(true);
  });

  it.each([500, 401, 403, 429])('does not treat an engine %i as unreachable', (status) => {
    expect(isEngineUnreachableError(new EngineTaskLookupError(status))).toBe(false);
  });

  it('does not treat a plain error or a non-error value as unreachable', () => {
    expect(isEngineUnreachableError(new Error('Invalid taskId: x'))).toBe(false);
    expect(isEngineUnreachableError('down')).toBe(false);
  });
});

describe('createEngineProbe', () => {
  it('starts reachable', () => {
    expect(createEngineProbe().unreachable).toBe(false);
  });

  it('flips to unreachable and logs only the first failure', () => {
    const probe = createEngineProbe();
    probe.markUnreachable('task-1', new TypeError('fetch failed'));
    probe.markUnreachable('task-2', new TypeError('fetch failed'));

    expect(probe.unreachable).toBe(true);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      '[api/schedule] engine unreachable, skipping remaining task progress lookups',
      { taskId: 'task-1', error: 'fetch failed' },
    );
  });

  it('keeps probes independent across requests', () => {
    const first = createEngineProbe();
    first.markUnreachable('task-1', 'down');
    expect(createEngineProbe().unreachable).toBe(false);
  });
});
