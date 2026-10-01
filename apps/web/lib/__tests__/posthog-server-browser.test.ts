/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

//---------------
// Browser guard: getPostHogServer() must return null when `window` exists,
// even with a key configured. The import() of posthog-node in
// lib/posthog-server.ts carries `webpackIgnore: true` so webpack never
// bundles the Node-only SDK into client chunks (lib/logger.ts is imported
// by client components via lib/api.ts); this runtime guard is the second
// layer — it ensures the native import() is never even reached in the
// browser.
//---------------

describe('getPostHogServer browser guard', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.NEXT_PUBLIC_POSTHOG_KEY = 'phc_test_key';
  });

  it('returns null in the browser even with a key set', async () => {
    // jsdom provides window — the guard must trigger.
    expect(typeof window).not.toBe('undefined');
    const { getPostHogServer } = await import('@/lib/posthog-server');
    expect(getPostHogServer()).toBeNull();
  });
});
