import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

function jsonResponse(data: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => data,
  } as unknown as Response;
}

describe('approveSlot / rejectSlot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });

  it('POSTs to the approve route and returns the new status', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ success: true, status: 'ready' }));
    const { approveSlot } = await import('@/lib/api-approval');

    const status = await approveSlot('slot-1');

    expect(status).toBe('ready');
    expect(fetch).toHaveBeenCalledWith(
      '/api/schedule/slots/slot-1/approve',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('POSTs to the reject route and returns cancelled', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ success: true, status: 'cancelled' }));
    const { rejectSlot } = await import('@/lib/api-approval');

    const status = await rejectSlot('slot-1');

    expect(status).toBe('cancelled');
    expect(fetch).toHaveBeenCalledWith(
      '/api/schedule/slots/slot-1/reject',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('throws the server message on a 409 double-approve', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ success: false, error: 'Only an awaiting-approval slot can be approved.' }, false, 409),
    );
    const { approveSlot } = await import('@/lib/api-approval');

    await expect(approveSlot('slot-1')).rejects.toThrow('Only an awaiting-approval slot can be approved.');
  });

  it('throws a clean error (not parse noise) on a non-JSON error body', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response('<html><body>Bad Gateway</body></html>', {
        status: 502,
        headers: { 'content-type': 'text/html' },
      }),
    );
    const { rejectSlot } = await import('@/lib/api-approval');

    await expect(rejectSlot('slot-1')).rejects.toThrow('Failed to reject slot');
  });
});

describe('useApproveSlotMutation / useRejectSlotMutation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });

  function wrapper(client: QueryClient): (props: { children: ReactNode }) => ReactNode {
    function HookProviders({ children }: { children: ReactNode }): ReactNode {
      return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    }
    return HookProviders;
  }

  it('invalidates the status, range and post-detail queries after an approve', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ success: true, status: 'ready' }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { useApproveSlotMutation } = await import('@/lib/api-approval');
    const { result } = renderHook(() => useApproveSlotMutation(), { wrapper: wrapper(client) });

    result.current.mutate('slot-1');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['schedule-status'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['schedule-range'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['post-detail', 'slot-1'] });
  });

  it('invalidates the status, range and post-detail queries after a reject', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ success: true, status: 'cancelled' }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { useRejectSlotMutation } = await import('@/lib/api-approval');
    const { result } = renderHook(() => useRejectSlotMutation(), { wrapper: wrapper(client) });

    result.current.mutate('slot-1');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['schedule-status'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['schedule-range'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['post-detail', 'slot-1'] });
  });
});
