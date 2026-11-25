// @vitest-environment node
import { NextResponse } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { logger } from '@/lib/logger';
import { fetchMediaCheck } from '../media-check';
import { createPreflightShared } from '../preflight-shared';

function okResponse(): Response {
  return new Response(JSON.stringify({ status: 200, body: { code: 'ok', has_face: true } }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function stubFetch(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => okResponse());
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const REF = { segmentIndex: 0, imageIndex: 0, mediaId: 'aabbccddeeff00112233445566778899.jpg' };

describe('fetchMediaCheck with a shared context', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('MONEYPRINT_API_URL', 'https://engine.test');
    vi.stubEnv('MONEYPRINT_API_SECRET', 'engine-secret');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('asks the engine once for the same media id and aspect, whatever segment it sits in', async () => {
    const fetchMock = stubFetch();
    const shared = createPreflightShared(60_000);

    const first = await fetchMediaCheck(REF, 'user-1', '9:16', 'tag', shared);
    const second = await fetchMediaCheck({ ...REF, segmentIndex: 3, imageIndex: 2 }, 'user-1', '9:16', 'tag', shared);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it('shares one in-flight request between callers that ask at the same time', async () => {
    const fetchMock = stubFetch();
    const shared = createPreflightShared(60_000);

    await Promise.all([REF, REF, REF].map((ref) => fetchMediaCheck(ref, 'user-1', '9:16', 'tag', shared)));

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('asks again for another aspect, another media id, or a url with the same text', async () => {
    const fetchMock = stubFetch();
    const shared = createPreflightShared(60_000);

    await fetchMediaCheck(REF, 'user-1', '9:16', 'tag', shared);
    await fetchMediaCheck(REF, 'user-1', '16:9', 'tag', shared);
    await fetchMediaCheck({ ...REF, mediaId: 'other.jpg' }, 'user-1', '9:16', 'tag', shared);
    await fetchMediaCheck({ segmentIndex: 0, imageIndex: 0, url: REF.mediaId }, 'user-1', '9:16', 'tag', shared);

    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('asks every time without a shared context', async () => {
    const fetchMock = stubFetch();

    await fetchMediaCheck(REF, 'user-1', '9:16', 'tag');
    await fetchMediaCheck(REF, 'user-1', '9:16', 'tag');

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('stops a request when the shared budget runs out and fails closed with a 502', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
      ),
    );

    const result = await fetchMediaCheck(REF, 'user-1', '9:16', 'tag', createPreflightShared(10));

    expect(result).toBeInstanceOf(NextResponse);
    if (!(result instanceof NextResponse)) throw new Error('expected a response');
    expect(result.status).toBe(502);
  });

  it('logs a check cut off by the time budget as a warning, not an engine error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('The operation was aborted'); }));
    const budget = new AbortController();
    budget.abort();
    const shared = { ...createPreflightShared(60_000), signal: budget.signal };

    const outcome = await fetchMediaCheck(REF, 'user-1', '9:16', 'tag', shared);

    expect(outcome).toBeInstanceOf(NextResponse);
    expect(logger.warn).toHaveBeenCalledWith('[tag] media check stopped by the time budget');
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('keeps logging an unreachable engine as an error while the budget runs', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('connect refused'); }));

    await fetchMediaCheck(REF, 'user-1', '9:16', 'tag', createPreflightShared(60_000));

    expect(logger.error).toHaveBeenCalledWith('[tag] engine unreachable', expect.any(Error));
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
