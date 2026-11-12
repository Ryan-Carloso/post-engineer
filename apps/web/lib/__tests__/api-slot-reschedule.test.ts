import { describe, it, expect, vi, beforeEach } from 'vitest';

function jsonResponse(data: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => data,
  } as unknown as Response;
}

//---------------
// api-slot-reschedule — the reschedule client fn (issue #555).
//---------------
describe('rescheduleSlot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });

  it('PATCHes /api/schedule/slots/:id with the new slotAt', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ success: true, slotAt: '2026-11-13T10:00:00.000Z' }),
    );
    const { rescheduleSlot } = await import('@/lib/api-slot-reschedule');
    const slotAt = await rescheduleSlot('slot-1', '2026-11-13T10:00:00.000Z');
    expect(slotAt).toBe('2026-11-13T10:00:00.000Z');
    expect(fetch).toHaveBeenCalledWith(
      '/api/schedule/slots/slot-1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ slotAt: '2026-11-13T10:00:00.000Z' }),
      }),
    );
  });

  it('throws on failure', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse({ success: false, error: 'An ASAP post has no scheduled time to move.' }, false, 409),
    );
    const { rescheduleSlot } = await import('@/lib/api-slot-reschedule');
    await expect(rescheduleSlot('slot-1', '2026-11-13T10:00:00.000Z')).rejects.toThrow(
      'An ASAP post has no scheduled time to move.',
    );
  });

  it('throws a clean error (not parse noise) on a non-JSON error body', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response('<html><body>Bad Gateway</body></html>', {
        status: 502,
        headers: { 'content-type': 'text/html' },
      }),
    );
    const { rescheduleSlot } = await import('@/lib/api-slot-reschedule');
    await expect(rescheduleSlot('slot-1', '2026-11-13T10:00:00.000Z')).rejects.toThrow(
      'Failed to reschedule slot',
    );
  });
});
