import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { GET } from '../route';
import { applyRateLimit } from '@/lib/rate-limit';
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
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.version).toBe('1.30.5');
    expect(json.pr).toBe(820);
    expect(json.build).toBe(820);
    expect(json.commit).toBe('abc1234');
    expect(json.builtAt).toBe('2026-11-27T12:00:00.000Z');
    expect(json.posthogConfigured).toBe(false);
    expect(json.schedulerEnabled).toBe(false);
  });

  it('reports schedulerEnabled from isSchedulerEnabled', async () => {
    vi.stubEnv('SCHEDULER_ENABLED', 'true');
    const json = await (await GET()).json();
    expect(json.schedulerEnabled).toBe(true);
    expect(typeof json.schedulerEnabled).toBe('boolean');
  });

  it('reports posthogConfigured true when server telemetry is configured', async () => {
    vi.mocked(isPostHogServerConfigured).mockReturnValue(true);
    const res = await GET();
    const json = await res.json();
    expect(res.status).toBe(200);
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
    expect(json.version).toBe('dev');
  });

  it('requires no authentication', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
  });

  it('returns a null pr when PR_NUMBER is not numeric', async () => {
    vi.stubEnv('PR_NUMBER', 'abc');
    vi.stubEnv('BUILD', 'abc');
    const json = await (await GET()).json();
    expect(json.pr).toBeNull();
    expect(json.build).toBeNull();
    expect(json.version).toBe('1.30.5');
  });

  it('derives build from the PR number when BUILD is unset', async () => {
    vi.stubEnv('BUILD', '');
    const json = await (await GET()).json();
    expect(json.build).toBe(820);
    expect(json.build).toBe(json.pr);
  });

  it('trims surrounding whitespace from VERSION and COMMIT', async () => {
    vi.stubEnv('VERSION', ' 1.30.5 ');
    vi.stubEnv('COMMIT', ' abc1234 ');
    const json = await (await GET()).json();
    expect(json.version).toBe('1.30.5');
    expect(json.commit).toBe('abc1234');
    expect(json.version.trim()).toBe(json.version);
  });

  it('turns the scheduler on in production by default', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('SCHEDULER_ENABLED', '');
    const json = await (await GET()).json();
    expect(json.schedulerEnabled).toBe(true);
    expect(typeof json.schedulerEnabled).toBe('boolean');
  });

  it('turns the scheduler off when SCHEDULER_ENABLED=false in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('SCHEDULER_ENABLED', 'false');
    const json = await (await GET()).json();
    expect(json.schedulerEnabled).toBe(false);
    expect(json.schedulerEnabled).not.toBe(true);
  });

  it('applies the version-probe rate limit before answering', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(applyRateLimit).toHaveBeenCalledWith(undefined, expect.objectContaining({ name: expect.any(String) }));
  });
});
