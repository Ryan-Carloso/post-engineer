import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { fetchTokenBalance } from '@/lib/token-balance';

describe('fetchTokenBalance', () => {
  beforeEach(() => mockFetch.mockReset());

  it('returns the server wallet balance with free breakdown', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ success: true, balance: 45, free: 0 }) });
    await expect(fetchTokenBalance()).resolves.toEqual({ balance: 45, free: 0 });
  });

  it('coerces Postgres numeric strings', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ success: true, balance: '45', free: '3' }) });
    await expect(fetchTokenBalance()).resolves.toEqual({ balance: 45, free: 3 });
  });

  it('exposes the free-token count for the badge', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ success: true, balance: 3, free: 3 }) });
    await expect(fetchTokenBalance()).resolves.toEqual({ balance: 3, free: 3 });
  });

  it('fails safe to zero on invalid or unavailable responses', async () => {
    mockFetch.mockResolvedValue({ ok: false, json: async () => ({ success: false }) });
    await expect(fetchTokenBalance()).resolves.toEqual({ balance: 0, free: 0 });
  });
});
