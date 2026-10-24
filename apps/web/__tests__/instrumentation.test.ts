//---------------
// instrumentation tests:
// 1. onRequestError — unhandled request errors captured to PostHog
//    (server-side error tracking). Never throws.
// 2. register() — starts the internal scheduler ONLY in the nodejs
//    runtime (edge compilation cannot resolve the scheduler's import
//    chain — 'Module not found crypto') and only when the gate allows.
//---------------

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { schedulerJobsMock } = vi.hoisted(() => ({
  schedulerJobsMock: {
    isSchedulerEnabled: vi.fn(),
    startInternalScheduler: vi.fn(),
  },
}));

vi.mock('@/lib/version', () => ({
  getBuildInfo: () => ({ commit: undefined }),
  formatBuildInfo: () => 'test-build',
}));
vi.mock('@/lib/posthog-server', () => ({
  getPostHogServer: vi.fn(),
  flushPostHog: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/scheduler-jobs', () => schedulerJobsMock);

import { register, onRequestError } from '@/instrumentation';
import { getPostHogServer } from '@/lib/posthog-server';

describe('onRequestError', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('captures the unhandled request error to PostHog with request context', async () => {
    const captureException = vi.fn();
    (getPostHogServer as ReturnType<typeof vi.fn>).mockReturnValue({ captureException });
    const error = new Error('SSR render boom');

    await onRequestError(
      error,
      { path: '/api/schedule', method: 'POST' },
      { routerKind: 'App Router' },
    );

    expect(captureException).toHaveBeenCalledTimes(1);
    const [captured, props] = (captureException as ReturnType<typeof vi.fn>).mock.calls[0] as [
      unknown,
      Record<string, unknown>,
    ];
    expect(captured).toBe(error);
    expect(props).toMatchObject({
      path: '/api/schedule',
      method: 'POST',
      routerKind: 'App Router',
    });
  });

  it('does nothing (never throws) when PostHog is not configured', async () => {
    (getPostHogServer as ReturnType<typeof vi.fn>).mockReturnValue(null);
    await expect(
      onRequestError(new Error('x'), { path: '/p', method: 'GET' }, { routerKind: 'App Router' }),
    ).resolves.toBeUndefined();
  });

  it('never throws even if capture throws', async () => {
    (getPostHogServer as ReturnType<typeof vi.fn>).mockReturnValue({
      captureException: () => {
        throw new Error('posthog down');
      },
    });
    await expect(
      onRequestError(new Error('x'), { path: '/p', method: 'GET' }, { routerKind: 'App Router' }),
    ).resolves.toBeUndefined();
  });

  it('accepts non-Error values without throwing', async () => {
    const captureException = vi.fn();
    (getPostHogServer as ReturnType<typeof vi.fn>).mockReturnValue({ captureException });
    await expect(
      onRequestError('string failure', { path: '/p', method: 'GET' }, { routerKind: 'App Router' }),
    ).resolves.toBeUndefined();
    expect(captureException).toHaveBeenCalledTimes(1);
  });
});

describe('register() scheduler startup', () => {
  const REAL_NEXT_RUNTIME = process.env.NEXT_RUNTIME;

  beforeEach(() => {
    schedulerJobsMock.isSchedulerEnabled.mockReset().mockReturnValue(false);
    schedulerJobsMock.startInternalScheduler.mockReset().mockReturnValue(null);
  });

  afterEach(() => {
    if (REAL_NEXT_RUNTIME === undefined) {
      delete (process.env as Record<string, unknown>).NEXT_RUNTIME;
    } else {
      (process.env as Record<string, string>).NEXT_RUNTIME = REAL_NEXT_RUNTIME;
    }
  });

  it('starts the scheduler in the nodejs runtime when enabled', async () => {
    (process.env as Record<string, string>).NEXT_RUNTIME = 'nodejs';
    schedulerJobsMock.isSchedulerEnabled.mockReturnValue(true);
    await register();
    expect(schedulerJobsMock.startInternalScheduler).toHaveBeenCalledTimes(1);
  });

  it('does not start the scheduler in the nodejs runtime when the gate says off', async () => {
    (process.env as Record<string, string>).NEXT_RUNTIME = 'nodejs';
    schedulerJobsMock.isSchedulerEnabled.mockReturnValue(false);
    await register();
    expect(schedulerJobsMock.startInternalScheduler).not.toHaveBeenCalled();
  });

  it('never touches the scheduler in the edge runtime', async () => {
    (process.env as Record<string, string>).NEXT_RUNTIME = 'edge';
    schedulerJobsMock.isSchedulerEnabled.mockReturnValue(true);
    await register();
    // The dynamic import inside the nodejs branch must not even run.
    expect(schedulerJobsMock.isSchedulerEnabled).not.toHaveBeenCalled();
    expect(schedulerJobsMock.startInternalScheduler).not.toHaveBeenCalled();
  });
});
