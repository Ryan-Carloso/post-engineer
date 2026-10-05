//---------------
// withApiErrorReporting — unit tests.
//
// Next.js's onRequestError (instrumentation.ts) only fires for unhandled
// (thrown) errors. This wrapper closes the gap for handled responses:
// 5xx go to PostHog error tracking ($exception), 4xx (including 401/403)
// go as warnings (server_warning), 2xx go as plain success events
// (server_success) with the user id when the route opted in via getUserId.
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
  it('reports a 2xx as a server_success event (never an $exception)', async () => {
    const handler = vi.fn(async (_req: NextRequest) => NextResponse.json({ ok: true }));
    const wrapped = withApiErrorReporting('GET /api/test', handler);

    const req = getRequest();
    const res = await wrapped(req);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(handler).toHaveBeenCalledWith(req);
    await vi.waitFor(() => expect(client.capture).toHaveBeenCalledTimes(1));
    const [event, properties] = client.capture.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(event).toBe('server_success');
    expect(properties).toMatchObject({ route: 'GET /api/test', status: 200 });
    expect(client.captureException).not.toHaveBeenCalled();
  });

  it.each([201, 204])('reports a %i as a server_success event', async (status) => {
    const wrapped = withApiErrorReporting(
      'GET /api/test',
      async () => new NextResponse(null, { status }) as NextResponse,
    );

    const res = await wrapped(getRequest());

    expect(res.status).toBe(status);
    await vi.waitFor(() => expect(client.capture).toHaveBeenCalledTimes(1));
    const [event, properties] = client.capture.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(event).toBe('server_success');
    expect(properties).toMatchObject({ route: 'GET /api/test', status });
    expect(client.captureException).not.toHaveBeenCalled();
  });

  it('includes the user id in a 2xx success event when getUserId resolves', async () => {
    const wrapped = withApiErrorReporting(
      'GET /api/test',
      async () => NextResponse.json({ ok: true }),
      { getUserId: async () => 'user-123' },
    );

    await wrapped(getRequest());

    await vi.waitFor(() => expect(client.capture).toHaveBeenCalledTimes(1));
    const [event, properties] = client.capture.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(event).toBe('server_success');
    expect(properties).toMatchObject({ userId: 'user-123', status: 200 });
    expect(client.captureException).not.toHaveBeenCalled();
  });

  it('omits the user id from a 2xx when the route did not opt in via getUserId', async () => {
    const wrapped = withApiErrorReporting(
      'GET /api/test',
      async () => NextResponse.json({ ok: true }),
    );

    await wrapped(getRequest());

    await vi.waitFor(() => expect(client.capture).toHaveBeenCalledTimes(1));
    const [event, properties] = client.capture.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(event).toBe('server_success');
    expect(properties).not.toHaveProperty('userId');
  });

  it.each([301, 304])('does not report a %i redirect', async (status) => {
    const wrapped = withApiErrorReporting(
      'GET /api/test',
      async () => new NextResponse(null, { status }) as NextResponse,
    );

    const res = await wrapped(getRequest());

    expect(res.status).toBe(status);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(client.capture).not.toHaveBeenCalled();
    expect(client.captureException).not.toHaveBeenCalled();
  });

  it('does not report a 2xx outside production', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    const wrapped = withApiErrorReporting(
      'GET /api/test',
      async () => NextResponse.json({ ok: true }),
    );

    const res = await wrapped(getRequest());

    expect(res.status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(client.capture).not.toHaveBeenCalled();
    expect(client.captureException).not.toHaveBeenCalled();
  });

  it.each([400, 402, 404, 422, 429])(
    'reports a %i response as a server_warning (never an $exception)',
    async (status) => {
      const wrapped = withApiErrorReporting(
        'GET /api/test',
        async () =>
          NextResponse.json({ error: 'nope', code: 'BAD_INPUT' }, { status }),
      );

      const res = await wrapped(getRequest());

      expect(res.status).toBe(status);
      await vi.waitFor(() => expect(client.capture).toHaveBeenCalledTimes(1));
      const [event, properties] = client.capture.mock.calls[0] as [
        string,
        Record<string, unknown>,
      ];
      expect(event).toBe('server_warning');
      expect(properties).toMatchObject({
        route: 'GET /api/test',
        status,
        code: 'BAD_INPUT',
      });
      expect(client.captureException).not.toHaveBeenCalled();
      // The client-visible response is never mutated by reporting.
      expect(await res.json()).toMatchObject({ code: 'BAD_INPUT' });
    },
  );

  it.each([401, 403])(
    'reports a %i auth failure as a server_warning (never an $exception)',
    async (status) => {
      const wrapped = withApiErrorReporting(
        'GET /api/test',
        async () => NextResponse.json({ error: 'nope', code: 'UNAUTHORIZED' }, { status }),
      );

      const res = await wrapped(getRequest());

      expect(res.status).toBe(status);
      await vi.waitFor(() => expect(client.capture).toHaveBeenCalledTimes(1));
      const [event, properties] = client.capture.mock.calls[0] as [
        string,
        Record<string, unknown>,
      ];
      expect(event).toBe('server_warning');
      expect(properties).toMatchObject({
        route: 'GET /api/test',
        status,
        code: 'UNAUTHORIZED',
      });
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

  it.each(['"just a string"', '[1,2]', 'null'])(
    'reports a 500 with a JSON non-object body %s (no code extracted)',
    async (jsonBody) => {
      const wrapped = withApiErrorReporting(
        'GET /api/test',
        async () =>
          new NextResponse(jsonBody, {
            status: 500,
            headers: { 'content-type': 'application/json' },
          }) as NextResponse,
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
    },
  );

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

  it('skips a 4xx already reported by apiErrorResponse (no double server_warning)', async () => {
    const alreadyReported = NextResponse.json(
      { success: false, error: 'x', code: 'BAD_INPUT' },
      { status: 422 },
    );
    markApiErrorReported(alreadyReported);
    const wrapped = withApiErrorReporting('GET /api/test', async () => alreadyReported);

    const res = await wrapped(getRequest());

    expect(res.status).toBe(422);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(client.capture).not.toHaveBeenCalled();
    expect(client.captureException).not.toHaveBeenCalled();
  });

  it('does not report a 5xx outside production (dev/test noise stays out of PostHog)', async () => {
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

  it('does not warn on a 4xx outside production (dev/test noise stays out of PostHog)', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    const wrapped = withApiErrorReporting(
      'GET /api/test',
      async () => NextResponse.json({ error: 'x' }, { status: 404 }),
    );

    const res = await wrapped(getRequest());

    expect(res.status).toBe(404);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(client.capture).not.toHaveBeenCalled();
    expect(client.captureException).not.toHaveBeenCalled();
  });

  it('includes the user id in a 4xx warning when getUserId resolves', async () => {
    const wrapped = withApiErrorReporting(
      'GET /api/test',
      async () => NextResponse.json({ error: 'x' }, { status: 404 }),
      { getUserId: async () => 'user-123' },
    );

    await wrapped(getRequest());

    await vi.waitFor(() => expect(client.capture).toHaveBeenCalledTimes(1));
    const [event, properties] = client.capture.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(event).toBe('server_warning');
    expect(properties).toMatchObject({ userId: 'user-123', status: 404 });
  });

  it('includes the errorId from a 4xx body for correlation', async () => {
    const wrapped = withApiErrorReporting(
      'GET /api/test',
      async () =>
        NextResponse.json({ success: false, error: 'x', errorId: 'log-456' }, { status: 400 }),
    );

    await wrapped(getRequest());

    await vi.waitFor(() => expect(client.capture).toHaveBeenCalledTimes(1));
    const [event, properties] = client.capture.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(event).toBe('server_warning');
    expect(properties).toMatchObject({ errorId: 'log-456' });
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
