import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

//---------------
// api.ts — createPost / useCreatePostMutation
//
// The client must never treat a non-2xx, non-JSON, or success:false
// response as a created post: the /posts/new screen redirects to /posts on
// success, and that would hide a schedule that does not exist. Network is
// stubbed at the fetch boundary (the mutation calls the module-local
// createPost, which a module mock would not intercept).
//---------------

import { createPost, useCreatePostMutation, type CreatePostInput } from '@/lib/api';

const INPUT: CreatePostInput = {
  personaId: 'p1',
  topics: ['Topic one', 'Topic two'],
  providers: ['youtube'],
  accounts: { youtube: ['ch1'] },
  startAt: '2030-06-01T10:00:00.000Z',
  times: ['09:00', '18:00'],
  timezone: 'Europe/Lisbon',
};

const SUCCESS_BODY = {
  success: true,
  schedule: { id: 's1' },
  replayed: false,
  slots: [
    {
      slotId: 'slot-1',
      slotAt: '2030-06-01T09:00:00.000Z',
      topic: 'Topic one',
      taskId: 't1',
      status: 'generating',
    },
  ],
};

function jsonResponse(data: unknown, init: { ok?: boolean; status?: number } = {}): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => data,
  } as unknown as Response;
}

function stubFetch(response: Response): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => response);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** QueryClient whose invalidateQueries is a spy, so cache updates are observable. */
function spyClient(): { client: QueryClient; invalidate: ReturnType<typeof vi.fn> } {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidate = vi.fn(async () => Promise.resolve());
  client.invalidateQueries = invalidate as unknown as typeof client.invalidateQueries;
  return { client, invalidate };
}

function wrapperFor(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe('createPost', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts the generate-and-schedule payload', async () => {
    const fetchMock = stubFetch(jsonResponse({ ...SUCCESS_BODY, slots: [] }));

    await createPost(INPUT);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/videos/generate-and-schedule');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      personaId: 'p1',
      topics: ['Topic one', 'Topic two'],
      publishing: {
        providers: ['youtube'],
        accounts: { youtube: ['ch1'] },
        schedule: {
          startAt: '2030-06-01T10:00:00.000Z',
          times: ['09:00', '18:00'],
          timezone: 'Europe/Lisbon',
        },
      },
    });
  });

  it('returns the created schedule and slots', async () => {
    stubFetch(jsonResponse(SUCCESS_BODY));

    const result = await createPost(INPUT);

    expect(result.success).toBe(true);
    expect(result.scheduleId).toBe('s1');
    expect(result.error).toBeNull();
    expect(result.code).toBeNull();
    expect(result.slots).toEqual([
      { slotId: 'slot-1', slotAt: '2030-06-01T09:00:00.000Z', topic: 'Topic one', taskId: 't1', status: 'generating' },
    ]);
  });

  it('drops malformed slot entries instead of passing undefined to the UI', async () => {
    stubFetch(
      jsonResponse({
        ...SUCCESS_BODY,
        slots: [
          { slotId: 'slot-1', slotAt: '2030-06-01T09:00:00.000Z', topic: 'Topic one' },
          { topic: 'no ids' },
          'garbage',
        ],
      }),
    );

    const result = await createPost(INPUT);

    expect(result.slots).toHaveLength(1);
    expect(result.slots[0].taskId).toBeNull();
    expect(result.slots[0].status).toBe('pending');
  });

  it('surfaces the machine code and token shortfall on 402', async () => {
    stubFetch(
      jsonResponse(
        {
          success: false,
          error: 'You need 4 tokens, but only have 1.',
          code: 'INSUFFICIENT_TOKENS',
          have: 1,
          need: 4,
        },
        { ok: false, status: 402 },
      ),
    );

    const result = await createPost(INPUT);

    expect(result.success).toBe(false);
    expect(result.code).toBe('INSUFFICIENT_TOKENS');
    expect(result.need).toBe(4);
    expect(result.have).toBe(1);
    expect(result.scheduleId).toBeNull();
  });

  it('treats success:false on a 200 as a failure', async () => {
    stubFetch(
      jsonResponse({
        success: false,
        error: 'Video generation is temporarily unavailable.',
        code: 'ENGINE_UNAVAILABLE',
      }),
    );

    const result = await createPost(INPUT);

    expect(result.success).toBe(false);
    expect(result.code).toBe('ENGINE_UNAVAILABLE');
  });

  it('never throws on an unreadable body (proxy HTML error page)', async () => {
    stubFetch({
      ok: false,
      status: 502,
      json: async () => {
        throw new SyntaxError('Unexpected token <');
      },
    } as unknown as Response);

    const result = await createPost(INPUT);

    expect(result.success).toBe(false);
    expect(result.error).toContain('502');
    expect(result.slots).toEqual([]);
  });

  it('keeps the schedule id on a partial failure so the UI can link to it', async () => {
    stubFetch(
      jsonResponse(
        {
          success: false,
          error: 'Video generation failed.',
          code: 'INTERNAL_ERROR',
          schedule: { id: 's9' },
          slots: [
            { slotId: 'slot-9', slotAt: '2030-06-01T09:00:00.000Z', topic: 'Topic one', taskId: null, status: 'failed' },
          ],
        },
        { ok: false, status: 502 },
      ),
    );

    const result = await createPost(INPUT);

    expect(result.success).toBe(false);
    expect(result.scheduleId).toBe('s9');
    expect(result.slots[0].status).toBe('failed');
  });
});

describe('useCreatePostMutation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('invalidates the posts caches on success', async () => {
    stubFetch(jsonResponse(SUCCESS_BODY));
    const { client, invalidate } = spyClient();

    const { result: hook } = renderHook(() => useCreatePostMutation(), { wrapper: wrapperFor(client) });
    await hook.current.mutateAsync(INPUT);

    await waitFor(() => {
      const keys = invalidate.mock.calls.map((call) => (call[0] as { queryKey: unknown[] }).queryKey[0]);
      expect(keys).toEqual(
        expect.arrayContaining(['fill-schedule-status', 'fill-schedules', 'video-generations']),
      );
    });
  });

  it('does not invalidate anything when the create failed', async () => {
    stubFetch(
      jsonResponse(
        { success: false, error: 'nope', code: 'INSUFFICIENT_TOKENS', have: 1, need: 4 },
        { ok: false, status: 402 },
      ),
    );
    const { client, invalidate } = spyClient();

    const { result: hook } = renderHook(() => useCreatePostMutation(), { wrapper: wrapperFor(client) });
    await hook.current.mutateAsync(INPUT);

    expect(invalidate).not.toHaveBeenCalled();
  });
});
