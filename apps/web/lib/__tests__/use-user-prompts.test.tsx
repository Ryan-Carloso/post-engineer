import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { z } from 'zod';

import type { GetPromptVersionResponseSchema } from '@/lib/contracts/prompts';

vi.mock('@/lib/session-expiry', () => ({ notifyIfSessionExpired: vi.fn() }));

import {
  PromptVersionReadError,
  USER_PROMPTS_KEY,
  promptVersionQueryOptions,
  userPromptDetailKey,
  userPromptVersionKey,
  userPromptVersionsKey,
  useRestorePromptVersionMutation,
} from '@/lib/use-user-prompts';

const PROMPT = {
  slug: 'my-prompt',
  title: 'T',
  description: '',
  source: 'own',
  visibility: 'private',
  verified: false,
  prompt: 'P',
  body: 'P',
  versionId: '44444444-4444-4444-8444-444444444444',
  version: 3,
};

function setup(): { client: QueryClient; invalidate: ReturnType<typeof vi.spyOn>; wrapper: (props: { children: ReactNode }) => ReactNode } {
  const client = new QueryClient();
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  return {
    client,
    invalidate,
    wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('user prompt query keys', () => {
  it('keeps every key under the user-prompts root so one invalidation refreshes them all', () => {
    expect(userPromptDetailKey('a')).toEqual([...USER_PROMPTS_KEY, 'detail', 'a']);
    expect(userPromptVersionsKey('a')).toEqual([...USER_PROMPTS_KEY, 'versions', 'a']);
    expect(userPromptVersionKey('a', 2)).toEqual([...USER_PROMPTS_KEY, 'versions', 'a', 2]);
  });
});

describe('useRestorePromptVersionMutation', () => {
  it('invalidates every user prompt query after a restore that succeeded', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ success: true, restored: true, prompt: { ...PROMPT, version: 4 } })));
    const { invalidate, wrapper } = setup();
    const { result } = renderHook(() => useRestorePromptVersionMutation(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ slug: 'my-prompt', version: 1, expectedCurrentVersion: 3 });
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: USER_PROMPTS_KEY });
  });

  it('invalidates nothing when the restore failed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ success: false, code: 'PROMPT_VERSION_CONFLICT' }, { status: 409 })));
    const { invalidate, wrapper } = setup();
    const { result } = renderHook(() => useRestorePromptVersionMutation(), { wrapper });
    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.mutateAsync({ slug: 'my-prompt', version: 1, expectedCurrentVersion: 3 });
    });
    expect(outcome).toEqual({ success: false, status: 409, code: 'PROMPT_VERSION_CONFLICT' });
    expect(invalidate).not.toHaveBeenCalled();
  });
});

describe('promptVersionQueryOptions', () => {
  const VERSION_BODY = {
    success: true,
    version: {
      versionId: '55555555-5555-4555-8555-555555555555',
      version: 2,
      title: 'T',
      createdAt: '2026-01-01T00:00:00.000Z',
      body: 'older text',
      current: false,
    },
  };

  it('keys the query by slug and version with no retry and a 60s stale time', () => {
    const options = promptVersionQueryOptions('my-prompt', 2);
    expect(options.queryKey).toEqual(userPromptVersionKey('my-prompt', 2));
    expect(options.retry).toBe(false);
    expect(options.staleTime).toBe(60_000);
  });

  it('types the cached data of its key as the version response body', () => {
    const options = promptVersionQueryOptions('my-prompt', 2);
    const cached = new QueryClient().getQueryData(options.queryKey);
    expectTypeOf(cached).toEqualTypeOf<z.output<typeof GetPromptVersionResponseSchema> | undefined>();
  });

  it('resolves the response body on a successful read', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => Response.json(VERSION_BODY));
    vi.stubGlobal('fetch', fetchMock);
    const body = await new QueryClient().fetchQuery(promptVersionQueryOptions('my-prompt', 2));
    expect(body.version.body).toBe('older text');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('/api/prompts/my-prompt/versions/2');
  });

  it('throws a PromptVersionReadError carrying the failure when the read fails', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({ success: false, code: 'PROMPT_VERSION_NOT_FOUND' }, { status: 404 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const error: unknown = await new QueryClient()
      .fetchQuery(promptVersionQueryOptions('my-prompt', 2))
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PromptVersionReadError);
    expect(error instanceof PromptVersionReadError && error.failure.status).toBe(404);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('/api/prompts/my-prompt/versions/2');
  });
});
