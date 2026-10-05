//---------------
// withApiErrorReporting — unit tests.
//
// Next.js's onRequestError (instrumentation.ts) only fires for unhandled
// (thrown) errors. This wrapper closes the gap for handled 5xx: routes
// that catch a failure and return a 500 response.
//---------------

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

vi.mock('@/lib/posthog-server', () => ({
  getPostHogServer: vi.fn(),
}));

import { getPostHogServer } from '@/lib/posthog-server';
import {
  withApiErrorReporting,
  markApiErrorReported,
} from '@/lib/api-error-reporting';

const mockGetPostHogServer = vi.mocked(getPostHogServer);

function fakeClient() {
  return {
    capture: vi.fn(),
    captureAs: vi.fn(),
    captureException: vi.fn(),
  };
}

let client: ReturnType<typeof fakeClient>;

function getRequest(path = 'http://localhost/api/test', method = 'GET'): NextRequest {
  return new NextRequest(path, { method });
}

beforeEach(() => {
  client = fakeClient();
  mockGetPostHogServer.mockReturnValue(client);
  vi.stubEnv('NODE_ENV', 'production');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('withApiErrorReporting', () => {
  it('passes a 2xx response through unchanged and reports nothing', async () => {
    const handler = vi.fn(async (_req: NextRequest) => NextResponse.json({ ok: true }));
    const wrapped = withApiErrorReporting('GET /api/test', handler);

    const req = getRequest();
    const res = await wrapped(req);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(handler).toHaveBeenCalledWith(req);
    expect(client.captureException).not.toHaveBeenCalled();
  });

  it.each([400, 401, 403, 404, 422, 429])(
    'does not report a %i response',
    async (status) => {
      const wrapped = withApiErrorReporting(
        'GET /api/test',
        async () => NextResponse.json({ error: 'nope' }, { status }),
      );

      const res = await wrapped(getRequest());

      expect(res.status).toBe(status);
      expect(client.captureException).not.toHaveBeenCalled();
    },
  );

  it('reports a 500 response via captureException with route, status and code', async () => {
    const wrapped = withApiErrorReporting(
      'POST /api/videos/generate-and-schedule',
      async () =>
        NextResponse.json(
          { success: false, error: 'Something went wrong.', code: 'INTERNAL_ERROR' },
          { status: 500 },
        ),
    );

    const res = await wrapped(
      getRequest('http://localhost/api/videos/generate-and-schedule', 'POST'),
    );

    expect(res.status).toBe(500);
    await vi.waitFor(() => expect(client.captureException).toHaveBeenCalledTimes(1));

    const [error, properties] = client.captureException.mock.calls[0] as [
      Error,
      Record<string, unknown>,
    ];
    expect(error).toBeInstanceOf(Error);
    expect(properties).toMatchObject({
      route: 'POST /api/videos/generate-and-schedule',
      status: 500,
      code: 'INTERNAL_ERROR',
    });
    // The client-visible response is never mutated by reporting.
    expect(await res.json()).toMatchObject({
      success: false,
      code: 'INTERNAL_ERROR',
    });
  });

  it('reports 5xx other than 500 (e.g. 502, 503)', async () => {
    const wrapped = withApiErrorReporting(
      'GET /api/health',
      async () => NextResponse.json({ status: 'error' }, { status: 503 }),
    );

    const res = await wrapped(getRequest('http://localhost/api/health'));

    expect(res.status).toBe(503);
    await vi.waitFor(() => expect(client.captureException).toHaveBeenCalledTimes(1));
    const [, properties] = client.captureException.mock.calls[0] as [
      Error,
      Record<string, unknown>,
    ];
    expect(properties).toMatchObject({ route: 'GET /api/health', status: 503 });
  });

  it('reports a 500 with a non-JSON body (no code extracted, still reported)', async () => {
    const wrapped = withApiErrorReporting(
      'GET /api/test',
      async () => new NextResponse('boom', { status: 500 }) as NextResponse,
    );

    const res = await wrapped(getRequest());

    expect(res.status).toBe(500);
    await vi.waitFor(() => expect(client.captureException).toHaveBeenCalledTimes(1));
    const [, properties] = client.captureException.mock.calls[0] as [
      Error,
      Record<string, unknown>,
    ];
    expect(properties).toMatchObject({ route: 'GET /api/test', status: 500 });
    expect(properties).not.toHaveProperty('code');
  });

  it('lets a thrown handler error propagate without reporting (onRequestError owns those)', async () => {
    const boom = new Error('boom');
    const wrapped = withApiErrorReporting('GET /api/test', async () => {
      throw boom;
    });

    await expect(wrapped(getRequest())).rejects.toThrow('boom');
    // Give the fire-and-forget path a chance to (incorrectly) run.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(client.captureException).not.toHaveBeenCalled();
  });

  it('passes extra args (route params context) through to the handler', async () => {
    const handler = vi.fn(
      async (_req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
        const { id } = await ctx.params;
        return NextResponse.json({ id });
      },
    );
    const wrapped = withApiErrorReporting('DELETE /api/api-keys/[id]', handler);

    const res = await wrapped(getRequest(), { params: Promise.resolve({ id: 'k1' }) });

    expect(await res.json()).toEqual({ id: 'k1' });
    expect(client.captureException).not.toHaveBeenCalled();
  });

  it('skips responses already reported by apiErrorResponse (no double $exception)', async () => {
    const alreadyReported = NextResponse.json(
      { success: false, error: 'x', code: 'INTERNAL_ERROR' },
      { status: 500 },
    );
    markApiErrorReported(alreadyReported);
    const wrapped = withApiErrorReporting('GET /api/test', async () => alreadyReported);

    const res = await wrapped(getRequest());

    expect(res.status).toBe(500);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(client.captureException).not.toHaveBeenCalled();
  });

  it('does not report outside production (dev/test noise stays out of PostHog)', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    const wrapped = withApiErrorReporting(
      'GET /api/test',
      async () => NextResponse.json({ error: 'x' }, { status: 500 }),
    );

    const res = await wrapped(getRequest());

    expect(res.status).toBe(500);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(client.captureException).not.toHaveBeenCalled();
  });

  it('returns the response untouched when PostHog is unconfigured (null client)', async () => {
    mockGetPostHogServer.mockReturnValue(null);
    const wrapped = withApiErrorReporting(
      'GET /api/test',
      async () => NextResponse.json({ error: 'x' }, { status: 500 }),
    );

    const res = await wrapped(getRequest());

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'x' });
  });

  it('returns the response untouched when the PostHog client throws', async () => {
    mockGetPostHogServer.mockImplementation(() => {
      throw new Error('posthog exploded');
    });
    const wrapped = withApiErrorReporting(
      'GET /api/test',
      async () => NextResponse.json({ error: 'x' }, { status: 500 }),
    );

    const res = await wrapped(getRequest());

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'x' });
  });

  it('includes the user id in properties when getUserId resolves', async () => {
    const wrapped = withApiErrorReporting('GET /api/test', async () => NextResponse.json({ error: 'x' }, { status: 500 }), {
      getUserId: async () => 'user-123',
    });

    await wrapped(getRequest());

    await vi.waitFor(() => expect(client.captureException).toHaveBeenCalledTimes(1));
    const [, properties] = client.captureException.mock.calls[0] as [
      Error,
      Record<string, unknown>,
    ];
    expect(properties).toMatchObject({ userId: 'user-123' });
  });

  it('still reports when getUserId throws (user id is best-effort)', async () => {
    const wrapped = withApiErrorReporting('GET /api/test', async () => NextResponse.json({ error: 'x' }, { status: 500 }), {
      getUserId: () => {
        throw new Error('auth exploded');
      },
    });

    const res = await wrapped(getRequest());

    expect(res.status).toBe(500);
    await vi.waitFor(() => expect(client.captureException).toHaveBeenCalledTimes(1));
    const [, properties] = client.captureException.mock.calls[0] as [
      Error,
      Record<string, unknown>,
    ];
    expect(properties).not.toHaveProperty('userId');
  });

  it('reports a 500 from a zero-arg handler without crashing on the missing request', async () => {
    const wrapped = withApiErrorReporting(
      'GET /api/health',
      async () => NextResponse.json({ status: 'error' }, { status: 500 }),
      { getUserId: async () => 'user-123' },
    );

    const res = await wrapped();

    expect(res.status).toBe(500);
    await vi.waitFor(() => expect(client.captureException).toHaveBeenCalledTimes(1));
    const [, properties] = client.captureException.mock.calls[0] as [
      Error,
      Record<string, unknown>,
    ];
    // No request to resolve the user from — reported without a user id.
    expect(properties).toMatchObject({ route: 'GET /api/health', status: 500 });
    expect(properties).not.toHaveProperty('userId');
  });

  it('includes the errorId from the body for correlation', async () => {
    const wrapped = withApiErrorReporting(
      'GET /api/test',
      async () =>
        NextResponse.json({ success: false, error: 'x', errorId: 'log-123' }, { status: 500 }),
    );

    await wrapped(getRequest());

    await vi.waitFor(() => expect(client.captureException).toHaveBeenCalledTimes(1));
    const [, properties] = client.captureException.mock.calls[0] as [
      Error,
      Record<string, unknown>,
    ];
    expect(properties).toMatchObject({ errorId: 'log-123' });
  });
});
