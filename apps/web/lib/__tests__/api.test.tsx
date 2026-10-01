import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

const mockGetSession = vi.fn();

vi.mock('@/lib/supabase/client', () => ({
  createSupabaseClient: () => ({
    auth: {
      getSession: mockGetSession,
    },
  }),
}));

function jsonResponse(data: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => data,
  } as unknown as Response;
}

//---------------
// api.ts — fetchers and React Query hooks
//---------------

describe('api', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url === '/api/account') {
          return jsonResponse({
            authenticated: true,
            accounts: [
              { provider: 'youtube', channelId: 'ch-1', channelName: 'Canal', recordId: 'r1', connectedAt: 5, lastUsed: 6, statistics: { viewCount: '10' } },
              { provider: 'instagram', igUserId: 'ig-1', username: 'foo', recordId: 'r3', followersCount: 3, mediaCount: 4 },
              { provider: 'twitter' },
            ],
          });
        }
        if (url === '/api/health') return jsonResponse({ status: 'ok' });
        if (url === '/api/google-oauth/start') return jsonResponse({ url: 'http://oauth' });
        if (url === '/api/instagram-auth/start') return jsonResponse({ url: 'http://ig' });
        if (url === '/api/upload-content') return jsonResponse({ success: true }, false, 500);
        if (url === '/api/schedule') {
          return jsonResponse({
            success: true,
            schedules: [
              {
                id: 's-1', persona_id: 'p-1', providers: ['youtube', 'linkedin'],
                youtube_account_ids: ['yt-1'], instagram_account_ids: [], linkedin_account_ids: ['urn:li:person:1'],
                days_of_week: [1], start_hour: 9, end_hour: 18, posts_per_day: 1, timezone: 'UTC', active: true,
              },
            ],
          });
        }
        if (url.startsWith('/api/schedule/status')) {
          return jsonResponse({ success: true, upcoming: [], recent: [] });
        }
        return jsonResponse({});
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetchYouTubeAccounts filters and maps YouTube accounts', async () => {
    const { fetchYouTubeAccounts } = await import('@/lib/api');
    const data = await fetchYouTubeAccounts();

    expect(data.authenticated).toBe(true);
    expect(data.accounts).toHaveLength(1);
    expect(data.accounts[0]).toMatchObject({
      channelId: 'ch-1',
      channelName: 'Canal',
      recordId: 'r1',
      connectedAt: 5,
      lastUsed: 6,
    });
  });

  it('fetchInstagramAccounts filters and maps Instagram accounts', async () => {
    const { fetchInstagramAccounts } = await import('@/lib/api');
    const data = await fetchInstagramAccounts();

    expect(data.accounts).toHaveLength(1);
    expect(data.accounts[0]).toMatchObject({
      igUserId: 'ig-1',
      username: 'foo',
      followersCount: 3,
      mediaCount: 4,
    });
  });

  it('fetchYouTubeAccounts propagates network errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      })
    );

    const { fetchYouTubeAccounts } = await import('@/lib/api');
    await expect(fetchYouTubeAccounts()).rejects.toThrow('network down');
  });

  it('fetchSession returns null when there is no session', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: null },
      error: null,
    });

    const { fetchSession } = await import('@/lib/api');
    expect(await fetchSession()).toBeNull();
  });

  it('fetchSession returns null on error', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: null },
      error: { message: 'expired' },
    });

    const { fetchSession } = await import('@/lib/api');
    expect(await fetchSession()).toBeNull();
  });

  it('fetchSession returns the session user', async () => {
    mockGetSession.mockResolvedValue({
      data: {
        session: {
          user: { id: 'u1', email: 'a@b.c', user_metadata: { name: 'A' } },
        },
      },
      error: null,
    });

    const { fetchSession } = await import('@/lib/api');
    const user = await fetchSession();
    expect(user?.id).toBe('u1');
  });

  //---------------
  // Hooks — renderHook with QueryClientProvider
  //---------------

  function createWrapper(): (props: { children: ReactNode }) => ReactNode {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    return ({ children }) =>
      QueryClientProvider({ client, children }) as ReactNode;
  }

  it('useYouTubeAccountsQuery loads accounts', async () => {
    const { useYouTubeAccountsQuery } = await import('@/lib/api');
    const { result } = renderHook(() => useYouTubeAccountsQuery(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.accounts).toHaveLength(1);
  });

  it('useInstagramAccountsQuery loads accounts', async () => {
    const { useInstagramAccountsQuery } = await import('@/lib/api');
    const { result } = renderHook(() => useInstagramAccountsQuery(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.accounts).toHaveLength(1);
  });

  it('shares account data between consumers and refreshes only the invalidated network', async () => {
    const { useYouTubeAccountsQuery, useInstagramAccountsQuery } = await import('@/lib/api');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }): ReactNode => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const first = renderHook(() => ({ youtube: useYouTubeAccountsQuery(), instagram: useInstagramAccountsQuery() }), { wrapper });
    const second = renderHook(() => ({ youtube: useYouTubeAccountsQuery(), instagram: useInstagramAccountsQuery() }), { wrapper });

    await waitFor(() => {
      expect(first.result.current.youtube.isSuccess).toBe(true);
      expect(second.result.current.instagram.isSuccess).toBe(true);
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(first.result.current.youtube.data).toBe(second.result.current.youtube.data);
    expect(first.result.current.instagram.data).toBe(second.result.current.instagram.data);

    first.unmount();
    second.unmount();
    const remounted = renderHook(() => ({ youtube: useYouTubeAccountsQuery(), instagram: useInstagramAccountsQuery() }), { wrapper });
    expect(remounted.result.current.youtube.isSuccess).toBe(true);
    expect(remounted.result.current.instagram.isSuccess).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);

    await act(async () => {
      await client.invalidateQueries({ queryKey: ['youtube-accounts'] });
    });
    expect(fetch).toHaveBeenCalledTimes(3);
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['instagram-accounts'] });
    });
    expect(fetch).toHaveBeenCalledTimes(4);
    remounted.unmount();
    client.clear();
  });

  it('exposes account loading failures instead of treating them as an empty account list', async () => {
    const { useYouTubeAccountsQuery, useInstagramAccountsQuery } = await import('@/lib/api');
    vi.mocked(fetch).mockRejectedValue(new Error('Accounts unavailable'));
    const { result } = renderHook(() => ({ youtube: useYouTubeAccountsQuery(), instagram: useInstagramAccountsQuery() }), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.youtube.isError).toBe(true);
      expect(result.current.instagram.isError).toBe(true);
    });
    expect(result.current.youtube.data).toBeUndefined();
    expect(result.current.instagram.data).toBeUndefined();
    expect(result.current.youtube.error?.message).toBe('Accounts unavailable');
    expect(result.current.instagram.error?.message).toBe('Accounts unavailable');
  });

  it('useSchedulesQuery maps linkedin_account_ids', async () => {
    const { useSchedulesQuery } = await import('@/lib/api');
    const { result } = renderHook(() => useSchedulesQuery(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.[0]?.linkedinAccountIds).toEqual(['urn:li:person:1']);
  });

  it('useScheduleStatusQuery forwards the limit as a query param', async () => {
    const { useScheduleStatusQuery } = await import('@/lib/api');
    const { result } = renderHook(() => useScheduleStatusQuery(200), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetch).toHaveBeenCalledWith('/api/schedule/status?limit=200');
  });

  it('useScheduleStatusQuery omits the limit param when no limit is given', async () => {
    const { useScheduleStatusQuery } = await import('@/lib/api');
    const { result } = renderHook(() => useScheduleStatusQuery(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetch).toHaveBeenCalledWith('/api/schedule/status');
  });

  it('updateSchedule sends only the changed fields in PATCH', async () => {
    const { updateSchedule } = await import('@/lib/api');
    await updateSchedule('s-1', { linkedinAccountIds: ['urn:li:org:9'] });

    expect(fetch).toHaveBeenCalledWith('/api/schedule', expect.objectContaining({ method: 'PATCH' }));
    const call = vi.mocked(fetch).mock.calls.find(([url]) => String(url) === '/api/schedule');
    const init = call?.[1] as { body: string };
    const payload = JSON.parse(init.body) as Record<string, unknown>;
    expect(payload).toMatchObject({
      id: 's-1',
      linkedinAccountIds: ['urn:li:org:9'],
    });
    // Fields not sent must not appear in the payload — the server preserves them.
    expect(payload).not.toHaveProperty('youtubeAccountIds');
    expect(payload).not.toHaveProperty('instagramAccountIds');
  });

  it('useSessionQuery loads the session', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { user: { id: 'u9', user_metadata: {} } } },
      error: null,
    });

    const { useSessionQuery } = await import('@/lib/api');
    const { result } = renderHook(() => useSessionQuery(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.id).toBe('u9');
  });


  it('disconnectAccount calls DELETE /api/account with provider and providerAccountId', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ success: true }));
    const { disconnectAccount } = await import('@/lib/api');
    const result = await disconnectAccount('instagram', 'ig-1');
    expect(result.success).toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      '/api/account?provider=instagram&providerAccountId=ig-1',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('useDisconnectAccountMutation invalidates the disconnected network query', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ success: true }));
    const { useDisconnectAccountMutation } = await import('@/lib/api');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }): ReactNode => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useDisconnectAccountMutation('youtube'), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ providerAccountId: 'ch-1' });
    });
    expect(fetch).toHaveBeenCalledWith(
      '/api/account?provider=youtube&providerAccountId=ch-1',
      expect.objectContaining({ method: 'DELETE' }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['youtube-accounts'] });
    invalidateSpy.mockRestore();
  });

  it('useDisconnectAccountMutation removes the disconnected account from the upload selection', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ success: true }));
    const { useUploadStore } = await import('@/lib/store');
    const { useDisconnectAccountMutation } = await import('@/lib/api');
    useUploadStore.getState().toggleSelectedAccount('youtube', 'ch-1');
    useUploadStore.getState().toggleSelectedAccount('youtube', 'ch-2');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }): ReactNode => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useDisconnectAccountMutation('youtube'), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ providerAccountId: 'ch-1' });
    });
    expect(useUploadStore.getState().selectedAccountIds.youtube).toEqual(['ch-2']);
  });

  it('useDisconnectAccountMutation works for providers without selection (bluesky)', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ success: true }));
    const { useDisconnectAccountMutation } = await import('@/lib/api');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }): ReactNode => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useDisconnectAccountMutation('bluesky'), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ providerAccountId: 'bsky1' });
    });
    expect(fetch).toHaveBeenCalledWith(
      '/api/account?provider=bluesky&providerAccountId=bsky1',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('uploadPersonaImage surfaces server warnings instead of discarding them', async () => {
    // The POST/PATCH partial-success contract reports warnings (e.g. the
    // image uploaded but the primary swap failed). The mutation result
    // must carry them so the UI can show them.
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        success: true,
        image: { id: 'img-1' },
        warnings: ['primary_swap_failed'],
      }),
    );
    const { uploadPersonaImage } = await import('@/lib/api');
    const result = await uploadPersonaImage('p-1', {
      file: new File(['x'], 'a.png', { type: 'image/png' }),
    });
    expect(result.success).toBe(true);
    expect(result.warnings).toEqual(['primary_swap_failed']);
  });

  it('uploadPersonaImage drops a malformed warnings payload instead of crashing', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ success: true, image: { id: 'img-1' }, warnings: 'not-an-array' }),
    );
    const { uploadPersonaImage } = await import('@/lib/api');
    const result = await uploadPersonaImage('p-1', {
      file: new File(['x'], 'a.png', { type: 'image/png' }),
    });
    expect(result.success).toBe(true);
    expect(result.warnings ?? []).toHaveLength(0);
  });

  it('useUpdatePersonaImageMutation requires personaId like the upload hook', async () => {
    // A null personaId must fail loudly at call time — otherwise onSuccess
    // invalidates the ['persona-images', null] query key, a stale-cache bug.
    const { useUpdatePersonaImageMutation } = await import('@/lib/api');
    const { result } = renderHook(() => useUpdatePersonaImageMutation(null), {
      wrapper: createWrapper(),
    });
    await expect(
      result.current.mutateAsync({ id: 'img-1', tag: 'x' }),
    ).rejects.toThrow('personaId is required.');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('useDeletePersonaImageMutation requires personaId like the upload hook', async () => {
    const { useDeletePersonaImageMutation } = await import('@/lib/api');
    const { result } = renderHook(() => useDeletePersonaImageMutation(null), {
      wrapper: createWrapper(),
    });
    await expect(result.current.mutateAsync('img-1')).rejects.toThrow('personaId is required.');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('updatePersonaImage rejects isPrimary:false without a network call', async () => {
    const { updatePersonaImage } = await import('@/lib/api');
    // The type is isPrimary?: true; the runtime guard protects JS callers.
    await expect(
      updatePersonaImage({ id: 'img-1', isPrimary: false as unknown as true }),
    ).rejects.toThrow('isPrimary cannot be false');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('useScheduleStatusQuery exposes the numeric slot progress', async () => {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/schedule/status')) {
        return jsonResponse({
          success: true,
          upcoming: [
            { id: 'up-1', schedule_id: 's-1', slot_at: '2026-09-24T10:00:00Z', status: 'awaiting', topic: 'T', task_id: 'task-1', progress: 45, stage: null, queuePosition: 2, queueTotal: 3, retryable: null },
          ],
          recent: [
            { id: 're-1', schedule_id: 's-1', slot_at: '2026-09-20T10:00:00Z', status: 'failed', topic: 'O', progress: 80, stage: null, queuePosition: null, queueTotal: null, retryable: true, error: 'boom' },
          ],
        });
      }
      return jsonResponse({});
    });
    const { useScheduleStatusQuery } = await import('@/lib/api');
    const { result } = renderHook(() => useScheduleStatusQuery(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.upcoming[0]?.progress).toBe(45);
    expect(result.current.data?.upcoming[0]?.status).toBe('awaiting');
    expect(result.current.data?.upcoming[0]?.taskId).toBe('task-1');
    expect(result.current.data?.upcoming[0]?.queuePosition).toBe(2);
    expect(result.current.data?.upcoming[0]?.queueTotal).toBe(3);
    expect(result.current.data?.recent[0]?.progress).toBe(80);
    expect(result.current.data?.recent[0]?.retryable).toBe(true);
  });

  //---------------
  // Per-slot operations (Posts page: edit topic, delete scheduled slot).
  //---------------

  it('updateSlotTopic PATCHes /api/schedule/slots/:id with the topic', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ success: true, topic: 'Novo tema' }));
    const { updateSlotTopic } = await import('@/lib/api');
    const topic = await updateSlotTopic('slot-1', 'Novo tema');
    expect(topic).toBe('Novo tema');
    expect(fetch).toHaveBeenCalledWith(
      '/api/schedule/slots/slot-1',
      expect.objectContaining({ method: 'PATCH' }),
    );
  });

  it('updateSlotTopic throws on failure', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ success: false, error: 'Only a slot that has not started generating can be edited.' }, false, 409),
    );
    const { updateSlotTopic } = await import('@/lib/api');
    await expect(updateSlotTopic('slot-1', 'x')).rejects.toThrow('Only a slot that has not started generating can be edited.');
  });

  it('deleteSlot calls DELETE /api/schedule/slots/:id and throws on failure', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ success: true }));
    const { deleteSlot } = await import('@/lib/api');
    await expect(deleteSlot('slot-1')).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledWith(
      '/api/schedule/slots/slot-1',
      expect.objectContaining({ method: 'DELETE' }),
    );

    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ success: false, error: 'A published post cannot be deleted.' }, false, 409),
    );
    await expect(deleteSlot('slot-2')).rejects.toThrow('A published post cannot be deleted.');
  });

  it('slot mutations invalidate the schedule status cache on success', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ success: true }));
    const { useUpdateSlotMutation, useDeleteSlotMutation } = await import('@/lib/api');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }): ReactNode => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');

    const { result: updateResult } = renderHook(() => useUpdateSlotMutation(), { wrapper });
    await act(async () => {
      await updateResult.current.mutateAsync({ slotId: 'slot-1', topic: 'Novo tema' });
    });
    const { result: deleteResult } = renderHook(() => useDeleteSlotMutation(), { wrapper });
    await act(async () => {
      await deleteResult.current.mutateAsync('slot-1');
    });

    const invalidatedKeys = invalidateSpy.mock.calls.map((c) => (c[0] as { queryKey: unknown[] })?.queryKey);
    expect(invalidatedKeys).toContainEqual(['fill-schedule-status']);
    invalidateSpy.mockRestore();
  });

  //---------------
  // Detail endpoints — one post per request, so the detail page never
  // needs to pull the whole history to find a single id. A 404 resolves
  // to null (not found), other failures throw.
  //---------------

  it('fetchSlotDetail GETs /api/schedule/slots/:id and maps the payload', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({
      success: true,
      slot: { id: 'slot-1', scheduleId: 's1', slotAt: '2030-06-01T10:00:00.000Z', status: 'awaiting', topic: 'T', error: null, publishedAt: null, taskId: null, progress: 0, stage: null, retryable: null },
      schedule: { id: 's1', personaId: 'p1', providers: ['youtube'], youtubeAccountIds: ['ch1'], instagramAccountIds: [], linkedinAccountIds: [] },
      persona: { id: 'p1', name: 'Viva Leve' },
    }));
    const { fetchSlotDetail } = await import('@/lib/api');
    const detail = await fetchSlotDetail('slot-1');
    expect(detail?.slot.id).toBe('slot-1');
    expect(detail?.persona?.name).toBe('Viva Leve');
    expect(fetch).toHaveBeenCalledWith('/api/schedule/slots/slot-1', expect.objectContaining({ method: 'GET' }));
  });

  it('fetchSlotDetail resolves null on 404 and throws on other failures', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ success: false, error: 'Slot not found.' }, false, 404),
    );
    const { fetchSlotDetail } = await import('@/lib/api');
    await expect(fetchSlotDetail('missing')).resolves.toBeNull();

    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ success: false, error: 'boom' }, false, 500),
    );
    await expect(fetchSlotDetail('slot-1')).rejects.toThrow('boom');
  });

  it('fetchGenerationDetail GETs /api/persona/video-generations/:id, null on 404', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({
      success: true,
      generation: { id: 'row-1', generationId: 'gen-3', engineTaskId: 'task-3', personaName: 'Viva Leve', videoSubject: 'Launch recap', status: 'completed', errorCode: null, tokensRefunded: false, createdAt: '2026-09-23T12:00:00.000Z', completedAt: '2026-09-23T12:02:00.000Z' },
    }));
    const { fetchGenerationDetail } = await import('@/lib/api');
    const detail = await fetchGenerationDetail('gen-3');
    expect(detail?.engineTaskId).toBe('task-3');
    expect(fetch).toHaveBeenCalledWith('/api/persona/video-generations/gen-3', expect.objectContaining({ method: 'GET' }));

    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ success: false, error: 'Generation not found.' }, false, 404),
    );
    await expect(fetchGenerationDetail('missing')).resolves.toBeNull();
  });

  it('detail queries are keyed by id and disabled without one', async () => {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/schedule/slots/slot-1') {
        return jsonResponse({ success: true, slot: { id: 'slot-1' }, schedule: { id: 's1' }, persona: null });
      }
      if (url === '/api/persona/video-generations/gen-3') {
        return jsonResponse({ success: true, generation: { id: 'row-1', generationId: 'gen-3' } });
      }
      return jsonResponse({});
    });
    const { useSlotDetailQuery, useGenerationDetailQuery } = await import('@/lib/api');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }): ReactNode => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );

    const { result: slotResult } = renderHook(() => useSlotDetailQuery('slot-1'), { wrapper });
    await waitFor(() => expect(slotResult.current.isSuccess).toBe(true));
    expect(fetch).toHaveBeenCalledWith('/api/schedule/slots/slot-1', expect.anything());

    const { result: genResult } = renderHook(() => useGenerationDetailQuery('gen-3'), { wrapper });
    await waitFor(() => expect(genResult.current.isSuccess).toBe(true));
    expect(fetch).toHaveBeenCalledWith('/api/persona/video-generations/gen-3', expect.anything());

    // No id → the query stays idle (the route param can be missing while
    // the page mounts).
    const { result: idleResult } = renderHook(() => useSlotDetailQuery(''), { wrapper });
    expect(idleResult.current.fetchStatus).toBe('idle');
  });
});
