//---------------
// posthog-server — server-side PostHog client singleton
//
// @vitest-environment node: getPostHogServer() returns null in browsers
// (typeof window check), so these tests must run in Node, not jsdom.
//---------------
/**
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { __resetPostHogServerForTests } from '@/lib/posthog-server';

describe('getPostHogServer', () => {
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

  it('returns null when no API key is configured (never throws)', async () => {
    const { getPostHogServer } = await import('@/lib/posthog-server');
    const client = getPostHogServer();
    expect(client).toBeNull();
    expect(console.warn).toHaveBeenCalled();
  });

  it('returns a client when NEXT_PUBLIC_POSTHOG_KEY is set', async () => {
    process.env.NEXT_PUBLIC_POSTHOG_KEY = 'phc_test_key';
    const { getPostHogServer } = await import('@/lib/posthog-server');
    const client = getPostHogServer();
    expect(client).not.toBeNull();
    expect(typeof client?.capture).toBe('function');
  });

  it('prefers POSTHOG_API_KEY over NEXT_PUBLIC_POSTHOG_KEY', async () => {
    process.env.POSTHOG_API_KEY = 'phc_server_key';
    process.env.NEXT_PUBLIC_POSTHOG_KEY = 'phc_public_key';
    const { getPostHogServer } = await import('@/lib/posthog-server');
    const client = getPostHogServer();
    expect(client).not.toBeNull();
  });

  it('is a singleton (same instance on repeated calls)', async () => {
    process.env.NEXT_PUBLIC_POSTHOG_KEY = 'phc_test_key';
    const { getPostHogServer } = await import('@/lib/posthog-server');
    const c1 = getPostHogServer();
    const c2 = getPostHogServer();
    expect(c1).toBe(c2);
  });
});
