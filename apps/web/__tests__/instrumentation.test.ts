//---------------
// instrumentation tests — register() must start the internal scheduler
// ONLY in the nodejs runtime (edge compilation cannot resolve the
// scheduler's import chain — 'Module not found crypto') and only when
// the env gate allows it.
//---------------

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { schedulerJobsMock } = vi.hoisted(() => ({
  schedulerJobsMock: {
    isSchedulerEnabled: vi.fn(),
    startInternalScheduler: vi.fn(),
  },
}));

vi.mock('../lib/version', () => ({
  getBuildInfo: () => ({ commit: undefined }),
  formatBuildInfo: () => 'test-build',
}));
vi.mock('../lib/posthog-server', () => ({
  getPostHogServer: () => null,
  flushPostHog: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../lib/scheduler-jobs', () => schedulerJobsMock);

import { register } from '../instrumentation';

const REAL_NODE_ENV = process.env.NEXT_RUNTIME;

beforeEach(() => {
  schedulerJobsMock.isSchedulerEnabled.mockReset().mockReturnValue(false);
  schedulerJobsMock.startInternalScheduler.mockReset().mockReturnValue(null);
});

afterEach(() => {
  if (REAL_NODE_ENV === undefined) delete (process.env as Record<string, unknown>).NEXT_RUNTIME;
  else (process.env as Record<string, string>).NEXT_RUNTIME = REAL_NODE_ENV;
});

describe('register() scheduler startup', () => {
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
