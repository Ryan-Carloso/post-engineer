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
              { provider: 'bluesky', recordId: 'r-bsky', did: 'did:plc:1', handle: 'user.bsky.social', connectedAt: 5, lastUsed: 6 },
              { provider: 'linkedin', recordId: 'r-li', providerAccountId: 'urn:li:person:1', accountName: 'Person One', connectedAt: 5, lastUsed: 6 },
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

  it('mounting all four provider hooks fetches /api/account exactly once', async () => {
    const {
      useYouTubeAccountsQuery,
      useInstagramAccountsQuery,
      useBlueskyAccountsQuery,
      useLinkedinAccountsQuery,
      useSocialAccountsQuery,
    } = await import('@/lib/api');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }): ReactNode => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const useAllAccountHooks = () => ({
      social: useSocialAccountsQuery(),
      youtube: useYouTubeAccountsQuery(),
      instagram: useInstagramAccountsQuery(),
      bluesky: useBlueskyAccountsQuery(),
      linkedin: useLinkedinAccountsQuery(),
    });
    const first = renderHook(useAllAccountHooks, { wrapper });
    const second = renderHook(useAllAccountHooks, { wrapper });

    await waitFor(() => {
      expect(first.result.current.youtube.isSuccess).toBe(true);
      expect(second.result.current.linkedin.isSuccess).toBe(true);
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith('/api/account');
    expect(first.result.current.social.data?.accounts).toHaveLength(5);
    expect(first.result.current.youtube.data?.accounts).toHaveLength(1);
    expect(first.result.current.youtube.data?.accounts[0]?.channelId).toBe('ch-1');
    expect(first.result.current.instagram.data?.accounts).toHaveLength(1);
    expect(first.result.current.instagram.data?.accounts[0]?.igUserId).toBe('ig-1');
    expect(first.result.current.bluesky.data?.accounts).toHaveLength(1);
    expect(first.result.current.bluesky.data?.accounts[0]?.handle).toBe('user.bsky.social');
    expect(first.result.current.linkedin.data?.accounts).toHaveLength(1);
    expect(first.result.current.linkedin.data?.accounts[0]?.providerAccountId).toBe('urn:li:person:1');
    expect(first.result.current.youtube.data).toEqual(second.result.current.youtube.data);

    first.unmount();
    second.unmount();
    const remounted = renderHook(useAllAccountHooks, { wrapper });
    expect(remounted.result.current.youtube.isSuccess).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);

    await act(async () => {
      await client.invalidateQueries({ queryKey: ['social-accounts'] });
    });
    expect(fetch).toHaveBeenCalledTimes(2);
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

  it('useDisconnectAccountMutation invalidates the shared social accounts query', async () => {
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
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['social-accounts'] });
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

  it('updateSlotTitle PATCHes /api/schedule/slots/:id with the title', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ success: true, title: 'Novo tema' }));
    const { updateSlotTitle } = await import('@/lib/api');
    const title = await updateSlotTitle('slot-1', 'Novo tema');
    expect(title).toBe('Novo tema');
    expect(fetch).toHaveBeenCalledWith(
      '/api/schedule/slots/slot-1',
      expect.objectContaining({ method: 'PATCH' }),
    );
  });

  it('updateSlotTitle throws on failure', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ success: false, error: 'Only a pending or ready slot can be edited.' }, false, 409),
    );
    const { updateSlotTitle } = await import('@/lib/api');
    await expect(updateSlotTitle('slot-1', 'x')).rejects.toThrow('Only a pending or ready slot can be edited.');
  });

  it('updateSlotTitle throws a clean error (not parse noise) on a non-JSON error body', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response('<html><body>Bad Gateway</body></html>', {
        status: 502,
        headers: { 'content-type': 'text/html' },
      }),
    );
    const { updateSlotTitle } = await import('@/lib/api');
    await expect(updateSlotTitle('slot-1', 'x')).rejects.toThrow('Failed to update slot');
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
      await updateResult.current.mutateAsync({ slotId: 'slot-1', title: 'Novo tema' });
    });
    const { result: deleteResult } = renderHook(() => useDeleteSlotMutation(), { wrapper });
    await act(async () => {
      await deleteResult.current.mutateAsync('slot-1');
    });

    const invalidatedKeys = invalidateSpy.mock.calls.map((c) => (c[0] as { queryKey: unknown[] })?.queryKey);
    expect(invalidatedKeys).toContainEqual(['fill-schedule-status']);
    expect(invalidatedKeys).toContainEqual(['post-detail', 'slot-1']);
    invalidateSpy.mockRestore();
  });

  it('fetchPostDetail GETs /api/posts/:id and maps a slot payload', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({
      success: true,
      slot: { id: 'slot-1', scheduleId: 's1', slotAt: '2030-06-01T10:00:00.000Z', status: 'ready', title: 'T', error: null, publishedAt: null },
      schedule: { id: 's1', personaId: 'p1', providers: ['youtube'], youtubeAccountIds: ['ch1'], instagramAccountIds: [], linkedinAccountIds: [] },
      persona: { id: 'p1', name: 'Viva Leve' },
    }));
    const { fetchPostDetail } = await import('@/lib/api');
    const detail = await fetchPostDetail('slot-1');
    if (detail === null) throw new Error('expected slot');
    expect(detail.slot.id).toBe('slot-1');
    expect(detail.persona?.name).toBe('Viva Leve');
    expect(fetch).toHaveBeenCalledWith('/api/posts/slot-1', expect.objectContaining({ method: 'GET' }));
  });

  it('fetchPostDetail resolves null on 404 and throws on other failures', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ success: false, error: 'Post not found.' }, false, 404),
    );
    const { fetchPostDetail } = await import('@/lib/api');
    await expect(fetchPostDetail('missing')).resolves.toBeNull();

    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ success: false, error: 'boom' }, false, 500),
    );
    await expect(fetchPostDetail('slot-1')).rejects.toThrow('boom');
  });

  it('fetchPostDetail carries the published links through', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({
      success: true,
      slot: {
        id: 'slot-1',
        status: 'published',
        publishLinks: [{ provider: 'youtube', url: 'https://www.youtube.com/watch?v=abc' }],
      },
      schedule: { id: 's1' },
      persona: null,
    }));
    const { fetchPostDetail } = await import('@/lib/api');
    const detail = await fetchPostDetail('slot-1');
    if (detail === null) throw new Error('expected slot');
    expect(detail.slot.publishLinks).toEqual([
      { provider: 'youtube', url: 'https://www.youtube.com/watch?v=abc' },
    ]);
  });

  it('fetchPostDetail drops publish links with an unknown provider', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({
      success: true,
      slot: {
        id: 'slot-1',
        status: 'published',
        publishLinks: [
          { provider: 'youtube', url: 'https://www.youtube.com/watch?v=abc' },
          { provider: 'tiktok', url: 'https://www.tiktok.com/@x/video/123' },
        ],
      },
      schedule: { id: 's1' },
      persona: null,
    }));
    const { fetchPostDetail } = await import('@/lib/api');
    const detail = await fetchPostDetail('slot-1');
    if (detail === null) throw new Error('expected slot');
    expect(detail.slot.publishLinks).toEqual([
      { provider: 'youtube', url: 'https://www.youtube.com/watch?v=abc' },
    ]);
  });

  it('fetchPostDetail defaults missing or malformed publishLinks to an empty list', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({
      success: true,
      slot: { id: 'slot-1', status: 'published' },
      schedule: { id: 's1' },
      persona: null,
    }));
    const { fetchPostDetail } = await import('@/lib/api');
    const detail = await fetchPostDetail('slot-1');
    if (detail === null) throw new Error('expected slot');
    expect(detail.slot.publishLinks).toEqual([]);

    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({
      success: true,
      slot: { id: 'slot-1', publishLinks: 'not-an-array' },
      schedule: { id: 's1' },
      persona: null,
    }));
    const second = await fetchPostDetail('slot-1');
    if (second === null) throw new Error('expected slot');
    expect(second.slot.publishLinks).toEqual([]);
  });

  it('detail queries are keyed by id and disabled without one', async () => {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/posts/slot-1') {
        return jsonResponse({ success: true, slot: { id: 'slot-1' }, schedule: { id: 's1' }, persona: null });
      }
      return jsonResponse({});
    });
    const { usePostDetailQuery } = await import('@/lib/api');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }): ReactNode => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => usePostDetailQuery('slot-1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetch).toHaveBeenCalledWith('/api/posts/slot-1', expect.anything());

    const { result: idleResult } = renderHook(() => usePostDetailQuery(''), { wrapper });
    expect(idleResult.current.fetchStatus).toBe('idle');
  });

  it('usePostDetailQuery refetches the post every 60s', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
        if (String(input) === '/api/posts/slot-1') {
          return jsonResponse({ success: true, slot: { id: 'slot-1' }, schedule: { id: 's1' }, persona: null });
        }
        return jsonResponse({});
      });
      const { usePostDetailQuery } = await import('@/lib/api');
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const wrapper = ({ children }: { children: ReactNode }): ReactNode => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      );

      const { result } = renderHook(() => usePostDetailQuery('slot-1'), { wrapper });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(result.current.isSuccess).toBe(true);
      expect(fetch).toHaveBeenCalledTimes(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(59_999);
      });
      expect(fetch).toHaveBeenCalledTimes(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(fetch).toHaveBeenLastCalledWith('/api/posts/slot-1', expect.anything());
    } finally {
      vi.useRealTimers();
    }
  });

  describe('fetchScheduleStatus', () => {
    it('trusts the route hasAnyPost field when both lists are empty (stale slots)', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        jsonResponse({ success: true, upcoming: [], recent: [], hasAnyPost: true }),
      );
      const { fetchScheduleStatus } = await import('@/lib/api');
      const result = await fetchScheduleStatus(1);

      expect(fetch).toHaveBeenCalledWith('/api/schedule/status?limit=1');
      expect(result.hasAnyPost).toBe(true);
    });

    it('falls back to the lists when the field is absent', async () => {
      const { fetchScheduleStatus } = await import('@/lib/api');
      const slot = { id: 'u1', schedule_id: 's1', slot_at: '2030-06-01T10:00:00.000Z', status: 'awaiting', title: 'T' };

      vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ success: true, upcoming: [slot], recent: [] }));
      expect((await fetchScheduleStatus(1)).hasAnyPost).toBe(true);

      vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ success: true, upcoming: [], recent: [] }));
      expect((await fetchScheduleStatus(1)).hasAnyPost).toBe(false);
    });

    it('treats missing lists as empty instead of crashing', async () => {
      const { fetchScheduleStatus } = await import('@/lib/api');
      vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ success: true }));
      const result = await fetchScheduleStatus(1);
      expect(result.upcoming).toEqual([]);
      expect(result.recent).toEqual([]);
      expect(result.hasAnyPost).toBe(false);
    });
  });
});
