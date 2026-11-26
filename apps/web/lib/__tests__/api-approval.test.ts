import { describe, it, expect, vi, beforeEach } from 'vitest';

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
