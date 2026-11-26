import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

const { warnMock } = vi.hoisted(() => ({ warnMock: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger: { warn: warnMock } }));

import {
  API_KEY_LAST_USED_TOUCH_INTERVAL_MS,
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

  it('resolves active api key to user_id', async () => {
    const rawKey = 'pe_live_test_valid_key_1234567890abcdef';
    const keyHash = hashApiKey(rawKey);

    const mockUpdate = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({ or: vi.fn().mockResolvedValue({ error: null }) }),
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
                          approval_mode: 'yolo',
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
    expect(resolved).toEqual({ userId: 'user-id-abc', keyId: 'key-id-1', personaIds: null, approvalMode: 'yolo' });
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
                  approval_mode: 'approval',
                  revoked_at: null,
                },
                error: null,
              }),
            }),
          }),
        }),
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({ or: vi.fn().mockResolvedValue({ error: null }) }),
        }),
      }),
    };

    const resolved = await resolveApiKey(rawKey, mockSupabase as unknown as SupabaseClient);
    expect(resolved?.personaIds).toEqual(personaIds);
    expect(resolved?.approvalMode).toBe('approval');
  });

  it('normalizes missing persona scope to null (full access)', async () => {
    const rawKey = 'pe_live_legacy_key_1234567890abcdef12';

    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            is: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { id: 'key-id-3', user_id: 'user-id-abc', approval_mode: 'yolo', revoked_at: null },
                error: null,
              }),
            }),
          }),
        }),
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({ or: vi.fn().mockResolvedValue({ error: null }) }),
        }),
      }),
    };

    const resolved = await resolveApiKey(rawKey, mockSupabase as unknown as SupabaseClient);
    expect(resolved?.personaIds).toBeNull();
    expect(resolved?.approvalMode).toBe('yolo');
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

  it('returns null when the stored approval mode is unrecognized', async () => {
    const rawKey = 'pe_live_test_weird_mode_key_1234567890ab';

    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            is: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: {
                  id: 'key-id-4',
                  user_id: 'user-id-abc',
                  persona_ids: null,
                  approval_mode: 'sometimes',
                  revoked_at: null,
                  last_used_at: null,
                },
                error: null,
              }),
            }),
          }),
        }),
      }),
    };

    const resolved = await resolveApiKey(rawKey, mockSupabase as unknown as SupabaseClient);
    expect(resolved).toBeNull();
  });

  describe('last_used_at touch throttle', () => {
    const NOW = new Date('2026-11-23T12:00:00.000Z');
    const RAW_KEY = 'pe_live_touch_key_1234567890abcdef1234';

    interface TouchMock {
      supabase: SupabaseClient;
      selectColumns: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      updateEq: ReturnType<typeof vi.fn>;
      updateOr: ReturnType<typeof vi.fn>;
    }

    function touchMock(lastUsedAt: string | null, updateError: { code: string; message: string } | null = null): TouchMock {
      const updateOr = vi.fn().mockResolvedValue({ data: null, error: updateError });
      const updateEq = vi.fn().mockReturnValue({ or: updateOr });
      const update = vi.fn().mockReturnValue({ eq: updateEq });
      const selectColumns = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          is: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { id: 'key-id-9', user_id: 'user-id-abc', persona_ids: null, approval_mode: 'yolo', revoked_at: null, last_used_at: lastUsedAt },
              error: null,
            }),
          }),
        }),
      });
      const supabase = { from: vi.fn().mockReturnValue({ select: selectColumns, update }) } as unknown as SupabaseClient;
      return { supabase, selectColumns, update, updateEq, updateOr };
    }

    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(NOW);
      warnMock.mockReset();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('throttles to one write per hour', () => {
      expect(API_KEY_LAST_USED_TOUCH_INTERVAL_MS).toBe(60 * 60 * 1000);
    });

    it('selects last_used_at in the key lookup', async () => {
      const mock = touchMock(NOW.toISOString());
      await resolveApiKey(RAW_KEY, mock.supabase);
      expect(mock.selectColumns).toHaveBeenCalledWith('id, user_id, persona_ids, approval_mode, revoked_at, last_used_at');
    });

    it('does not write when the key was used less than an hour ago', async () => {
      const fresh = new Date(NOW.getTime() - API_KEY_LAST_USED_TOUCH_INTERVAL_MS + 1000).toISOString();
      const mock = touchMock(fresh);
      const resolved = await resolveApiKey(RAW_KEY, mock.supabase);
      expect(resolved).toEqual({ userId: 'user-id-abc', keyId: 'key-id-9', personaIds: null, approvalMode: 'yolo' });
      expect(mock.update).not.toHaveBeenCalled();
    });

    it('does not write when the key was used exactly an hour ago', async () => {
      const boundary = new Date(NOW.getTime() - API_KEY_LAST_USED_TOUCH_INTERVAL_MS).toISOString();
      const mock = touchMock(boundary);
      await resolveApiKey(RAW_KEY, mock.supabase);
      expect(mock.update).not.toHaveBeenCalled();
    });

    it('writes with a conditional predicate when the key was used more than an hour ago', async () => {
      const stale = new Date(NOW.getTime() - API_KEY_LAST_USED_TOUCH_INTERVAL_MS - 1000).toISOString();
      const mock = touchMock(stale);
      const resolved = await resolveApiKey(RAW_KEY, mock.supabase);
      expect(resolved?.keyId).toBe('key-id-9');
      expect(mock.update).toHaveBeenCalledWith({ last_used_at: NOW.toISOString() });
      expect(mock.updateEq).toHaveBeenCalledWith('id', 'key-id-9');
      expect(mock.updateOr).toHaveBeenCalledWith('last_used_at.is.null,last_used_at.lt.2026-11-23T11:00:00.000Z');
      expect(warnMock).not.toHaveBeenCalled();
    });

    it('writes when the key was never used', async () => {
      const mock = touchMock(null);
      await resolveApiKey(RAW_KEY, mock.supabase);
      expect(mock.update).toHaveBeenCalledWith({ last_used_at: NOW.toISOString() });
      expect(mock.updateOr).toHaveBeenCalledWith('last_used_at.is.null,last_used_at.lt.2026-11-23T11:00:00.000Z');
    });

    it('writes when the stored last_used_at is unparseable', async () => {
      const mock = touchMock('not-a-date');
      await resolveApiKey(RAW_KEY, mock.supabase);
      expect(mock.update).toHaveBeenCalledTimes(1);
    });

    it('logs a failed write and still resolves the key', async () => {
      const mock = touchMock(null, { code: '57014', message: 'canceling statement due to statement timeout' });
      const resolved = await resolveApiKey(RAW_KEY, mock.supabase);
      expect(resolved).toEqual({ userId: 'user-id-abc', keyId: 'key-id-9', personaIds: null, approvalMode: 'yolo' });
      expect(warnMock).toHaveBeenCalledWith('[api-keys] last_used_at touch failed', {
        keyId: 'key-id-9',
        code: '57014',
        message: 'canceling statement due to statement timeout',
      });
    });
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
