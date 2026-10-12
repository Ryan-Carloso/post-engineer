// @vitest-environment node
//---------------
// posthog-server — node-environment proof that the server client
// initializes over posthog-node (the server SDK), not posthog-js.
//---------------

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  __resetPostHogServerForTests,
  getPostHogServer,
  isPostHogServerConfigured,
} from '@/lib/posthog-server';

describe('getPostHogServer (node runtime)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    __resetPostHogServerForTests();
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

  it('initializes a real server client when a key is set (never throws)', () => {
    process.env.POSTHOG_API_KEY = 'phc_server_key';
    const client = getPostHogServer();
    expect(client).not.toBeNull();
    expect(typeof client?.capture).toBe('function');
    expect(typeof client?.captureException).toBe('function');
  });

  it('stays disabled without a key', () => {
    expect(getPostHogServer()).toBeNull();
    expect(console.warn).toHaveBeenCalled();
  });

  it('is built on posthog-node, never posthog-js', () => {
    const source = readFileSync(path.resolve(process.cwd(), 'lib/posthog-server.ts'), 'utf8');
    // posthog-node is lazy-loaded via a webpackIgnore-marked dynamic import
    // (see the test below); posthog-js must never appear — the server SDK
    // is the only client used here.
    expect(source).not.toContain("from 'posthog-js'");
    expect(source).not.toContain('from "posthog-js"');
    expect(source).not.toMatch(/^\s*import .* from ['"]posthog-node['"]/m);
  });

  it('marks the posthog-node dynamic import with webpackIgnore: true', () => {
    // Regression: a plain dynamic import() is still statically analyzed by
    // webpack, which resolves 'posthog-node' at build time and bundles the
    // Node-only SDK (no browser export condition) into the client chunk —
    // the build then fails on node:fs / node:os / node:path
    // (UnhandledSchemeError). webpackIgnore: true keeps the import() native
    // so Node resolves it at runtime on the server; the browser never
    // reaches it (typeof window guard in getPostHogServer/flushPostHog).
    const source = readFileSync(path.resolve(process.cwd(), 'lib/posthog-server.ts'), 'utf8');
    const dynamicImports = [...source.matchAll(/import\(([\s\S]*?)\)/g)];
    const posthogImports = dynamicImports.filter((m) => m[1].includes('posthog-node'));
    expect(posthogImports.length).toBeGreaterThan(0);
    for (const m of posthogImports) {
      expect(m[1]).toMatch(/webpackIgnore:\s*true/);
    }
  });
});

describe('isPostHogServerConfigured', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    __resetPostHogServerForTests();
    process.env = { ...originalEnv };
    delete process.env.POSTHOG_API_KEY;
    delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = originalEnv;
    __resetPostHogServerForTests();
    vi.restoreAllMocks();
  });

  it('is true when POSTHOG_API_KEY is set', () => {
    process.env.POSTHOG_API_KEY = 'test-key';
    expect(isPostHogServerConfigured()).toBe(true);
  });

  it('is true with the public key fallback', () => {
    process.env.NEXT_PUBLIC_POSTHOG_KEY = 'public-key';
    expect(isPostHogServerConfigured()).toBe(true);
  });

  it('is false with no key configured', () => {
    expect(isPostHogServerConfigured()).toBe(false);
  });

  it('is false with an empty key', () => {
    process.env.POSTHOG_API_KEY = '';
    expect(isPostHogServerConfigured()).toBe(false);
  });

  it('never leaks the key value', () => {
    process.env.POSTHOG_API_KEY = 'super-secret-key';
    const configured = isPostHogServerConfigured();
    expect(configured).toBe(true);
    expect(JSON.stringify({ posthogConfigured: configured })).not.toContain('super-secret-key');
  });
});

describe('capture delivery (posthog-node v5 has no automatic flush)', () => {
  // Regression: posthog-node v5 removed the v3/v4 `flushAt` option and runs
  // no background flush timer — `flushInterval` is accepted but never used,
  // and the debounced flush requires the serverless `waitUntil` option.
  // Captured events sat in the in-memory queue forever (zero server_success
  // events ever reached PostHog), so the client must flush explicitly after
  // every capture.
  const originalEnv = { ...process.env };

  beforeEach(() => {
    __resetPostHogServerForTests();
    process.env = { ...originalEnv };
    delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
    delete process.env.NEXT_PUBLIC_POSTHOG_HOST;
    process.env.POSTHOG_API_KEY = 'phc_test_key';
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = originalEnv;
    __resetPostHogServerForTests();
    vi.restoreAllMocks();
  });

  it('flushes the SDK after capture so the event is delivered', async () => {
    const { PostHog } = await import('posthog-node');
    // Mock the network-touching flush; the assertion is that flush is
    // *called*, which is what moves the event out of the queue.
    const flushSpy = vi.spyOn(PostHog.prototype, 'flush').mockResolvedValue(undefined);
    const client = getPostHogServer();
    expect(client).not.toBeNull();

    client?.capture('server_success', { route: 'GET /api/version', status: 200 });

    await vi.waitFor(() => expect(flushSpy).toHaveBeenCalled());
  });

  it('flushes the SDK after captureException too', async () => {
    const { PostHog } = await import('posthog-node');
    const flushSpy = vi.spyOn(PostHog.prototype, 'flush').mockResolvedValue(undefined);
    const client = getPostHogServer();
    expect(client).not.toBeNull();

    client?.captureException(new Error('boom'), { route: 'GET /api/test' });

    await vi.waitFor(() => expect(flushSpy).toHaveBeenCalled());
  });

  it('does not pass the stale flushAt option (ignored by posthog-node v5)', () => {
    // `flushAt` was a v3/v4 option ("flush after N captures"). v5 ignores it
    // silently — the old code passed it believing it flushed on every capture
    // while events were never delivered. Fail if the option comes back
    // (mentions in comments are fine).
    const source = readFileSync(path.resolve(process.cwd(), 'lib/posthog-server.ts'), 'utf8');
    expect(source).not.toMatch(/flushAt\s*:/);
  });
});

describe('telemetry origin tags (source + environment)', () => {
  // Every server-side capture must carry where it came from (source) and
  // which deployment produced it (environment) so PostHog dashboards can
  // split MCP / web-server / web-client / engine traffic and prod / dev.
  const originalEnv = { ...process.env };

  beforeEach(() => {
    __resetPostHogServerForTests();
    process.env = { ...originalEnv };
    delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
    delete process.env.NEXT_PUBLIC_POSTHOG_HOST;
    process.env.POSTHOG_API_KEY = 'phc_test_key';
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = originalEnv;
    __resetPostHogServerForTests();
    vi.restoreAllMocks();
  });

  it('tags capture() with source web-server and the runtime environment', async () => {
    const { PostHog } = await import('posthog-node');
    const captureSpy = vi.spyOn(PostHog.prototype, 'capture');
    const client = getPostHogServer();
    expect(client).not.toBeNull();

    client?.capture('server_success', { route: 'GET /api/version', status: 200 });

    await vi.waitFor(() => expect(captureSpy).toHaveBeenCalled());
    const args = captureSpy.mock.calls[0][0] as {
      properties?: Record<string, unknown>;
    };
    expect(args.properties).toMatchObject({
      source: 'web-server',
      environment: 'development',
    });
    // Caller properties survive alongside the tags.
    expect(args.properties).toMatchObject({ route: 'GET /api/version', status: 200 });
  });

  it('tags captureAs() with source web-server', async () => {
    const { PostHog } = await import('posthog-node');
    const captureSpy = vi.spyOn(PostHog.prototype, 'capture');
    const client = getPostHogServer();

    client?.captureAs('user-123', 'refund_issued', { amount: 1 });

    await vi.waitFor(() => expect(captureSpy).toHaveBeenCalled());
    const args = captureSpy.mock.calls[0][0] as {
      distinctId: string;
      properties?: Record<string, unknown>;
    };
    expect(args.distinctId).toBe('user-123');
    expect(args.properties).toMatchObject({ source: 'web-server', environment: 'development' });
  });

  it('tags captureException() with source web-server', async () => {
    const { PostHog } = await import('posthog-node');
    const captureSpy = vi.spyOn(PostHog.prototype, 'captureException');
    const client = getPostHogServer();

    client?.captureException(new Error('boom'), { route: 'GET /api/test' });

    await vi.waitFor(() => expect(captureSpy).toHaveBeenCalled());
    // posthog-node captureException(error, distinctId, properties).
    const args = captureSpy.mock.calls[0] as unknown as [
      unknown,
      string,
      Record<string, unknown> | undefined,
    ];
    expect(args[2]).toMatchObject({
      source: 'web-server',
      environment: 'development',
    });
  });

  it('reports environment production when NODE_ENV=production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const { PostHog } = await import('posthog-node');
    const captureSpy = vi.spyOn(PostHog.prototype, 'capture');
    const client = getPostHogServer();

    client?.capture('server_success', { route: 'GET /api/version', status: 200 });

    await vi.waitFor(() => expect(captureSpy).toHaveBeenCalled());
    const args = captureSpy.mock.calls[0][0] as {
      properties?: Record<string, unknown>;
    };
    expect(args.properties).toMatchObject({
      source: 'web-server',
      environment: 'production',
    });
    vi.unstubAllEnvs();
  });

  it('caller properties cannot strip or override the origin tags', async () => {
    const { PostHog } = await import('posthog-node');
    const captureSpy = vi.spyOn(PostHog.prototype, 'capture');
    const client = getPostHogServer();

    client?.capture('server_success', { source: 'spoofed', environment: 'production' });

    await vi.waitFor(() => expect(captureSpy).toHaveBeenCalled());
    const args = captureSpy.mock.calls[0][0] as {
      properties?: Record<string, unknown>;
    };
    expect(args.properties?.['source']).toBe('web-server');
    expect(args.properties?.['environment']).toBe('development');
  });
});
