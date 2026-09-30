// @vitest-environment node
//---------------
// posthog-server — node-environment proof that the server client
// initializes over posthog-node (the server SDK), not posthog-js.
//---------------

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { __resetPostHogServerForTests, getPostHogServer } from '@/lib/posthog-server';

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
    expect(source).toContain("from 'posthog-node'");
    expect(source).not.toContain("from 'posthog-js'");
  });
});
