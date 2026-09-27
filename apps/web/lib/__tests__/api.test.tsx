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
});
