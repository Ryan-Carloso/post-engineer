import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  upsertSocialAccount,
  listSocialAccounts,
  getSocialAccountTokens,
  touchSocialAccount,
  deleteSocialAccount,
  updateSocialAccountTokens,
  updateSocialAccountMetadata,
  SOCIAL_ACCOUNT_PUBLIC_COLUMNS,
} from '@/lib/social-accounts';

const serviceFrom = vi.hoisted(() => vi.fn());

vi.mock('@/lib/supabase/service', () => ({
  createSupabaseServiceClient: () => ({ from: serviceFrom }),
}));

vi.mock('@/lib/token-crypto', () => ({
  encryptTokens: vi.fn((payload: unknown) => `encrypted.${JSON.stringify(payload)}`),
  decryptTokens: vi.fn((encrypted: string) => JSON.parse(encrypted.replace('encrypted.', ''))),
}));

function createMockChain(data: unknown, error: unknown = null) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
    single: vi.fn().mockResolvedValue({ data, error }),
    upsert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
  };
}

type MockChain = ReturnType<typeof createMockChain>;
type MockSupabase = { from?: (table: string) => MockChain } & MockChain;

const mockRow = {
  id: 'id-1',
  user_id: 'u1',
  api_key_id: null,
  provider: 'instagram',
  provider_account_id: 'ig-1',
  account_name: 'test',
  account_metadata: { username: 'test' },
  encrypted_tokens: `encrypted.${JSON.stringify({ access_token: 'tok', expiry_date: 123 })}`,
  token_expires_at: '2026-12-31T00:00:00Z',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  last_used_at: null,
};

function writeChain(error: unknown = null) {
  return {
    eq: vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error }),
    }),
  };
}

describe('social-accounts', () => {
  let mockSupabase: MockSupabase;
  let fromReturn: ReturnType<typeof createMockChain>;
  let serviceChain: ReturnType<typeof createMockChain>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSupabase = createMockChain(null);
    fromReturn = createMockChain(mockRow);
    serviceChain = createMockChain(mockRow);
    mockSupabase.from = vi.fn().mockReturnValue(fromReturn);
    serviceFrom.mockImplementation(() => serviceChain);
  });

  describe('upsertSocialAccount', () => {
    it('encrypts tokens and returns record', async () => {
      const select = vi.fn().mockReturnThis();
      serviceChain.upsert.mockReturnValue({ select, single: vi.fn().mockResolvedValue({ data: mockRow, error: null }) });

      const result = await upsertSocialAccount(mockSupabase as never, {
        userId: 'u1',
        provider: 'instagram',
        providerAccountId: 'ig-1',
        accountName: 'test',
        tokens: { access_token: 'tok' },
      });

      expect(result.id).toBe('id-1');
      expect(result.provider).toBe('instagram');
      expect(result.providerAccountId).toBe('ig-1');
      expect(select).toHaveBeenCalledWith(SOCIAL_ACCOUNT_PUBLIC_COLUMNS);
      expect(SOCIAL_ACCOUNT_PUBLIC_COLUMNS).not.toContain('encrypted_tokens');
      expect(fromReturn.upsert).not.toHaveBeenCalled();
    });

    it('writes ciphertext on the service client, not the caller client', async () => {
      const caller = createMockChain(mockRow);
      const writer = createMockChain(mockRow);
      writer.upsert.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: mockRow, error: null }),
      });
      serviceFrom.mockReturnValue(writer);

      await upsertSocialAccount({ from: () => caller } as never, {
        userId: 'u1',
        provider: 'instagram',
        providerAccountId: 'ig-1',
        tokens: { access_token: 'tok' },
      });

      expect(caller.upsert).not.toHaveBeenCalled();
      const payload = writer.upsert.mock.calls[0]?.[0] as { encrypted_tokens?: string };
      expect(payload.encrypted_tokens).toBe('encrypted.{"access_token":"tok"}');
    });

    it.each(['unknown', 'UNKNOWN', '', '  '])(
      'refuses the placeholder provider account id %j without touching the database',
      async (providerAccountId) => {
        fromReturn.upsert.mockClear();
        await expect(
          upsertSocialAccount(mockSupabase as never, {
            userId: 'u1', provider: 'youtube', providerAccountId, tokens: { access_token: 'tok' },
          })
        ).rejects.toThrow('without a real provider account id');
        expect(fromReturn.upsert).not.toHaveBeenCalled();
        expect(serviceFrom).not.toHaveBeenCalled();
      },
    );

    it('throws on supabase error', async () => {
      serviceChain.upsert.mockReturnValue({ select: vi.fn().mockReturnThis(), single: vi.fn().mockResolvedValue({ data: null, error: { message: 'db fail' } }) });

      await expect(
        upsertSocialAccount(mockSupabase as never, {
          userId: 'u1', provider: 'instagram', providerAccountId: 'ig-1', tokens: { access_token: 'tok' },
        })
      ).rejects.toThrow('Failed to upsert social account');
    });
  });

  describe('listSocialAccounts', () => {
    it('returns records without provider filter', async () => {
      fromReturn.order.mockResolvedValue({ data: [mockRow], error: null });

      const result = await listSocialAccounts(mockSupabase as never, 'u1');
      expect(result).toHaveLength(1);
      expect(result[0].provider).toBe('instagram');
      expect(fromReturn.select).toHaveBeenCalledWith(SOCIAL_ACCOUNT_PUBLIC_COLUMNS);
    });

    it('filters by provider when specified', async () => {
      fromReturn.order.mockResolvedValue({ data: [mockRow], error: null });

      await listSocialAccounts(mockSupabase as never, 'u1', 'instagram');
      expect(fromReturn.eq).toHaveBeenCalledWith('provider', 'instagram');
    });

    it('returns empty array on no data', async () => {
      fromReturn.order.mockResolvedValue({ data: null, error: null });

      const result = await listSocialAccounts(mockSupabase as never, 'u1');
      expect(result).toEqual([]);
    });

    it('throws on error', async () => {
      fromReturn.order.mockResolvedValue({ data: null, error: { message: 'fail' } });

      await expect(listSocialAccounts(mockSupabase as never, 'u1')).rejects.toThrow('Failed to list');
    });
  });

  describe('getSocialAccountTokens', () => {
    it('proves ownership on the caller client, then reads ciphertext with the service client', async () => {
      const secretChain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: { encrypted_tokens: mockRow.encrypted_tokens },
          error: null,
        }),
      };
      serviceFrom.mockReturnValue(secretChain);

      const result = await getSocialAccountTokens(mockSupabase as never, 'u1', 'instagram', 'ig-1');
      expect(result.tokens.access_token).toBe('tok');
      expect(result.account.providerAccountId).toBe('ig-1');
      expect(fromReturn.select).toHaveBeenCalledWith(SOCIAL_ACCOUNT_PUBLIC_COLUMNS);
      expect(secretChain.select).toHaveBeenCalledWith('encrypted_tokens');
      expect(secretChain.eq).toHaveBeenCalledWith('id', 'id-1');
      expect(secretChain.eq).toHaveBeenCalledWith('user_id', 'u1');
    });

    it('throws when not found and does not read ciphertext', async () => {
      fromReturn.maybeSingle.mockResolvedValue({ data: null, error: null });

      await expect(
        getSocialAccountTokens(mockSupabase as never, 'u1', 'instagram', 'ig-x')
      ).rejects.toThrow('Social account not found');
      expect(serviceFrom).not.toHaveBeenCalled();
    });
  });

  describe('touchSocialAccount', () => {
    it('updates last_used_at on the service client after the caller proves the row', async () => {
      const byUser = vi.fn().mockResolvedValue({ error: null });
      const byId = vi.fn().mockReturnValue({ eq: byUser });
      serviceChain.update.mockReturnValue({ eq: byId });

      await touchSocialAccount(mockSupabase as never, 'u1', 'instagram', 'ig-1');
      expect(fromReturn.update).not.toHaveBeenCalled();
      expect(byId).toHaveBeenCalledWith('id', 'id-1');
      expect(byUser).toHaveBeenCalledWith('user_id', 'u1');
    });

    it('does not write when the caller cannot see the row', async () => {
      fromReturn.maybeSingle.mockResolvedValue({ data: null, error: null });
      await touchSocialAccount(mockSupabase as never, 'u1', 'instagram', 'ig-1');
      expect(serviceFrom).not.toHaveBeenCalled();
    });

    it('throws on error', async () => {
      serviceChain.update.mockReturnValue(writeChain({ message: 'fail' }));

      await expect(
        touchSocialAccount(mockSupabase as never, 'u1', 'instagram', 'ig-1')
      ).rejects.toThrow('Failed to touch');
    });
  });

  describe('deleteSocialAccount', () => {
    it('deletes on the service client after the caller proves the row', async () => {
      serviceChain.delete.mockReturnValue(writeChain());

      await expect(
        deleteSocialAccount(mockSupabase as never, 'u1', 'instagram', 'ig-1')
      ).resolves.toBeUndefined();
      expect(fromReturn.delete).not.toHaveBeenCalled();
      expect(serviceChain.delete).toHaveBeenCalled();
    });

    it('throws on error', async () => {
      serviceChain.delete.mockReturnValue(writeChain({ message: 'fail' }));

      await expect(
        deleteSocialAccount(mockSupabase as never, 'u1', 'instagram', 'ig-1')
      ).rejects.toThrow('Failed to delete');
    });
  });

  describe('updateSocialAccountTokens', () => {
    it('encrypts and updates on the service client', async () => {
      serviceChain.update.mockReturnValue(writeChain());

      await expect(
        updateSocialAccountTokens(mockSupabase as never, 'u1', 'instagram', 'ig-1', {
          access_token: 'new-tok',
        })
      ).resolves.toBeUndefined();
      expect(fromReturn.update).not.toHaveBeenCalled();
      const payload = serviceChain.update.mock.calls[0]?.[0] as { encrypted_tokens?: string };
      expect(payload.encrypted_tokens).toContain('encrypted.');
      expect(payload.encrypted_tokens).not.toBe('new-tok');
    });

    it('throws on error', async () => {
      serviceChain.update.mockReturnValue(writeChain({ message: 'fail' }));

      await expect(
        updateSocialAccountTokens(mockSupabase as never, 'u1', 'instagram', 'ig-1', {
          access_token: 'new-tok',
        })
      ).rejects.toThrow('Failed to update social account tokens');
    });
  });

  describe('updateSocialAccountMetadata', () => {
    it('updates metadata on the service client', async () => {
      serviceChain.update.mockReturnValue(writeChain());

      await expect(
        updateSocialAccountMetadata(mockSupabase as never, 'u1', 'instagram', 'ig-1', { username: 'x' })
      ).resolves.toBeUndefined();
      const payload = serviceChain.update.mock.calls[0][0] as Record<string, unknown>;
      expect(payload.account_metadata).toEqual({ username: 'x' });
      expect('account_name' in payload).toBe(false);
      expect(fromReturn.update).not.toHaveBeenCalled();
    });

    it('also writes account_name when one is given', async () => {
      serviceChain.update.mockReturnValue(writeChain());

      await updateSocialAccountMetadata(mockSupabase as never, 'u1', 'instagram', 'ig-1', { username: 'y' }, 'y');
      const payload = serviceChain.update.mock.calls.at(-1)?.[0] as Record<string, unknown>;
      expect(payload.account_name).toBe('y');
      expect(payload.account_metadata).toEqual({ username: 'y' });
    });
  });

  //--------------- Coverage of every changed failure branch ---------------
  // The prompt asks for each service-client write path on success,
  // error, and missing-row, plus ownership predicates and the
  // public-columns select list. These tests pin those branches so a
  // mutation that drops an .eq('user_id') or swaps clients fails.
  describe('branch coverage', () => {
    it('upsert writes with tokenExpiresAt date and asserts ownership predicate shape', async () => {
      const select = vi.fn().mockReturnThis();
      const single = vi.fn().mockResolvedValue({ data: mockRow, error: null });
      serviceChain.upsert.mockReturnValue({ select, single });
      const expires = new Date('2026-08-08T00:00:00Z');

      await upsertSocialAccount(mockSupabase as never, {
        userId: 'u1',
        provider: 'instagram',
        providerAccountId: 'ig-1',
        tokens: { access_token: 'tok', expiry_date: 123 },
        tokenExpiresAt: expires,
      });

      expect(serviceChain.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ user_id: 'u1', provider: 'instagram', provider_account_id: 'ig-1' }),
        { onConflict: 'user_id,provider,provider_account_id' },
      );
      expect(select).toHaveBeenCalledWith(SOCIAL_ACCOUNT_PUBLIC_COLUMNS);
      expect(SOCIAL_ACCOUNT_PUBLIC_COLUMNS).not.toContain('encrypted_tokens');
      const payload = serviceChain.upsert.mock.calls[0]?.[0] as { token_expires_at?: string };
      expect(payload.token_expires_at).toBe(expires.toISOString());
      // The caller client is unused for the upsert write path.
      expect(fromReturn.upsert).not.toHaveBeenCalled();
    });

    it('upsert throws Invalid social account row when the service returns a non-object', async () => {
      serviceChain.upsert.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: null }),
      });
      await expect(
        upsertSocialAccount(mockSupabase as never, {
          userId: 'u1',
          provider: 'instagram',
          providerAccountId: 'ig-1',
          tokens: { access_token: 'tok' },
        }),
      ).rejects.toThrow('Invalid social account row');
    });

    it('asRecord returns {} for null, array, and string account_metadata', async () => {
      fromReturn.order.mockResolvedValue({
        data: [
          { ...mockRow, account_metadata: null },
          { ...mockRow, account_metadata: [] },
          { ...mockRow, account_metadata: 'oops' },
        ],
        error: null,
      });
      const result = await listSocialAccounts(mockSupabase as never, 'u1');
      expect(result).toHaveLength(3);
      expect(result[0].accountMetadata).toEqual({});
      expect(result[1].accountMetadata).toEqual({});
      expect(result[2].accountMetadata).toEqual({});
    });

    it('list asserts the public-columns select list and filters by user_id and provider', async () => {
      fromReturn.order.mockResolvedValue({ data: [mockRow], error: null });
      await listSocialAccounts(mockSupabase as never, 'u1', 'instagram');
      expect(fromReturn.select).toHaveBeenCalledWith(SOCIAL_ACCOUNT_PUBLIC_COLUMNS);
      expect(fromReturn.eq).toHaveBeenCalledWith('user_id', 'u1');
      expect(fromReturn.eq).toHaveBeenCalledWith('provider', 'instagram');
      expect(fromReturn.order).toHaveBeenCalledWith('last_used_at', { ascending: false });
    });

    it('ownedAccountId throws Failed to get social account when the lookup fails', async () => {
      fromReturn.maybeSingle.mockResolvedValue({ data: null, error: { message: 'db down' } });
      await expect(touchSocialAccount(mockSupabase as never, 'u1', 'instagram', 'ig-1')).rejects.toThrow(
        'Failed to get social account: db down',
      );
    });

    it('ownedAccountId returns null when the id is not a string', async () => {
      fromReturn.maybeSingle.mockResolvedValue({ data: { id: 123 }, error: null });
      const byUser = vi.fn().mockResolvedValue({ error: null });
      const byId = vi.fn().mockReturnValue({ eq: byUser });
      serviceChain.update.mockReturnValue({ eq: byId });
      // touch returns silently when the id is not a string.
      await touchSocialAccount(mockSupabase as never, 'u1', 'instagram', 'ig-1');
      expect(serviceFrom).not.toHaveBeenCalled();
      // update throws NotFound in that case.
      await expect(
        updateSocialAccountTokens(mockSupabase as never, 'u1', 'instagram', 'ig-1', { access_token: 'x' }),
      ).rejects.toThrow('Social account not found');
    });

    it('ownedAccountId asserts its lookup predicates on the caller client', async () => {
      const byUser = vi.fn().mockResolvedValue({ error: null });
      const byId = vi.fn().mockReturnValue({ eq: byUser });
      serviceChain.update.mockReturnValue({ eq: byId });
      await touchSocialAccount(mockSupabase as never, 'u1', 'instagram', 'ig-1');
      expect(mockSupabase.from).toHaveBeenCalledWith('social_accounts');
      expect(fromReturn.select).toHaveBeenCalledWith('id');
      expect(fromReturn.eq).toHaveBeenCalledWith('user_id', 'u1');
      expect(fromReturn.eq).toHaveBeenCalledWith('provider', 'instagram');
      expect(fromReturn.eq).toHaveBeenCalledWith('provider_account_id', 'ig-1');
    });

    it('getSocialAccountTokens throws when the session lookup fails and does not read ciphertext', async () => {
      fromReturn.maybeSingle.mockResolvedValue({ data: null, error: { message: 'session db down' } });
      await expect(getSocialAccountTokens(mockSupabase as never, 'u1', 'instagram', 'ig-1')).rejects.toThrow(
        'Failed to get social account: session db down',
      );
      expect(serviceFrom).not.toHaveBeenCalled();
    });

    it('getSocialAccountTokens throws when the service secret read fails', async () => {
      const secretChain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: { message: 'secret db down' } }),
      };
      serviceFrom.mockReturnValue(secretChain);
      await expect(getSocialAccountTokens(mockSupabase as never, 'u1', 'instagram', 'ig-1')).rejects.toThrow(
        'Failed to get social account: secret db down',
      );
    });

    it('getSocialAccountTokens throws NotFound when the service secret row vanished', async () => {
      const secretChain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      };
      serviceFrom.mockReturnValue(secretChain);
      await expect(getSocialAccountTokens(mockSupabase as never, 'u1', 'instagram', 'ig-1')).rejects.toThrow(
        'Social account not found',
      );
    });

    it('getSocialAccountTokens throws Invalid row when ciphertext is missing or malformed', async () => {
      for (const secret of [{}, { encrypted_tokens: 42 }, { encrypted_tokens: null }, { encrypted_tokens: undefined }]) {
        const secretChain = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: secret, error: null }),
        };
        serviceFrom.mockReturnValue(secretChain);
        await expect(getSocialAccountTokens(mockSupabase as never, 'u1', 'instagram', 'ig-1')).rejects.toThrow(
          'Invalid social account row',
        );
      }
    });

    it('getSocialAccountTokens asserts both ownership predicates on the service read', async () => {
      const eqCalls: Array<[string, string]> = [];
      const secretChain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn((col: string, val: string) => {
          eqCalls.push([col, val]);
          return secretChain;
        }),
        maybeSingle: vi.fn().mockResolvedValue({
          data: { encrypted_tokens: mockRow.encrypted_tokens },
          error: null,
        }),
      };
      serviceFrom.mockReturnValue(secretChain);
      const result = await getSocialAccountTokens(mockSupabase as never, 'u1', 'instagram', 'ig-1');
      expect(result.account.id).toBe('id-1');
      expect(eqCalls).toContainEqual(['id', 'id-1']);
      expect(eqCalls).toContainEqual(['user_id', 'u1']);
    });

    it('updateSocialAccountTokens throws NotFound when the caller cannot see the row and writes nothing', async () => {
      fromReturn.maybeSingle.mockResolvedValue({ data: null, error: null });
      await expect(
        updateSocialAccountTokens(mockSupabase as never, 'u1', 'instagram', 'ig-1', { access_token: 'new' }),
      ).rejects.toThrow('Social account not found');
      expect(serviceFrom).not.toHaveBeenCalled();
    });

    it('updateSocialAccountTokens writes expiry_date through the service client with both predicates', async () => {
      const byUser = vi.fn().mockResolvedValue({ error: null });
      const byId = vi.fn().mockReturnValue({ eq: byUser });
      serviceChain.update.mockClear();
      serviceChain.update.mockReturnValue({ eq: byId });
      await updateSocialAccountTokens(mockSupabase as never, 'u1', 'instagram', 'ig-1', {
        access_token: 'new',
        expiry_date: 1700000000000,
      });
      const payload = serviceChain.update.mock.calls[0]?.[0] as {
        encrypted_tokens?: string;
        token_expires_at?: string | null;
      };
      expect(payload.encrypted_tokens).toContain('encrypted.');
      expect(payload.token_expires_at).toBe(new Date(1700000000000).toISOString());
      expect(byId).toHaveBeenCalledWith('id', 'id-1');
      expect(byUser).toHaveBeenCalledWith('user_id', 'u1');
    });

    it('updateSocialAccountMetadata throws NotFound and does not write when missing', async () => {
      fromReturn.maybeSingle.mockResolvedValue({ data: null, error: null });
      await expect(updateSocialAccountMetadata(mockSupabase as never, 'u1', 'instagram', 'ig-1', { a: 1 })).rejects.toThrow(
        'Social account not found',
      );
      expect(serviceFrom).not.toHaveBeenCalled();
    });

    it('updateSocialAccountMetadata throws on service error with exact message and asserts predicates', async () => {
      const byUser = vi.fn().mockResolvedValue({ error: { message: 'upd fail' } });
      const byId = vi.fn().mockReturnValue({ eq: byUser });
      serviceChain.update.mockClear();
      serviceChain.update.mockReturnValue({ eq: byId });
      await expect(
        updateSocialAccountMetadata(mockSupabase as never, 'u1', 'instagram', 'ig-1', { a: 1 }, 'name'),
      ).rejects.toThrow('Failed to update social account metadata: upd fail');
      expect(byId).toHaveBeenCalledWith('id', 'id-1');
      expect(byUser).toHaveBeenCalledWith('user_id', 'u1');
    });

    it('deleteSocialAccount returns silently when the row is missing and writes nothing', async () => {
      fromReturn.maybeSingle.mockResolvedValue({ data: null, error: null });
      await expect(deleteSocialAccount(mockSupabase as never, 'u1', 'instagram', 'ig-1')).resolves.toBeUndefined();
      expect(serviceFrom).not.toHaveBeenCalled();
    });

    it('deleteSocialAccount asserts both predicates on the service delete and throws on error', async () => {
      const byUser = vi.fn().mockResolvedValue({ error: { message: 'del fail' } });
      const byId = vi.fn().mockReturnValue({ eq: byUser });
      serviceChain.delete.mockClear();
      serviceChain.delete.mockReturnValue({ eq: byId });
      await expect(deleteSocialAccount(mockSupabase as never, 'u1', 'instagram', 'ig-1')).rejects.toThrow(
        'Failed to delete social account: del fail',
      );
      expect(byId).toHaveBeenCalledWith('id', 'id-1');
      expect(byUser).toHaveBeenCalledWith('user_id', 'u1');
    });

    it('touch asserts both predicates on the service update and throws on error', async () => {
      const byUser = vi.fn().mockResolvedValue({ error: { message: 'touch fail' } });
      const byId = vi.fn().mockReturnValue({ eq: byUser });
      serviceChain.update.mockClear();
      serviceChain.update.mockReturnValue({ eq: byId });
      await expect(touchSocialAccount(mockSupabase as never, 'u1', 'instagram', 'ig-1')).rejects.toThrow(
        'Failed to touch social account: touch fail',
      );
      expect(byId).toHaveBeenCalledWith('id', 'id-1');
      expect(byUser).toHaveBeenCalledWith('user_id', 'u1');
    });

    it('SOCIAL_ACCOUNT_PUBLIC_COLUMNS never selects encrypted_tokens', () => {
      expect(SOCIAL_ACCOUNT_PUBLIC_COLUMNS).not.toContain('encrypted_tokens');
      expect(SOCIAL_ACCOUNT_PUBLIC_COLUMNS).toContain('id');
      expect(SOCIAL_ACCOUNT_PUBLIC_COLUMNS).toContain('user_id');
    });
  });
});
