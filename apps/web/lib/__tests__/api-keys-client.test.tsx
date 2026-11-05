import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import {
  createApiKey,
  fetchApiKeys,
  revokeApiKey,
  useApiKeysQuery,
  useCreateApiKeyMutation,
  useRevokeApiKeyMutation,
  type ApiKeyItem,
} from '../api-keys-client';
import { HttpStatusError } from '../errors';
import { handleSessionExpiredError } from '../session-expiry';

// Only the redirect handler is doubled (same pattern as app/providers tests):
// the real window-level redirect behavior is pinned in
// lib/__tests__/session-expiry.test.tsx; here we prove the shared QueryCache
// wiring routes the billing fetchers' 401 through the handler.
vi.mock('../session-expiry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../session-expiry')>();
  return {
    ...actual,
    handleSessionExpiredError: vi.fn(),
  };
});

function response(status: number, body: unknown = { success: false, error: 'nope' }): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

function wrapper(): (props: { children: ReactNode }) => ReactNode {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 60_000 } } });
  function HookProviders({ children }: { children: ReactNode }): ReactNode {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return HookProviders;
}

const apiKeyItem: ApiKeyItem = {
  id: 'k-1',
  name: 'CI key',
  keyPrefix: 'pe_live_abc...',
  personaIds: null,
  createdAt: '2026-11-05T00:00:00.000Z',
  lastUsedAt: null,
  revokedAt: null,
};

const createdKey = {
  id: 'k-1',
  name: 'CI key',
  key: 'pe_live_raw',
  keyPrefix: 'pe_live_abc...',
  personaIds: null,
  createdAt: '2026-11-05T00:00:00.000Z',
};

describe('api-keys-client — fetchers', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetchApiKeys returns keys on success', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(200, { keys: [apiKeyItem] })));
    await expect(fetchApiKeys()).resolves.toEqual([apiKeyItem]);
    expect(fetch).toHaveBeenCalledWith('/api/api-keys');
  });

  it('fetchApiKeys returns an empty list when the body has no keys', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(200, {})));
    await expect(fetchApiKeys()).resolves.toEqual([]);
  });

  it('fetchApiKeys throws an HttpStatusError carrying the status on failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(403)));
    const error = await fetchApiKeys().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(HttpStatusError);
    expect((error as HttpStatusError).status).toBe(403);
  });

  it('createApiKey posts the JSON payload and returns the created key', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(200, createdKey)));
    const created = await createApiKey({ name: 'CI key', personaIds: null });
    expect(created.id).toBe('k-1');
    expect(fetch).toHaveBeenCalledWith('/api/api-keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'CI key', personaIds: null }),
    });
  });

  it.each([401, 500])('createApiKey throws an HttpStatusError carrying the status on HTTP %i', async (status) => {
    vi.stubGlobal('fetch', vi.fn(async () => response(status)));
    const error = await createApiKey({ name: 'CI key' }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(HttpStatusError);
    expect((error as HttpStatusError).status).toBe(status);
  });

  it('revokeApiKey succeeds silently on 200 and throws an HttpStatusError on failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(200, {})));
    await expect(revokeApiKey('k-1')).resolves.toBeUndefined();

    vi.stubGlobal('fetch', vi.fn(async () => response(401)));
    const error = await revokeApiKey('k-1').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(HttpStatusError);
    expect((error as HttpStatusError).status).toBe(401);
  });
});

//---------------
// Dead-session reaction: the shared QueryCache wiring routes the billing
// fetchers' 401 through handleSessionExpiredError, exactly like Providers.
//---------------
describe('api-keys-client — session-expiry wiring', () => {

  it('a 401 on useApiKeysQuery calls the handler with an HttpStatusError(401)', async () => {
    const handler = vi.mocked(handleSessionExpiredError);
    handler.mockClear();
    vi.stubGlobal('fetch', vi.fn(async () => response(401)));

    const client = new QueryClient({
      queryCache: new QueryCache({ onError: handleSessionExpiredError }),
      defaultOptions: { queries: { retry: false } },
    });
    const { result } = renderHook(() => useApiKeysQuery(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    const error = handler.mock.calls[0]?.[0];
    expect(error).toBeInstanceOf(HttpStatusError);
    expect((error as HttpStatusError).status).toBe(401);
  });
});

describe('api-keys-client — React Query hooks', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('useApiKeysQuery loads the keys', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(200, { keys: [apiKeyItem] })));
    const { result } = renderHook(() => useApiKeysQuery(), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.data).toEqual([apiKeyItem]));
    expect(result.current.isError).toBe(false);
  });

  it('useCreateApiKeyMutation creates and surfaces the created key', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(200, createdKey)));
    const { result } = renderHook(() => useCreateApiKeyMutation(), { wrapper: wrapper() });

    result.current.mutate({ name: 'CI key' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.id).toBe('k-1');
  });

  it('useRevokeApiKeyMutation resolves on success and errors on 401', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(200, {})));
    const first = renderHook(() => useRevokeApiKeyMutation(), { wrapper: wrapper() });
    first.result.current.mutate('k-1');
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));

    vi.stubGlobal('fetch', vi.fn(async () => response(401)));
    const second = renderHook(() => useRevokeApiKeyMutation(), { wrapper: wrapper() });
    second.result.current.mutate('k-2');
    await waitFor(() => expect(second.result.current.isError).toBe(true));
    expect(second.result.current.error).toBeInstanceOf(HttpStatusError);
  });
});
