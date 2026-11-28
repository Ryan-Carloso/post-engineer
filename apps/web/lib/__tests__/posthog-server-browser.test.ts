import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('getPostHogServer browser guard', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.NEXT_PUBLIC_POSTHOG_KEY = 'phc_test_key';
  });

  it('returns null in the browser even with a key set', async () => {
    expect(typeof window).not.toBe('undefined');
    const { getPostHogServer } = await import('@/lib/posthog-server');
    expect(getPostHogServer()).toBeNull();
  });
});
