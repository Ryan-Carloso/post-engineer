import { beforeEach, describe, expect, it, vi } from 'vitest';

const getSession = vi.fn();
const maybeSingle = vi.fn();
const eq = vi.fn(() => ({ maybeSingle }));
const select = vi.fn(() => ({ eq }));
const from = vi.fn(() => ({ select }));

vi.mock('@/lib/supabase/client', () => ({
  createSupabaseClient: () => ({ auth: { getSession }, from }),
}));

import { fetchTrialStatus } from '../trial-query';

const NOW = new Date('2026-11-20T12:00:00.000Z');

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue({ data: { session: { user: { id: 'user-1' } } }, error: null });
});

describe('fetchTrialStatus', () => {
  it('reads the trial end of the signed-in user', async () => {
    maybeSingle.mockResolvedValue({ data: { trial_ends_at: '2026-11-22T12:00:00.000Z' }, error: null });
    await expect(fetchTrialStatus(() => NOW)).resolves.toEqual({
      endsAt: '2026-11-22T12:00:00.000Z',
      active: true,
      daysLeft: 2,
    });
    expect(from).toHaveBeenCalledWith('user_profiles');
    expect(select).toHaveBeenCalledWith('trial_ends_at');
    expect(eq).toHaveBeenCalledWith('id', 'user-1');
  });

  it('returns null without a session', async () => {
    getSession.mockResolvedValue({ data: { session: null }, error: null });
    await expect(fetchTrialStatus(() => NOW)).resolves.toBeNull();
    expect(from).not.toHaveBeenCalled();
  });

  it('shows a full trial when the profile row does not exist yet', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    await expect(fetchTrialStatus(() => NOW)).resolves.toEqual({
      endsAt: '2026-11-27T12:00:00.000Z',
      active: true,
      daysLeft: 7,
    });
  });

  it('throws when the session lookup fails', async () => {
    getSession.mockResolvedValue({ data: { session: null }, error: { message: 'no auth' } });
    await expect(fetchTrialStatus(() => NOW)).rejects.toThrow('trial session lookup failed: no auth');
  });

  it('throws when the profile lookup fails', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: { message: 'down' } });
    await expect(fetchTrialStatus(() => NOW)).rejects.toThrow('trial lookup failed: down');
  });
});
