import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, it, expect, vi } from 'vitest';
import {
  generateRawApiKey,
  hashApiKey,
  extractKeyPrefix,
  validateApiKeyFormat,
  resolveApiKey,
  isPersonaAllowed,
  isScopedApiKey,
} from '../api-keys';

describe('API Keys Utilities', () => {
  it('generates a valid api key starting with pe_live_', () => {
    const key = generateRawApiKey();
    expect(key.startsWith('pe_live_')).toBe(true);
    expect(validateApiKeyFormat(key)).toBe(true);
    expect(key.length).toBeGreaterThan(32);
  });

  it('correctly hashes keys with SHA-256', () => {
    const raw = 'pe_live_1234567890abcdef1234567890abcdef';
    const hash1 = hashApiKey(raw);
    const hash2 = hashApiKey(raw);
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64);
  });

  it('extracts key prefix for safe display', () => {
    const raw = 'pe_live_abc12345xyz67890';
    const prefix = extractKeyPrefix(raw);
    expect(prefix).toBe('pe_live_abc12345...');
  });

  it('validates api key format correctly', () => {
    expect(validateApiKeyFormat('pe_live_abcdef1234567890abcdef1234567890')).toBe(true);
    expect(validateApiKeyFormat('invalid_prefix_123')).toBe(false);
    expect(validateApiKeyFormat('')).toBe(false);
    expect(validateApiKeyFormat('pe_live_short')).toBe(false);
  });

  it('resolves active api key to user_id and updates last_used_at', async () => {
    const rawKey = 'pe_live_test_valid_key_1234567890abcdef';
    const keyHash = hashApiKey(rawKey);

    const mockUpdate = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    });

    const mockSupabase = {
      from: vi.fn((table: string) => {
        if (table === 'user_api_keys') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn((col: string, val: string) => {
                if (col === 'key_hash' && val === keyHash) {
                  return {
                    is: vi.fn().mockReturnValue({
                      single: vi.fn().mockResolvedValue({
                        data: {
                          id: 'key-id-1',
                          user_id: 'user-id-abc',
                          persona_ids: null,
                          revoked_at: null,
                        },
                        error: null,
                      }),
                    }),
                  };
                }
                return { is: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: null, error: { message: 'not found' } }) }) };
              }),
            }),
            update: mockUpdate,
          };
        }
        return {};
      }),
    };

    const resolved = await resolveApiKey(rawKey, mockSupabase as unknown as SupabaseClient);
    expect(resolved).toEqual({ userId: 'user-id-abc', keyId: 'key-id-1', personaIds: null });
  });

  it('resolves persona scope when the key is restricted', async () => {
    const rawKey = 'pe_live_scoped_key_1234567890abcdef12';
    const personaIds = [
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
    ];

    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            is: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: 'key-id-2',
                  user_id: 'user-id-abc',
                  persona_ids: personaIds,
                  revoked_at: null,
                },
                error: null,
              }),
            }),
          }),
        }),
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: null }),
        }),
      }),
    };

    const resolved = await resolveApiKey(rawKey, mockSupabase as unknown as SupabaseClient);
    expect(resolved?.personaIds).toEqual(personaIds);
  });

  it('normalizes missing persona scope to null (full access)', async () => {
    const rawKey = 'pe_live_legacy_key_1234567890abcdef12';

    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            is: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { id: 'key-id-3', user_id: 'user-id-abc', revoked_at: null },
                error: null,
              }),
            }),
          }),
        }),
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: null }),
        }),
      }),
    };

    const resolved = await resolveApiKey(rawKey, mockSupabase as unknown as SupabaseClient);
    expect(resolved?.personaIds).toBeNull();
  });

  it('returns null if api key is not found or revoked', async () => {
    const rawKey = 'pe_live_test_revoked_key_1234567890abcdef';

    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            is: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: null,
                error: { message: 'Row not found' },
              }),
            }),
          }),
        }),
      }),
    };

    const userId = await resolveApiKey(rawKey, mockSupabase as unknown as SupabaseClient);
    expect(userId).toBeNull();
  });

  describe('isPersonaAllowed', () => {
    it('allows everything when scope is null (unrestricted key)', () => {
      expect(isPersonaAllowed(null, 'any-persona-id')).toBe(true);
    });

    it('allows everything when scope is undefined (web session)', () => {
      expect(isPersonaAllowed(undefined, 'any-persona-id')).toBe(true);
    });

    it('allows only listed personas for scoped keys', () => {
      expect(isPersonaAllowed(['p-1', 'p-2'], 'p-1')).toBe(true);
      expect(isPersonaAllowed(['p-1', 'p-2'], 'p-3')).toBe(false);
    });
  });

  describe('isScopedApiKey', () => {
    it('detects restricted api keys', () => {
      expect(isScopedApiKey({ isApiKey: true, personaIds: ['p-1'] })).toBe(true);
    });

    it('treats unrestricted keys and sessions as unscoped', () => {
      expect(isScopedApiKey({ isApiKey: true, personaIds: null })).toBe(false);
      expect(isScopedApiKey({ isApiKey: true })).toBe(false);
      expect(isScopedApiKey({})).toBe(false);
    });
  });
});
