import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { findRepoRoot } from '@/test/repo-root';

const ctorArgs: unknown[][] = [];

vi.mock('posthog-node', () => ({
  PostHog: class {
    constructor(...args: unknown[]) {
      ctorArgs.push(args);
    }
    capture(): void {}
    captureException(): void {}
    shutdownAsync(): Promise<void> {
      return Promise.resolve();
    }
  },
}));

import { DEFAULT_POSTHOG_HOST } from '@/lib/posthog-config';
import { __resetPostHogServerForTests } from '@/lib/posthog-server';

describe('DEFAULT_POSTHOG_HOST', () => {
  it('is a valid https ingest URL', () => {
    expect(DEFAULT_POSTHOG_HOST).toMatch(/^https:\/\//);
  });
});

describe('DEFAULT_POSTHOG_HOST source pin', () => {
  it('is the literal declared in lib/posthog-config.ts', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const repoRoot = findRepoRoot(import.meta.url);

    const webSrc = readFileSync(
      join(repoRoot, 'apps', 'web', 'lib', 'posthog-config.ts'),
      'utf8',
    );
    const webHost = webSrc.match(
      /export const DEFAULT_POSTHOG_HOST = '([^']+)'/,
    )?.[1];

    expect(webHost).toBeDefined();
    expect(DEFAULT_POSTHOG_HOST).toBe(webHost);
    expect(webSrc.match(/export const DEFAULT_POSTHOG_HOST = '([^']+)'/g)).toHaveLength(1);
    expect(DEFAULT_POSTHOG_HOST).toMatch(/^https:\/\//);
  });
});

describe('server client host resolution', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    __resetPostHogServerForTests();
    ctorArgs.length = 0;
    process.env = { ...originalEnv };
    delete process.env.POSTHOG_API_KEY;
    delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
    delete process.env.NEXT_PUBLIC_POSTHOG_HOST;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = originalEnv;
    __resetPostHogServerForTests();
    vi.restoreAllMocks();
  });

  it('falls back to DEFAULT_POSTHOG_HOST when no host env is set', async () => {
    process.env.NEXT_PUBLIC_POSTHOG_KEY = 'phc_test_key';
    const { getPostHogServer, flushPostHog } = await import('@/lib/posthog-server');
    getPostHogServer();
    await flushPostHog();
    expect(ctorArgs).toHaveLength(1);
    expect(ctorArgs[0]?.[1]).toMatchObject({ host: DEFAULT_POSTHOG_HOST });
  });

  it('prefers NEXT_PUBLIC_POSTHOG_HOST over the default', async () => {
    process.env.NEXT_PUBLIC_POSTHOG_KEY = 'phc_test_key';
    process.env.NEXT_PUBLIC_POSTHOG_HOST = 'https://eu.i.posthog.com';
    const { getPostHogServer, flushPostHog } = await import('@/lib/posthog-server');
    getPostHogServer();
    await flushPostHog();
    expect(ctorArgs).toHaveLength(1);
    expect(ctorArgs[0]?.[1]).toMatchObject({ host: 'https://eu.i.posthog.com' });
  });
});

describe('server client host validation', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    __resetPostHogServerForTests();
    ctorArgs.length = 0;
    process.env = { ...originalEnv };
    delete process.env.POSTHOG_API_KEY;
    delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
    delete process.env.NEXT_PUBLIC_POSTHOG_HOST;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = originalEnv;
    __resetPostHogServerForTests();
    vi.restoreAllMocks();
  });

  const misconfiguredHost = 'phc_notARealProjectKey0000000000000000000000000';

  it('rejects a project API key used as NEXT_PUBLIC_POSTHOG_HOST', async () => {
    process.env.POSTHOG_API_KEY = 'phc_test_key';
    process.env.NEXT_PUBLIC_POSTHOG_HOST = misconfiguredHost;
    const { getPostHogServer, flushPostHog } = await import('@/lib/posthog-server');
    getPostHogServer();
    await flushPostHog();
    expect(ctorArgs).toHaveLength(1);
    expect(ctorArgs[0]?.[1]).toMatchObject({ host: DEFAULT_POSTHOG_HOST });
  });

  it('warns loudly when the host is not an http(s) URL', async () => {
    process.env.POSTHOG_API_KEY = 'phc_test_key';
    process.env.NEXT_PUBLIC_POSTHOG_HOST = misconfiguredHost;
    const { getPostHogServer, flushPostHog } = await import('@/lib/posthog-server');
    getPostHogServer();
    await flushPostHog();
    const warnings = vi
      .mocked(console.warn)
      .mock.calls.map((call) => String(call[0]))
      .join('\n');
    expect(warnings).toContain('NEXT_PUBLIC_POSTHOG_HOST');
    expect(warnings).not.toContain(misconfiguredHost);
  });

  it('never logs the rejected host value, whatever it is', async () => {
    process.env.POSTHOG_API_KEY = 'phc_test_key';
    process.env.NEXT_PUBLIC_POSTHOG_HOST = 'not-a-url-at-all';
    const { getPostHogServer, flushPostHog } = await import('@/lib/posthog-server');
    getPostHogServer();
    await flushPostHog();
    const warnings = vi
      .mocked(console.warn)
      .mock.calls.map((call) => call.map(String).join(' '))
      .join('\n');
    expect(warnings).not.toContain('not-a-url-at-all');
  });

  it.each([
    ['a bare host without scheme', 'eu.i.posthog.com'],
    ['a scheme-less string with a path', 'eu.i.posthog.com/batch'],
    ['a non-http scheme', 'javascript:alert(1)'],
  ])('rejects %s', async (_label, host) => {
    process.env.POSTHOG_API_KEY = 'phc_test_key';
    process.env.NEXT_PUBLIC_POSTHOG_HOST = host;
    const { getPostHogServer, flushPostHog } = await import('@/lib/posthog-server');
    getPostHogServer();
    await flushPostHog();
    expect(ctorArgs).toHaveLength(1);
    expect(ctorArgs[0]?.[1]).toMatchObject({ host: DEFAULT_POSTHOG_HOST });
  });

  it('still honors a valid custom self-hosted URL', async () => {
    process.env.POSTHOG_API_KEY = 'phc_test_key';
    process.env.NEXT_PUBLIC_POSTHOG_HOST = 'https://posthog.internal.example:8000';
    const { getPostHogServer, flushPostHog } = await import('@/lib/posthog-server');
    getPostHogServer();
    await flushPostHog();
    expect(ctorArgs).toHaveLength(1);
    expect(ctorArgs[0]?.[1]).toMatchObject({
      host: 'https://posthog.internal.example:8000',
    });
  });

  it.each([
    ['a remote http host', 'http://posthog.internal.example:8000'],
    ['a bare-IP http host', 'http://10.0.0.5:8000'],
  ])('rejects %s', async (_label, host) => {
    process.env.POSTHOG_API_KEY = 'phc_test_key';
    process.env.NEXT_PUBLIC_POSTHOG_HOST = host;
    const { getPostHogServer, flushPostHog } = await import('@/lib/posthog-server');
    getPostHogServer();
    await flushPostHog();
    expect(ctorArgs).toHaveLength(1);
    expect(ctorArgs[0]?.[1]).toMatchObject({ host: DEFAULT_POSTHOG_HOST });
  });

  it.each(['http://localhost:8000', 'http://127.0.0.1:8000', 'http://[::1]:8000'])(
    'still allows the loopback host %s',
    async (host) => {
      process.env.POSTHOG_API_KEY = 'phc_test_key';
      process.env.NEXT_PUBLIC_POSTHOG_HOST = host;
      const { getPostHogServer, flushPostHog } = await import('@/lib/posthog-server');
      getPostHogServer();
      await flushPostHog();
      expect(ctorArgs).toHaveLength(1);
      expect(ctorArgs[0]?.[1]).toMatchObject({ host });
    },
  );
});
