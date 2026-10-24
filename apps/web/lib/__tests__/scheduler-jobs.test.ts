//---------------
// scheduler env-gate tests — the scheduler defaults ON only in
// production; SCHEDULER_ENABLED=true opts in anywhere, =false forces
// off. Kept in its own file so the NODE_ENV mutation cannot leak into
// the other scheduler tests.
//---------------

import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('@/lib/supabase/service', () => ({
  createSupabaseServiceClient: vi.fn(),
}));

import { isSchedulerEnabled } from '../scheduler-jobs';

const REAL_NODE_ENV = process.env.NODE_ENV;
const REAL_FLAG = process.env.SCHEDULER_ENABLED;

function setEnv(name: 'NODE_ENV' | 'SCHEDULER_ENABLED', value: string | undefined): void {
  const env = process.env as Record<string, string | undefined>;
  if (value === undefined) delete env[name];
  else env[name] = value;
}

afterEach(() => {
  setEnv('NODE_ENV', REAL_NODE_ENV);
  setEnv('SCHEDULER_ENABLED', REAL_FLAG);
});

describe('isSchedulerEnabled', () => {
  it('defaults ON only in production', () => {
    delete process.env.SCHEDULER_ENABLED;
    setEnv('NODE_ENV', 'production');
    expect(isSchedulerEnabled()).toBe(true);

    setEnv('NODE_ENV', 'development');
    expect(isSchedulerEnabled()).toBe(false);

    setEnv('NODE_ENV', 'test');
    expect(isSchedulerEnabled()).toBe(false);
  });

  it('SCHEDULER_ENABLED=true opts in explicitly (even outside production)', () => {
    process.env.SCHEDULER_ENABLED = 'true';
    setEnv('NODE_ENV', 'development');
    expect(isSchedulerEnabled()).toBe(true);
  });

  it('SCHEDULER_ENABLED=false forces off (even in production)', () => {
    process.env.SCHEDULER_ENABLED = 'false';
    setEnv('NODE_ENV', 'production');
    expect(isSchedulerEnabled()).toBe(false);
  });
});
