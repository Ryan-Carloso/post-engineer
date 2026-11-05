import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider, type UseQueryResult } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

vi.mock('@/lib/supabase/client', () => ({
  createSupabaseClient: () => ({ auth: { getSession: vi.fn() } }),
}));

import { MAX_QUERY_RETRIES, shouldRetryQuery } from '../query-retry';
import { HttpStatusError } from '../errors';
import {
  fetchApiKeys,
  fetchPostDetail,
  usePersonaImagesQuery,
  usePersonaListQuery,
  usePostDetailQuery,
  useApiKeysQuery,
  useScheduleStatusQuery,
  useSchedulesQuery,
  useSocialAccountsQuery,
  useVideoGenerationsQuery,
  useVoicesQuery,
} from '../api';
import { fetchClonedVoice, fetchClonedVoices } from '../cloned-voices-client';

function response(status: number, body: unknown = { success: false, error: 'nope' }): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

describe('shouldRetryQuery', () => {
  it.each([400, 401, 403, 404, 409, 429])('never retries an HTTP %i', (status) => {
    expect(shouldRetryQuery(0, new HttpStatusError('x', status))).toBe(false);
  });

  it.each([500, 502, 503])('retries an HTTP %i once', (status) => {
    expect(shouldRetryQuery(0, new HttpStatusError('x', status))).toBe(true);
    expect(shouldRetryQuery(MAX_QUERY_RETRIES, new HttpStatusError('x', status))).toBe(false);
  });

  it('retries a network error (no status) once', () => {
    expect(shouldRetryQuery(0, new TypeError('Failed to fetch'))).toBe(true);
    expect(shouldRetryQuery(1, new TypeError('Failed to fetch'))).toBe(false);
  });

  it('retries a 2xx answer with an unsuccessful body once', () => {
    expect(shouldRetryQuery(0, new HttpStatusError('x', 200))).toBe(true);
  });
});

describe('fetchers carry the HTTP status', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each<[string, () => Promise<unknown>]>([
    ['fetchApiKeys', () => fetchApiKeys()],
    ['fetchPostDetail', () => fetchPostDetail('slot-1')],
    ['fetchClonedVoices', () => fetchClonedVoices()],
    ['fetchClonedVoice', () => fetchClonedVoice('clone-1')],
  ])('%s throws an HttpStatusError with the response status', async (_name, run) => {
    vi.stubGlobal('fetch', vi.fn(async () => response(401)));
    const error = await run().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(HttpStatusError);
    expect((error as HttpStatusError).status).toBe(401);
  });
});

//---------------
// The real default policy on a real QueryClient: count fetch attempts.
//---------------
describe('dashboard queries with the default retry policy', () => {
  function wrapper(): (props: { children: ReactNode }) => ReactNode {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: shouldRetryQuery, retryDelay: 0 } },
    });
    return ({ children }) => QueryClientProvider({ client, children }) as ReactNode;
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const hooks: Array<[string, () => UseQueryResult<unknown, Error>]> = [
    ['useSocialAccountsQuery', () => useSocialAccountsQuery()],
    ['usePersonaListQuery', () => usePersonaListQuery()],
    ['usePersonaImagesQuery', () => usePersonaImagesQuery('p-1')],
    ['useSchedulesQuery', () => useSchedulesQuery()],
    ['useScheduleStatusQuery', () => useScheduleStatusQuery()],
    ['useApiKeysQuery', () => useApiKeysQuery()],
    ['useVideoGenerationsQuery', () => useVideoGenerationsQuery()],
    ['usePostDetailQuery', () => usePostDetailQuery('slot-1')],
  ];

  it.each(hooks)('%s fires once on an expired session (401)', async (_name, useHook) => {
    vi.stubGlobal('fetch', vi.fn(async () => response(401)));
    const { result } = renderHook(useHook, { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each(hooks)('%s still retries a 500 once', async (_name, useHook) => {
    vi.stubGlobal('fetch', vi.fn(async () => response(500)));
    const { result } = renderHook(useHook, { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('retries a network error once', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const { result } = renderHook(() => useScheduleStatusQuery(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('keeps a per-query override: the voices query never retries, even on a 500', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(500)));
    const { result } = renderHook(() => useVoicesQuery(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
