import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';

vi.mock('@/lib/session-expiry', () => ({ notifyIfSessionExpired: vi.fn() }));

import {
  USER_PROMPTS_KEY,
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
