//---------------
// instrumentation.onRequestError — unhandled request errors captured
// to PostHog (server-side error tracking). Never throws.
//---------------

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/posthog-server', () => ({
  getPostHogServer: vi.fn(),
}));

import { onRequestError } from '@/instrumentation';
import { getPostHogServer } from '@/lib/posthog-server';

describe('onRequestError', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('captures the unhandled request error to PostHog with request context', async () => {
    const captureException = vi.fn();
    (getPostHogServer as ReturnType<typeof vi.fn>).mockReturnValue({ captureException });
    const error = new Error('SSR render boom');

    await onRequestError(
      error,
      { path: '/api/schedule', method: 'POST' },
      { routerKind: 'App Router' },
    );

    expect(captureException).toHaveBeenCalledTimes(1);
    const [captured, props] = (captureException as ReturnType<typeof vi.fn>).mock.calls[0] as [
      unknown,
      Record<string, unknown>,
    ];
    expect(captured).toBe(error);
    expect(props).toMatchObject({
      path: '/api/schedule',
      method: 'POST',
      routerKind: 'App Router',
    });
  });

  it('does nothing (never throws) when PostHog is not configured', async () => {
    (getPostHogServer as ReturnType<typeof vi.fn>).mockReturnValue(null);
    await expect(
      onRequestError(new Error('x'), { path: '/p', method: 'GET' }, { routerKind: 'App Router' }),
    ).resolves.toBeUndefined();
  });

  it('never throws even if capture throws', async () => {
    (getPostHogServer as ReturnType<typeof vi.fn>).mockReturnValue({
      captureException: () => {
        throw new Error('posthog down');
      },
    });
    await expect(
      onRequestError(new Error('x'), { path: '/p', method: 'GET' }, { routerKind: 'App Router' }),
    ).resolves.toBeUndefined();
  });

  it('accepts non-Error values without throwing', async () => {
    const captureException = vi.fn();
    (getPostHogServer as ReturnType<typeof vi.fn>).mockReturnValue({ captureException });
    await expect(
      onRequestError('string failure', { path: '/p', method: 'GET' }, { routerKind: 'App Router' }),
    ).resolves.toBeUndefined();
    expect(captureException).toHaveBeenCalledTimes(1);
  });
});
