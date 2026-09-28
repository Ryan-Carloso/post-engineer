import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/oauth-connect', () => ({
  resolveOAuthCallbackAuth: vi.fn(),
}));
vi.mock('@/lib/linkedin', () => ({
  exchangeLinkedInCodeForToken: vi.fn(),
  fetchLinkedInMemberProfile: vi.fn(),
  fetchLinkedInAdminOrganizations: vi.fn(),
}));
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
}));
vi.mock('@/lib/supabase/service', () => ({
  createSupabaseServiceClient: vi.fn(),
}));
vi.mock('@/lib/social-accounts', () => ({
  upsertSocialAccount: vi.fn(),
}));
vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { GET } from '@/app/api/linkedin-auth/callback/route';
import { resolveOAuthCallbackAuth } from '@/lib/oauth-connect';
import {
  exchangeLinkedInCodeForToken,
  fetchLinkedInMemberProfile,
  fetchLinkedInAdminOrganizations,
} from '@/lib/linkedin';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { upsertSocialAccount } from '@/lib/social-accounts';
import { logger } from '@/lib/logger';

function makeRequest(): NextRequest {
  return new NextRequest('http://localhost/api/linkedin-auth/callback?code=c&state=s');
}

describe('/api/linkedin-auth/callback failure logging', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveOAuthCallbackAuth).mockResolvedValue({
      ok: true,
      userId: 'user-1',
      redirectUri: 'https://app/cb',
      viaMcp: false,
    } as never);
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null }) },
    } as never);
    vi.mocked(exchangeLinkedInCodeForToken).mockResolvedValue({
      access_token: 'tok',
      expires_in: 3600,
    } as never);
    vi.mocked(fetchLinkedInMemberProfile).mockResolvedValue({ id: 'm1', name: 'Member' } as never);
    vi.mocked(fetchLinkedInAdminOrganizations).mockResolvedValue([]);
    vi.mocked(upsertSocialAccount).mockResolvedValue({} as never);
  });

  it('logs when the token exchange fails', async () => {
    vi.mocked(exchangeLinkedInCodeForToken).mockRejectedValue(new Error('bad_verifier'));
    const res = await GET(makeRequest());
    expect(await res.text()).toContain('linkedin-oauth-error');
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('token exchange failed'),
      expect.objectContaining({ message: 'bad_verifier' }),
    );
  });

  it('logs when the profile fetch fails', async () => {
    vi.mocked(fetchLinkedInMemberProfile).mockRejectedValue(new Error('profile down'));
    const res = await GET(makeRequest());
    expect(await res.text()).toContain('linkedin-oauth-error');
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('profile fetch failed'),
      expect.objectContaining({ message: 'profile down' }),
    );
  });

  it('logs when persisting the account fails', async () => {
    vi.mocked(upsertSocialAccount).mockRejectedValue(new Error('db down'));
    const res = await GET(makeRequest());
    expect(await res.text()).toContain('linkedin-oauth-error');
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('account save failed'),
      expect.objectContaining({ message: 'db down' }),
    );
  });
});
