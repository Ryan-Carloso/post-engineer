// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/social-accounts', () => ({
  getSocialAccountTokens: vi.fn(),
  updateSocialAccountTokens: vi.fn(),
}));
vi.mock('@/lib/fanvue', () => ({ refreshFanvueAccessToken: vi.fn() }));

import { FanvueError } from '@/lib/errors';
import { getValidFanvueAccessToken } from '@/lib/fanvue-tokens';
import { getSocialAccountTokens, updateSocialAccountTokens } from '@/lib/social-accounts';
import { refreshFanvueAccessToken } from '@/lib/fanvue';

const supabase = { __mock: 'service-client' } as never;

function storedTokens(tokens: Record<string, unknown>): void {
  vi.mocked(getSocialAccountTokens).mockResolvedValue({
    tokens: tokens as never,
    account: { id: 'acc-1' } as never,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(refreshFanvueAccessToken).mockResolvedValue({
    access_token: 'at-new',
    refresh_token: 'rt-new',
    expires_in: 3600,
    token_type: 'Bearer',
  });
});

describe('getValidFanvueAccessToken', () => {
  it('returns the stored token when it has not expired', async () => {
    storedTokens({ access_token: 'at-1', refresh_token: 'rt-1', expiry_date: Date.now() + 60_000 });
    await expect(getValidFanvueAccessToken(supabase, 'user-1', 'fan-1')).resolves.toBe('at-1');
    expect(refreshFanvueAccessToken).not.toHaveBeenCalled();
    expect(updateSocialAccountTokens).not.toHaveBeenCalled();
  });

  it('refreshes an expired token and persists the rotated pair', async () => {
    storedTokens({ access_token: 'at-old', refresh_token: 'rt-1', expiry_date: Date.now() - 1000 });
    await expect(getValidFanvueAccessToken(supabase, 'user-1', 'fan-1')).resolves.toBe('at-new');
    expect(refreshFanvueAccessToken).toHaveBeenCalledWith('rt-1');
    expect(updateSocialAccountTokens).toHaveBeenCalledWith(
      supabase,
      'user-1',
      'fanvue',
      'fan-1',
      expect.objectContaining({
        access_token: 'at-new',
        refresh_token: 'rt-new',
        token_type: 'Bearer',
      }),
    );
    const saved = vi.mocked(updateSocialAccountTokens).mock.calls[0][4];
    expect(saved.expiry_date).toBeGreaterThan(Date.now());
    expect(saved.expiry_date).toBeLessThanOrEqual(Date.now() + 3600 * 1000);
  });

  it('keeps the old refresh token when the refresh response carries none', async () => {
    storedTokens({ access_token: 'at-old', refresh_token: 'rt-1', expiry_date: Date.now() - 1000 });
    vi.mocked(refreshFanvueAccessToken).mockResolvedValue({
      access_token: 'at-new',
      refresh_token: null,
      expires_in: 3600,
      token_type: 'Bearer',
    });
    await expect(getValidFanvueAccessToken(supabase, 'user-1', 'fan-1')).resolves.toBe('at-new');
    expect(updateSocialAccountTokens).toHaveBeenCalledWith(
      supabase,
      'user-1',
      'fanvue',
      'fan-1',
      expect.objectContaining({ refresh_token: 'rt-1' }),
    );
  });

  it('throws 401 when no access token is stored', async () => {
    storedTokens({ refresh_token: 'rt-1' });
    await expect(getValidFanvueAccessToken(supabase, 'user-1', 'fan-1')).rejects.toMatchObject({
      statusCode: 401,
    });
    await expect(getValidFanvueAccessToken(supabase, 'user-1', 'fan-1')).rejects.toThrow(
      'Fanvue token not found',
    );
    expect(refreshFanvueAccessToken).not.toHaveBeenCalled();
  });

  it('throws 401 when the token expired and no refresh token is stored', async () => {
    storedTokens({ access_token: 'at-old', expiry_date: Date.now() - 1000 });
    const error = await getValidFanvueAccessToken(supabase, 'user-1', 'fan-1').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FanvueError);
    expect((error as FanvueError).statusCode).toBe(401);
    expect(refreshFanvueAccessToken).not.toHaveBeenCalled();
    expect(updateSocialAccountTokens).not.toHaveBeenCalled();
  });
});
