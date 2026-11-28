import { beforeEach, describe, expect, it, vi } from 'vitest';

const getSession = vi.fn();
const maybeSingle = vi.fn();
const eq = vi.fn(() => ({ maybeSingle }));
const select = vi.fn(() => ({ eq }));
const from = vi.fn(() => ({ select }));

vi.mock('@/lib/supabase/client', () => ({
  createSupabaseClient: () => ({ auth: { getSession }, from }),
}));

import { fetchAccessStatus } from '../access-query';

const NOW = new Date('2026-11-20T12:00:00.000Z');

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue({ data: { session: { user: { id: 'user-1' } } }, error: null });
});

describe('fetchAccessStatus', () => {
  it('reads the access window of the signed-in user', async () => {
    maybeSingle.mockResolvedValue({
      data: { access_until: '2026-11-22T12:00:00.000Z', subscription_status: null },
      error: null,
    });
    await expect(fetchAccessStatus(() => NOW)).resolves.toEqual({
      endsAt: '2026-11-22T12:00:00.000Z',
      active: true,
      reason: 'beta',
    });
    expect(from).toHaveBeenCalledWith('user_profiles');
    expect(select).toHaveBeenCalledWith('access_until,subscription_status');
    expect(eq).toHaveBeenCalledWith('id', 'user-1');
  });

  it('names a cancelled subscription as the reason', async () => {
    maybeSingle.mockResolvedValue({
      data: { access_until: '2026-11-20T11:00:00.000Z', subscription_status: 'canceled' },
      error: null,
    });
    await expect(fetchAccessStatus(() => NOW)).resolves.toEqual({
      endsAt: '2026-11-20T11:00:00.000Z',
      active: false,
      reason: 'none',
    });
  });

  it('returns null without a session', async () => {
    getSession.mockResolvedValue({ data: { session: null }, error: null });
    await expect(fetchAccessStatus(() => NOW)).resolves.toBeNull();
    expect(from).not.toHaveBeenCalled();
  });

  it('shows an account awaiting the beta when the profile row does not exist yet', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    await expect(fetchAccessStatus(() => NOW)).resolves.toEqual({
      endsAt: '2026-11-20T12:00:00.000Z',
      active: false,
      reason: 'beta',
    });
  });

  it('throws when the session lookup fails', async () => {
    getSession.mockResolvedValue({ data: { session: null }, error: { message: 'no auth' } });
    await expect(fetchAccessStatus(() => NOW)).rejects.toThrow('access session lookup failed: no auth');
  });

  it('throws when the profile lookup fails', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: { message: 'down' } });
    await expect(fetchAccessStatus(() => NOW)).rejects.toThrow('access lookup failed: down');
  });
});
