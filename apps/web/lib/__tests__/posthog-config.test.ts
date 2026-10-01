//---------------
// DEFAULT_POSTHOG_HOST — the self-host seam for PostHog telemetry.
//
// - The constant is the single fallback every telemetry path uses
//   (browser client in instrumentation-client.ts, server SDK in
//   lib/posthog-server.ts).
// - NEXT_PUBLIC_POSTHOG_HOST overrides it at runtime without a code change.
// - A self-hoster changes the constant here, once.
//
// @vitest-environment node: the host-fallback tests drive the server SDK
// loader, which must not initialize in a browser-like environment.
//---------------
/**
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const ctorArgs: unknown[][] = [];

// Capture the SDK constructor args so the tests can assert which host
// the server client was built with.
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
  it('is the PostHog US ingest default', () => {
    expect(DEFAULT_POSTHOG_HOST).toBe('https://us.i.posthog.com');
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
