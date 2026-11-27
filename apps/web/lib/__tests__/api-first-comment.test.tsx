import { afterEach, describe, expect, it, vi } from 'vitest';

import { updateSlotFirstComment } from '@/lib/api-first-comment';

const fetchMock = vi.fn();

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('updateSlotFirstComment', () => {
  it('PATCHes the slot with the first comment and returns the stored value', async () => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValue(json(200, { success: true, firstComment: 'Link in bio' }));
    expect(await updateSlotFirstComment('slot 1', 'Link in bio')).toBe('Link in bio');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/schedule/slots/slot%201');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(String(init.body))).toEqual({ firstComment: 'Link in bio' });
  });

  it('sends null to clear it', async () => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValue(json(200, { success: true, firstComment: null }));
    expect(await updateSlotFirstComment('s', null)).toBeNull();
    expect(JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body))).toEqual({ firstComment: null });
  });

  it('throws the API message on a rejected update', async () => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValue(json(400, { success: false, error: 'firstComment must be at most 1000 characters.' }));
    await expect(updateSlotFirstComment('s', 'x')).rejects.toThrow('1000 characters');
  });

  it('throws a clean error on a non-JSON error body', async () => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValue(new Response('<html>bad gateway</html>', { status: 502 }));
    await expect(updateSlotFirstComment('s', 'x')).rejects.toThrow('Failed to update the first comment');
  });

  it('throws when a 200 answer reports success false', async () => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValue(json(200, { success: false }));
    await expect(updateSlotFirstComment('s', 'x')).rejects.toThrow('Failed to update the first comment');
  });
});
