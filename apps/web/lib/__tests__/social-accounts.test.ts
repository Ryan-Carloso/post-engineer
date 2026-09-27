import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  upsertSocialAccount,
  listSocialAccounts,
  getSocialAccountTokens,
  touchSocialAccount,
  deleteSocialAccount,
  updateSocialAccountTokens,
  updateSocialAccountMetadata,
} from '@/lib/social-accounts';

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

describe('social-accounts', () => {
  let mockSupabase: MockSupabase;
  let fromReturn: ReturnType<typeof createMockChain>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSupabase = createMockChain(null);
    fromReturn = createMockChain(mockRow);
    mockSupabase.from = vi.fn().mockReturnValue(fromReturn);
  });

  describe('upsertSocialAccount', () => {
    it('encrypts tokens and returns record', async () => {
      fromReturn.upsert.mockReturnValue({ select: vi.fn().mockReturnThis(), single: vi.fn().mockResolvedValue({ data: mockRow, error: null }) });

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
    });

    it('throws on supabase error', async () => {
      fromReturn.upsert.mockReturnValue({ select: vi.fn().mockReturnThis(), single: vi.fn().mockResolvedValue({ data: null, error: { message: 'db fail' } }) });

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
    it('returns decrypted tokens and account', async () => {
      const result = await getSocialAccountTokens(mockSupabase as never, 'u1', 'instagram', 'ig-1');
      expect(result.tokens.access_token).toBe('tok');
      expect(result.account.providerAccountId).toBe('ig-1');
    });

    it('throws when not found', async () => {
      fromReturn.maybeSingle.mockResolvedValue({ data: null, error: null });

      await expect(
        getSocialAccountTokens(mockSupabase as never, 'u1', 'instagram', 'ig-x')
      ).rejects.toThrow('Social account not found');
    });
  });

  describe('touchSocialAccount', () => {
    it('calls update', async () => {
      fromReturn.update.mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        }),
      });

      await touchSocialAccount(mockSupabase as never, 'u1', 'instagram', 'ig-1');
      expect(fromReturn.update).toHaveBeenCalled();
    });

    it('throws on error', async () => {
      fromReturn.update.mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: { message: 'fail' } }),
          }),
        }),
      });

      await expect(
        touchSocialAccount(mockSupabase as never, 'u1', 'instagram', 'ig-1')
      ).rejects.toThrow('Failed to touch');
    });
  });

  describe('deleteSocialAccount', () => {
    it('deletes without error', async () => {
      fromReturn.delete.mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        }),
      });

      await expect(
        deleteSocialAccount(mockSupabase as never, 'u1', 'instagram', 'ig-1')
      ).resolves.toBeUndefined();
      expect(fromReturn.delete).toHaveBeenCalled();
    });

    it('throws on error', async () => {
      fromReturn.delete.mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: { message: 'fail' } }),
          }),
        }),
      });

      await expect(
        deleteSocialAccount(mockSupabase as never, 'u1', 'instagram', 'ig-1')
      ).rejects.toThrow('Failed to delete');
    });
  });

  describe('updateSocialAccountTokens', () => {
    it('encrypts and updates', async () => {
      fromReturn.update.mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        }),
      });

      await expect(
        updateSocialAccountTokens(mockSupabase as never, 'u1', 'instagram', 'ig-1', {
          access_token: 'new-tok',
        })
      ).resolves.toBeUndefined();
      expect(fromReturn.update).toHaveBeenCalled();
    });

    it('throws on error', async () => {
      fromReturn.update.mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: { message: 'fail' } }),
          }),
        }),
      });

      await expect(
        updateSocialAccountTokens(mockSupabase as never, 'u1', 'instagram', 'ig-1', {
          access_token: 'new-tok',
        })
      ).rejects.toThrow('Failed to update social account tokens');
    });
  });

  describe('updateSocialAccountMetadata', () => {
    it('updates metadata', async () => {
      fromReturn.update.mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        }),
      });

      await expect(
        updateSocialAccountMetadata(mockSupabase as never, 'u1', 'instagram', 'ig-1', { username: 'x' })
      ).resolves.toBeUndefined();
    });
  });
});
