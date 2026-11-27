import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { usePinterestBoardsQuery } from '../boards';

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  Wrapper.displayName = 'BoardsWrapper';
  return Wrapper;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('usePinterestBoardsQuery', () => {
  it('returns the boards for the selected account', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        success: true,
        boards: [
          { id: 'board-1', name: 'Summer' },
          { id: 'board-2', name: 'Recipes' },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => usePinterestBoardsQuery('acct-1'), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([
      { id: 'board-1', name: 'Summer' },
      { id: 'board-2', name: 'Recipes' },
    ]);
    expect(fetchMock).toHaveBeenCalledWith('/api/pinterest/boards?accountId=acct-1');
  });

  it('does not fetch without an account', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => usePinterestBoardsQuery(null), {
      wrapper: wrapper(),
    });
    expect(result.current.isPending).toBe(true);
    expect(result.current.data).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls back to the board id when the name is missing or blank', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          success: true,
          boards: [
            { id: 'board-1' },
            { id: 'board-2', name: '' },
            { id: 'board-3', name: 'Named' },
          ],
        }),
      ),
    );
    const { result } = renderHook(() => usePinterestBoardsQuery('acct-1'), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([
      { id: 'board-1', name: 'board-1' },
      { id: 'board-2', name: 'board-2' },
      { id: 'board-3', name: 'Named' },
    ]);
  });

  it('returns an empty list when the payload has no boards array', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ success: true, boards: 'nope' })),
    );
    const { result } = renderHook(() => usePinterestBoardsQuery('acct-1'), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
  });

  it('fails for a non-record payload', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(['board-1'])));
    const { result } = renderHook(() => usePinterestBoardsQuery('acct-1'), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toBe('pinterest boards request failed');
  });

  it('skips board entries without a string id', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          success: true,
          boards: [{ name: 'No id' }, 'plain-string', null, { id: 42, name: 'Numeric' }, { id: 'ok', name: 'Kept' }],
        }),
      ),
    );
    const { result } = renderHook(() => usePinterestBoardsQuery('acct-1'), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([{ id: 'ok', name: 'Kept' }]);
  });

  it('fails when the server answers with an error status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ success: false }, 500)));
    const { result } = renderHook(() => usePinterestBoardsQuery('acct-1'), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(Error);
    expect((result.current.error as Error).message).toBe('pinterest boards request failed');
  });

  it('fails when success is not true', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ success: false, boards: [{ id: 'b', name: 'B' }] })),
    );
    const { result } = renderHook(() => usePinterestBoardsQuery('acct-1'), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it('fails when the response body is not JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('not json', { status: 200 })),
    );
    const { result } = renderHook(() => usePinterestBoardsQuery('acct-1'), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it('encodes the account id in the request URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true, boards: [] }));
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => usePinterestBoardsQuery('acct 1&2'), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchMock).toHaveBeenCalledWith('/api/pinterest/boards?accountId=acct%201%262');
  });
});
