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
import { findRepoRoot } from '@/test/repo-root';

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
  // Shape-only pin (mirrors the engine test): self-hosters change this
  // constant, so an exact-value assertion would fail `pnpm test` for them.
  // The fallback/override wiring is pinned by the tests below.
  it('is a valid https ingest URL', () => {
    expect(DEFAULT_POSTHOG_HOST).toMatch(/^https:\/\//);
  });
});

describe('DEFAULT_POSTHOG_HOST cross-app sync', () => {
  it('keeps the three apps pointing at the same PostHog host', async () => {
    // The three apps each declare their own DEFAULT_POSTHOG_HOST literal
    // (no shared package between web/engine/mcp). A one-sided change would
    // silently route one app's events to the wrong region — and every
    // analytics path swallows delivery errors by design, so nothing would
    // surface. This test parses the three files and asserts the literals
    // match, mirroring the SQL-literals sync test precedent.
    //
    // Self-hosters: change the constant in all three apps. If you
    // intentionally point them at different hosts, update this test to
    // assert your intended mapping instead of deleting it — a divergent
    // host should always be a conscious choice.
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const repoRoot = findRepoRoot(import.meta.url);

    const webSrc = readFileSync(
      join(repoRoot, 'apps', 'web', 'lib', 'posthog-config.ts'),
      'utf8',
    );
    const mcpSrc = readFileSync(
      join(repoRoot, 'apps', 'mcp', 'src', 'analytics.ts'),
      'utf8',
    );
    const engineSrc = readFileSync(
      join(repoRoot, 'apps', 'engine', 'app', 'services', 'analytics.py'),
      'utf8',
    );

    const webHost = webSrc.match(
      /export const DEFAULT_POSTHOG_HOST = '([^']+)'/,
    )?.[1];
    const mcpHost = mcpSrc.match(
      /export const DEFAULT_POSTHOG_HOST = '([^']+)'/,
    )?.[1];
    const engineHost = engineSrc.match(
      /^DEFAULT_POSTHOG_HOST = "([^"]+)"/m,
    )?.[1];

    expect(webHost).toBeDefined();
    expect(mcpHost).toBeDefined();
    expect(engineHost).toBeDefined();
    expect(mcpHost).toBe(webHost);
    expect(engineHost).toBe(webHost);
    // The imported constant is the parsed web value (regex sanity check).
    expect(DEFAULT_POSTHOG_HOST).toBe(webHost);
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
