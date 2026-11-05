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
  deletePersonaImage,
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
import * as sessionExpiry from '../session-expiry';

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

  // A 200 whose body says success:false is a failed read, not data: it
  // throws with the 2xx status, which the policy treats as transient.
  it.each<[string, () => UseQueryResult<unknown, Error>]>([
    ['useSchedulesQuery', () => useSchedulesQuery()],
    ['useScheduleStatusQuery', () => useScheduleStatusQuery()],
    ['useVideoGenerationsQuery', () => useVideoGenerationsQuery()],
  ])('%s fails on a 200 with success:false and retries it once', async (_name, useHook) => {
    vi.stubGlobal('fetch', vi.fn(async () => response(200, { success: false })));
    const { result } = renderHook(useHook, { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(HttpStatusError);
    expect((result.current.error as HttpStatusError).status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(2);
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

//---------------
// Branches next to the status plumbing: fallback messages, the 2xx paths,
// and a failed-but-OK mutation that must not trip the session redirect.
//---------------
describe('fetcher branches around the HTTP status', () => {
  function wrapper(): (props: { children: ReactNode }) => ReactNode {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return ({ children }) => QueryClientProvider({ client, children }) as ReactNode;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('persona images: a non-OK answer without an error body falls back to the status message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 503, json: async () => { throw new SyntaxError('html'); } })),
    );
    const { result } = renderHook(() => usePersonaImagesQuery('p-1'), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('Persona images request failed with status 503');
    expect((result.current.error as HttpStatusError).status).toBe(503);
  });

  it('image mutation: a 200 with success:false fails without the session-expiry notify', async () => {
    const notify = vi.spyOn(sessionExpiry, 'notifyIfSessionExpired');
    vi.stubGlobal('fetch', vi.fn(async () => response(200, { success: false, error: 'Image not found.' })));
    await expect(deletePersonaImage('img-1')).resolves.toEqual({ success: false, error: 'Image not found.' });
    expect(notify).not.toHaveBeenCalled();
  });

  it('video generations: a successful read returns the generations', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(200, { success: true, generations: [{ id: 'g-1' }] })));
    const { result } = renderHook(() => useVideoGenerationsQuery(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([{ id: 'g-1' }]);
  });
});
