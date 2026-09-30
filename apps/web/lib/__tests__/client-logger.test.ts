//---------------
// client-logger — client-safe error reporter for "use client" components.
//
// The server logger (lib/logger.ts) pulls in posthog-node via
// lib/posthog-server.ts, which declares `import 'server-only'` and must
// never be bundled into client components. This module mirrors the
// server logger's error() call shape but reports to the browser
// PostHog SDK (initialized by instrumentation-client.ts).
//---------------

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('posthog-js', () => ({
  default: { captureException: vi.fn(), capture: vi.fn() },
}));

import posthog from 'posthog-js';
import { logClientError } from '@/lib/client-logger';

describe('logClientError', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes to console.error and reports the Error to browser PostHog', () => {
    const error = new Error('render boom');
    logClientError('React render error (global-error boundary)', error, { digest: 'abc' });

    expect(console.error).toHaveBeenCalledWith(
      'React render error (global-error boundary)',
      { digest: 'abc' },
      error,
    );
    expect(posthog.captureException).toHaveBeenCalledTimes(1);
    const [captured, props] = vi.mocked(posthog.captureException).mock.calls[0] as [
      unknown,
      Record<string, unknown>,
    ];
    expect(captured).toBe(error);
    expect(props).toMatchObject({
      message: 'React render error (global-error boundary)',
      digest: 'abc',
    });
  });

  it('works without metadata or error', () => {
    logClientError('upload failed');
    expect(console.error).toHaveBeenCalled();
    // No Error to capture: must not call captureException with garbage.
    expect(posthog.captureException).not.toHaveBeenCalled();
  });

  it('wraps non-Error values so PostHog still gets a useful exception', () => {
    logClientError('upload failed', 'string failure', { op: 'upload' });
    expect(posthog.captureException).toHaveBeenCalledTimes(1);
    const [captured] = vi.mocked(posthog.captureException).mock.calls[0] as [unknown];
    expect(captured).toBeInstanceOf(Error);
  });

  it('never throws even if the PostHog capture throws', () => {
    vi.mocked(posthog.captureException).mockImplementationOnce(() => {
      throw new Error('posthog down');
    });
    expect(() => logClientError('boom', new Error('x'))).not.toThrow();
    expect(console.error).toHaveBeenCalled();
  });
});
