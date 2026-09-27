import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock('@/lib/social-accounts', () => ({
  listSocialAccounts: vi.fn(),
  deleteSocialAccount: vi.fn(),
}));

vi.mock('@/lib/supabase/service', () => ({
  createSupabaseServiceClient: vi.fn(),
}));

vi.mock('@/lib/api-keys', () => ({
  resolveApiKey: vi.fn(),
  validateApiKeyFormat: (key: string) => key.startsWith('post-engineer_'),
}));

import { GET, DELETE } from '@/app/api/account/route';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { resolveApiKey } from '@/lib/api-keys';
import { listSocialAccounts, deleteSocialAccount } from '@/lib/social-accounts';

function mockSession(userId = 'u1') {
  vi.mocked(createSupabaseServerClient).mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: userId } }, error: null }),
      getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'sb-token' } }, error: null }),
    },
  } as never);
}

describe('GET /api/account', () => {
  beforeEach(() => {
    vi.mocked(createSupabaseServerClient).mockReset();
    vi.mocked(listSocialAccounts).mockReset();
  });

  it('returns 401 when no session', async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: { message: 'no' } }) },
    } as never);

    const res = await GET();
    expect(res.status).toBe(401);
    const body = (await res.json()) as { authenticated: boolean };
    expect(body.authenticated).toBe(false);
  });

  it('maps youtube accounts with statistics', async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } }, error: null }),
        getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'sb-token' } }, error: null }),
      },
    } as never);
    vi.mocked(listSocialAccounts).mockResolvedValue([
      {
        id: 'rec-1',
        provider: 'youtube',
        providerAccountId: 'chan-1',
        accountName: 'My Channel',
        createdAt: '2024-01-01T00:00:00.000Z',
        lastUsedAt: '2024-02-01T00:00:00.000Z',
        accountMetadata: {
          thumbnail: 'thumb.png',
          customUrl: '@mychannel',
          statistics: { subscriberCount: '100', viewCount: '999', videoCount: '7' },
        },
      },
    ] as never);

    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      authenticated: boolean;
      accounts: Array<{ provider: string; channelId: string; statistics?: { subscriberCount: string; viewCount: string } }>;
    };
    expect(body.authenticated).toBe(true);
    expect(body.accounts).toHaveLength(1);
    expect(body.accounts[0].provider).toBe('youtube');
    expect(body.accounts[0].channelId).toBe('chan-1');
    expect(body.accounts[0].statistics).toEqual({
      subscriberCount: '100',
      viewCount: '999',
      videoCount: '7',
      hiddenSubscriberCount: undefined,
    });
  });

  it('maps instagram accounts with defaults for missing metadata', async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } }, error: null }),
        getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'sb-token' } }, error: null }),
      },
    } as never);
    vi.mocked(listSocialAccounts).mockResolvedValue([
      {
        id: 'rec-2',
        provider: 'instagram',
        providerAccountId: 'ig-1',
        accountName: null,
        createdAt: '2024-01-01T00:00:00.000Z',
        lastUsedAt: null,
        accountMetadata: {},
      },
    ] as never);

    const res = await GET();
    const body = (await res.json()) as {
      accounts: Array<{ provider: string; username: string; lastUsed: number }>;
    };
    expect(body.accounts[0].provider).toBe('instagram');
    expect(body.accounts[0].username).toBe('instagram_user');
    expect(body.accounts[0].lastUsed).toBe(new Date('2024-01-01T00:00:00.000Z').getTime());
  });

  it('maps bluesky accounts with did and handle (nao vira instagram)', async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } }, error: null }),
        getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'sb-token' } }, error: null }),
      },
    } as never);
    vi.mocked(listSocialAccounts).mockResolvedValue([
      {
        id: 'rec-3',
        provider: 'bluesky',
        providerAccountId: 'did:plc:abc123',
        accountName: 'eu.bsky.social',
        createdAt: '2024-01-01T00:00:00.000Z',
        lastUsedAt: null,
        accountMetadata: {},
      },
    ] as never);

    const res = await GET();
    const body = (await res.json()) as {
      accounts: Array<{ provider: string; did: string; handle: string; igUserId?: string }>;
    };
    expect(body.accounts).toHaveLength(1);
    expect(body.accounts[0].provider).toBe('bluesky');
    expect(body.accounts[0].did).toBe('did:plc:abc123');
    expect(body.accounts[0].handle).toBe('eu.bsky.social');
    expect(body.accounts[0].igUserId).toBeUndefined();
  });

  it('maps linkedin accounts with providerAccountId and metadata', async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } }, error: null }),
        getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'sb-token' } }, error: null }),
      },
    } as never);
    vi.mocked(listSocialAccounts).mockResolvedValue([
      {
        id: 'rec-4',
        provider: 'linkedin',
        providerAccountId: 'urn:li:organization:123',
        accountName: 'Minha Página',
        createdAt: '2024-01-01T00:00:00.000Z',
        lastUsedAt: null,
        accountMetadata: { kind: 'organization', name: 'Minha Página' },
      },
    ] as never);

    const res = await GET();
    const body = (await res.json()) as {
      accounts: Array<{
        provider: string;
        providerAccountId: string;
        accountName: string | null;
        accountMetadata?: { kind?: string };
      }>;
    };
    expect(body.accounts).toHaveLength(1);
    expect(body.accounts[0].provider).toBe('linkedin');
    expect(body.accounts[0].providerAccountId).toBe('urn:li:organization:123');
    expect(body.accounts[0].accountName).toBe('Minha Página');
    expect(body.accounts[0].accountMetadata?.kind).toBe('organization');
  });

  it('descarta registro com provider desconhecido e mantém o resto da lista', async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } }, error: null }),
        getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'sb-token' } }, error: null }),
      },
    } as never);
    vi.mocked(listSocialAccounts).mockResolvedValue([
      {
        id: 'rec-5',
        provider: 'tiktok',
        providerAccountId: 'tt-1',
        accountName: null,
        createdAt: '2024-01-01T00:00:00.000Z',
        lastUsedAt: null,
        accountMetadata: {},
      },
      {
        id: 'rec-6',
        provider: 'youtube',
        providerAccountId: 'chan-2',
        accountName: 'Canal Bom',
        createdAt: '2024-01-01T00:00:00.000Z',
        lastUsedAt: null,
        accountMetadata: {},
      },
    ] as never);

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { accounts: Array<{ provider: string }> };
    expect(body.accounts).toHaveLength(1);
    expect(body.accounts[0]?.provider).toBe('youtube');
    expect(consoleError).toHaveBeenCalledWith(
      '[ACCOUNT] Registro com provider desconhecido ignorado',
      expect.objectContaining({ recordId: 'rec-5', provider: 'tiktok' }),
    );
    consoleError.mockRestore();
  });

  it('aceita API key pessoal via Authorization Bearer (MCP)', async () => {
    vi.mocked(createSupabaseServiceClient).mockReturnValue({} as never);
    vi.mocked(resolveApiKey).mockResolvedValue({
      userId: 'u1',
      keyId: 'key-1',
      personaIds: null,
    });
    vi.mocked(listSocialAccounts).mockResolvedValue([
      {
        id: 'rec-1',
        provider: 'youtube',
        providerAccountId: 'chan-1',
        accountName: 'My Channel',
        createdAt: '2024-01-01T00:00:00.000Z',
        lastUsedAt: null,
        accountMetadata: {},
      },
    ] as never);

    const req = new Request('http://localhost:3434/api/account', {
      headers: { Authorization: 'Bearer post-engineer_test123' },
    });
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      authenticated: boolean;
      accounts: Array<{ provider: string; channelId: string }>;
    };
    expect(body.authenticated).toBe(true);
    expect(body.accounts).toHaveLength(1);
    expect(body.accounts[0].channelId).toBe('chan-1');
    expect(listSocialAccounts).toHaveBeenCalledWith(expect.anything(), 'u1');
  });

  it('retorna 401 com API key inválida', async () => {
    vi.mocked(createSupabaseServiceClient).mockReturnValue({} as never);
    vi.mocked(resolveApiKey).mockResolvedValue(null);

    const req = new Request('http://localhost:3434/api/account', {
      headers: { Authorization: 'Bearer post-engineer_invalid' },
    });
    const res = await GET(req);

    expect(res.status).toBe(401);
    expect(listSocialAccounts).not.toHaveBeenCalled();
  });

  it('returns 500 when listSocialAccounts throws', async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } }, error: null }),
        getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'sb-token' } }, error: null }),
      },
    } as never);
    vi.mocked(listSocialAccounts).mockRejectedValue(new Error('db fail'));

    const res = await GET();
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('LIST_ERROR');
  });
});

describe('DELETE /api/account', () => {
  beforeEach(() => {
    vi.mocked(createSupabaseServerClient).mockReset();
    vi.mocked(deleteSocialAccount).mockReset();
  });

  function deleteRequest(params: string): Request {
    return new Request(`http://localhost/api/account?${params}`, { method: 'DELETE' });
  }

  it('returns 401 when no session', async () => {
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: { message: 'no' } }) },
    } as never);

    const res = await DELETE(deleteRequest('provider=youtube&providerAccountId=ch1'));
    expect(res.status).toBe(401);
    expect(deleteSocialAccount).not.toHaveBeenCalled();
  });

  it('returns 400 when provider is missing', async () => {
    mockSession();
    const res = await DELETE(deleteRequest('providerAccountId=ch1'));
    expect(res.status).toBe(400);
    expect(deleteSocialAccount).not.toHaveBeenCalled();
  });

  it('returns 400 when providerAccountId is missing', async () => {
    mockSession();
    const res = await DELETE(deleteRequest('provider=youtube'));
    expect(res.status).toBe(400);
    expect(deleteSocialAccount).not.toHaveBeenCalled();
  });

  it('returns 400 for an unknown provider', async () => {
    mockSession();
    const res = await DELETE(deleteRequest('provider=myspace&providerAccountId=x'));
    expect(res.status).toBe(400);
    expect(deleteSocialAccount).not.toHaveBeenCalled();
  });

  it('deletes the account and returns success', async () => {
    mockSession('u1');
    vi.mocked(deleteSocialAccount).mockResolvedValue(undefined);

    const res = await DELETE(deleteRequest('provider=youtube&providerAccountId=chan-1'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean };
    expect(body.success).toBe(true);
    expect(deleteSocialAccount).toHaveBeenCalledTimes(1);
    const args = vi.mocked(deleteSocialAccount).mock.calls[0];
    expect(args[1]).toBe('u1');
    expect(args[2]).toBe('youtube');
    expect(args[3]).toBe('chan-1');
  });

  it('returns 500 when deleteSocialAccount throws', async () => {
    mockSession();
    vi.mocked(deleteSocialAccount).mockRejectedValue(new Error('db fail'));

    const res = await DELETE(deleteRequest('provider=instagram&providerAccountId=ig1'));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('DELETE_ERROR');
  });
});
