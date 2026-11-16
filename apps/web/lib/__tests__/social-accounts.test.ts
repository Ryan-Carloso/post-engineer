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
});
