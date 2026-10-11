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
