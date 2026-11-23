import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock('@/lib/social-accounts', () => ({
  listSocialAccounts: vi.fn(),
  deleteSocialAccount: vi.fn(),
}));

vi.mock('@/lib/account-profile-sync', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/account-profile-sync')>();
  return { syncAccountProfile: vi.fn(), credentialFailureHeld: actual.credentialFailureHeld };
});

vi.mock('@/lib/supabase/service', () => ({
  createSupabaseServiceClient: vi.fn(),
}));

vi.mock('@/lib/rate-limit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/rate-limit')>()),
  applyRateLimit: vi.fn(async () => null),
}));

import { GET } from '@/app/api/account/route';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { listSocialAccounts, type SocialAccountRecord } from '@/lib/social-accounts';
import { syncAccountProfile } from '@/lib/account-profile-sync';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { parseListAccountsQuery } from '@/lib/contracts/accounts';

const stored: SocialAccountRecord = {
  id: 'rec-1',
  userId: 'u1',
  provider: 'instagram',
  providerAccountId: 'ig-1',
  accountName: 'handle',
  accountMetadata: { username: 'handle', profilePictureUrl: 'https://scontent.cdninstagram.com/p.jpg' },
  tokenExpiresAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  lastUsedAt: null,
  needsReconnect: false,
};

function request(query: string): Request {
  return new Request(`http://localhost/api/account${query}`);
}

describe('GET /api/account?refresh=1', () => {
  beforeEach(() => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      auth: {
        getClaims: vi.fn().mockResolvedValue({ data: { claims: { sub: 'u1' } }, error: null }),
        getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'sb-token' } }, error: null }),
      },
    } as never);
    vi.mocked(listSocialAccounts).mockReset();
    vi.mocked(listSocialAccounts).mockResolvedValue([stored]);
    vi.mocked(syncAccountProfile).mockReset();
    vi.mocked(syncAccountProfile).mockImplementation(async (_supabase: unknown, _userId: string, rec: SocialAccountRecord) => rec);
    vi.mocked(applyRateLimit).mockReset();
    vi.mocked(applyRateLimit).mockResolvedValue(null);
  });

  it('forces the profile sync of every account and applies the refresh rate limit', async () => {
    const res = await GET(request('?refresh=1'));
    expect(res.status).toBe(200);
    expect(syncAccountProfile).toHaveBeenCalledWith(expect.anything(), 'u1', stored, { force: true });
    expect(applyRateLimit).toHaveBeenCalledWith(expect.any(Request), RATE_LIMITS.accountProfileRefresh, 'u1');
  });

  it('does not force the sync or apply the refresh rate limit without the parameter', async () => {
    const res = await GET(request(''));
    expect(res.status).toBe(200);
    expect(syncAccountProfile).toHaveBeenCalledWith(expect.anything(), 'u1', stored, { force: false });
    expect(applyRateLimit).not.toHaveBeenCalledWith(expect.anything(), RATE_LIMITS.accountProfileRefresh, expect.anything());
  });

  it('returns the 429 of the refresh rate limit before any provider is called', async () => {
    const limited = new Response(null, { status: 429 });
    vi.mocked(applyRateLimit).mockImplementation(async (_req, profile) =>
      (profile === RATE_LIMITS.accountProfileRefresh ? (limited as never) : null));
    const res = await GET(request('?refresh=1'));
    expect(res.status).toBe(429);
    expect(listSocialAccounts).not.toHaveBeenCalled();
    expect(syncAccountProfile).not.toHaveBeenCalled();
  });

  it.each(['?refresh=0', '?refresh=true', '?refresh=', '?refresh=1&refresh=1'])(
    'rejects %s with 400 before reading any account',
    async (query) => {
      const res = await GET(request(query));
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: 'INVALID_PARAMS' });
      expect(listSocialAccounts).not.toHaveBeenCalled();
      expect(syncAccountProfile).not.toHaveBeenCalled();
    },
  );
});

describe('parseListAccountsQuery', () => {
  it('reads an absent parameter as no refresh and exactly 1 as a refresh', () => {
    expect(parseListAccountsQuery(new URLSearchParams(''))).toEqual({ ok: true, refresh: false });
    expect(parseListAccountsQuery(new URLSearchParams('refresh=1'))).toEqual({ ok: true, refresh: true });
  });

  it('rejects any other value and a repeated parameter', () => {
    expect(parseListAccountsQuery(new URLSearchParams('refresh=yes'))).toMatchObject({ ok: false, code: 'INVALID_PARAMS' });
    expect(parseListAccountsQuery(new URLSearchParams('refresh=1&refresh=1'))).toMatchObject({ ok: false });
  });
});
