import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { GET } from '../route';
import { isPostHogServerConfigured } from '@/lib/posthog-server';

vi.mock('@/lib/rate-limit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/rate-limit')>()),
  applyRateLimit: vi.fn(async () => null),
}));
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

describe('GET /api/version', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('VERSION', '1.30.5');
    vi.stubEnv('PR_NUMBER', '820');
    vi.stubEnv('BUILD', '820');
    vi.stubEnv('COMMIT', 'abc1234');
    vi.stubEnv('BUILT_AT', '2026-11-27T12:00:00.000Z');
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('SCHEDULER_ENABLED', '');
    vi.mocked(isPostHogServerConfigured).mockReturnValue(false);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('reports the web build metadata and telemetry flags', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      version: '1.30.5',
      pr: 820,
      build: 820,
      commit: 'abc1234',
      builtAt: '2026-11-27T12:00:00.000Z',
      posthogConfigured: false,
      schedulerEnabled: false,
    });
  });

  it('reports schedulerEnabled from isSchedulerEnabled', async () => {
    vi.stubEnv('SCHEDULER_ENABLED', 'true');
    const json = await (await GET()).json();
    expect(json.schedulerEnabled).toBe(true);
  });

  it('reports posthogConfigured true when server telemetry is configured', async () => {
    vi.mocked(isPostHogServerConfigured).mockReturnValue(true);
    const json = await (await GET()).json();
    expect(json.posthogConfigured).toBe(true);
  });

  it('falls back to the dev label when no build metadata is set', async () => {
    vi.stubEnv('VERSION', '');
    vi.stubEnv('PR_NUMBER', '');
    vi.stubEnv('BUILD', '');
    vi.stubEnv('COMMIT', '');
    vi.stubEnv('BUILT_AT', '');
    const json = await (await GET()).json();
    expect(json).toMatchObject({ version: 'dev', pr: null, build: null, commit: null, builtAt: null });
  });

  it('requires no authentication', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
  });
});
