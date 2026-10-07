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

import { createPost, useCreatePostMutation, seedCreatedPostCaches, type CreatePostInput, type CreatePostResult } from '@/lib/api';

const INPUT: CreatePostInput = {
  personaId: 'p1',
  topics: ['Topic one', 'Topic two'],
  providers: ['youtube'],
  accounts: { youtube: ['ch1'] },
  startAt: '2030-06-01T10:00:00.000Z',
  times: ['09:00', '18:00'],
  timezone: 'Europe/Lisbon',
  faceless: false,
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
      // Explicit, never omitted: the server prices the two cases differently.
      options: { faceless: false },
      publishing: {
        // Explicit, never omitted: the server defaults it, but the wire
        // contract states the mode so a proxy log is unambiguous.
        mode: 'scheduled',
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

  it('omits the schedule plan in asap mode', async () => {
    const fetchMock = stubFetch(jsonResponse({ ...SUCCESS_BODY, slots: [] }));

    await createPost({ ...INPUT, mode: 'asap', startAt: undefined, times: undefined });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as { publishing: Record<string, unknown> };
    expect(body.publishing.mode).toBe('asap');
    expect(body.publishing).not.toHaveProperty('schedule');
    // The browser zone still travels for display; the server defaults it.
    expect(body.publishing.timezone).toBe('Europe/Lisbon');
  });

  it('omits the timezone key in asap mode when none is provided', async () => {
    const fetchMock = stubFetch(jsonResponse({ ...SUCCESS_BODY, slots: [] }));

    await createPost({ ...INPUT, mode: 'asap', startAt: undefined, times: undefined, timezone: undefined });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as { publishing: Record<string, unknown> };
    expect(body.publishing.mode).toBe('asap');
    expect(body.publishing).not.toHaveProperty('schedule');
    expect(body.publishing).not.toHaveProperty('timezone');
  });

  it('reads scheduleMode from the response envelope', async () => {
    stubFetch(jsonResponse({ ...SUCCESS_BODY, schedule: { id: 's1', mode: 'asap' } }));

    const result = await createPost({ ...INPUT, mode: 'asap' });

    expect(result.success).toBe(true);
    expect(result.scheduleId).toBe('s1');
    expect(result.scheduleMode).toBe('asap');
  });

  it('narrows a missing or garbage schedule mode to null', async () => {
    stubFetch(jsonResponse(SUCCESS_BODY));
    expect((await createPost(INPUT)).scheduleMode).toBeNull();

    stubFetch(jsonResponse({ ...SUCCESS_BODY, schedule: { id: 's1', mode: 'someday' } }));
    expect((await createPost(INPUT)).scheduleMode).toBeNull();
  });

  it('sends options.faceless true when the post asks for no face', async () => {
    const fetchMock = stubFetch(jsonResponse({ ...SUCCESS_BODY, slots: [] }));

    await createPost({ ...INPUT, faceless: true });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as { options: { faceless: boolean } };
    expect(body.options.faceless).toBe(true);
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

  it('seeds the new slots into the schedule-status cache on success', async () => {
    stubFetch(jsonResponse(SUCCESS_BODY));
    const { client } = spyClient();
    // Pre-existing list data the Posts page already holds.
    client.setQueryData(['fill-schedule-status', 200], { upcoming: [], recent: [] });
    client.setQueryData(['fill-schedules'], []);

    const { result: hook } = renderHook(() => useCreatePostMutation(), { wrapper: wrapperFor(client) });
    await hook.current.mutateAsync(INPUT);

    const status = client.getQueryData<{ upcoming: { id: string }[] }>(['fill-schedule-status', 200]);
    expect(status?.upcoming.map((slot) => slot.id)).toEqual(['slot-1']);
  });
});

//---------------
// seedCreatedPostCaches — the /posts/new screen redirects to /posts the
// moment the create succeeds; the seed makes the new post visible on the
// first paint instead of waiting for the refetch race to settle.
//---------------

const SEED_RESULT: CreatePostResult = {
  success: true,
  scheduleId: 's-new',
  scheduleMode: 'scheduled',
  replayed: false,
  error: null,
  code: null,
  need: null,
  have: null,
  slots: [
    { slotId: 'slot-b', slotAt: '2030-06-02T09:00:00.000Z', topic: 'Topic two', taskId: null, status: 'pending' },
    { slotId: 'slot-a', slotAt: '2030-06-01T09:00:00.000Z', topic: 'Topic one', taskId: 't1', status: 'pending' },
  ],
};

function seedClient(): QueryClient {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['fill-schedule-status', 200], { upcoming: [], recent: [] });
  client.setQueryData(['fill-schedules'], []);
  return client;
}

describe('seedCreatedPostCaches', () => {
  it('merges the created slots into upcoming, sorted by slot time', () => {
    const client = seedClient();

    seedCreatedPostCaches(client, INPUT, SEED_RESULT);

    const status = client.getQueryData<{ upcoming: { id: string; slotAt: string }[] }>([
      'fill-schedule-status',
      200,
    ]);
    // Response order was b-then-a; the list shows them chronologically.
    expect(status?.upcoming.map((slot) => slot.id)).toEqual(['slot-a', 'slot-b']);
  });

  it('presents DB pending as awaiting with 0% progress and queue positions', () => {
    const client = seedClient();

    seedCreatedPostCaches(client, INPUT, SEED_RESULT);

    const status = client.getQueryData<{
      upcoming: {
        id: string;
        scheduleId: string;
        status: string;
        topic: string;
        taskId: string | null;
        progress: number;
        queuePosition: number | null;
        queueTotal: number | null;
      }[];
    }>(['fill-schedule-status', 200]);
    expect(status?.upcoming[0]).toMatchObject({
      scheduleId: 's-new',
      status: 'awaiting',
      topic: 'Topic one',
      taskId: 't1',
      progress: 0,
      queuePosition: 1,
      queueTotal: 2,
    });
    expect(status?.upcoming[1]).toMatchObject({ queuePosition: 2, queueTotal: 2 });
  });

  it('seeds the schedule so the posts page slots-against-schedules join keeps the new slots', () => {
    const client = seedClient();

    seedCreatedPostCaches(client, INPUT, SEED_RESULT);

    const schedules = client.getQueryData<
      { id: string; personaId: string; providers: string[]; youtubeAccountIds: string[] }[]
    >(['fill-schedules']);
    expect(schedules).toHaveLength(1);
    expect(schedules?.[0]).toMatchObject({
      id: 's-new',
      personaId: 'p1',
      providers: ['youtube'],
      youtubeAccountIds: ['ch1'],
    });
  });

  it('does not duplicate slots or the schedule when called twice', () => {
    const client = seedClient();

    seedCreatedPostCaches(client, INPUT, SEED_RESULT);
    seedCreatedPostCaches(client, INPUT, SEED_RESULT);

    const status = client.getQueryData<{ upcoming: { id: string }[] }>(['fill-schedule-status', 200]);
    expect(status?.upcoming).toHaveLength(2);
    expect(client.getQueryData<unknown[]>(['fill-schedules'])).toHaveLength(1);
  });

  it('does nothing without a schedule id or without slots', () => {
    const client = seedClient();

    seedCreatedPostCaches(client, INPUT, { ...SEED_RESULT, scheduleId: null });
    seedCreatedPostCaches(client, INPUT, { ...SEED_RESULT, scheduleId: 's-x', slots: [] });

    const status = client.getQueryData<{ upcoming: unknown[] }>(['fill-schedule-status', 200]);
    expect(status?.upcoming).toHaveLength(0);
    expect(client.getQueryData<unknown[]>(['fill-schedules'])).toHaveLength(0);
  });

  it('seeds an asap schedule with its publish mode', () => {
    const client = seedClient();

    seedCreatedPostCaches(client, { ...INPUT, mode: 'asap' }, { ...SEED_RESULT, scheduleMode: 'asap' });

    const schedules = client.getQueryData<{ id: string; publishMode: string; timezone: string }[]>([
      'fill-schedules',
    ]);
    expect(schedules?.[0]).toMatchObject({ id: 's-new', publishMode: 'asap' });
  });
});
