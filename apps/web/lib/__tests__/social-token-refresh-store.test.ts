import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.gen';

vi.mock('@/lib/token-crypto', () => ({
  encryptTokens: vi.fn((payload: unknown) => `encrypted.${JSON.stringify(payload)}`),
  decryptTokens: vi.fn((encrypted: string) => {
    if (!encrypted.startsWith('encrypted.')) throw new Error('Invalid encrypted token format or version');
    return JSON.parse(encrypted.replace('encrypted.', ''));
  }),
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn() },
}));

import { createTokenRefreshStore } from '@/lib/social-token-refresh-store';
import { logger } from '@/lib/logger';
import type { TokenRefreshCandidate } from '@/lib/social-token-refresh';

interface Calls {
  [method: string]: unknown[][];
}

function builder(result: { data: unknown; error: unknown }) {
  const calls: Calls = {};
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'in', 'gt', 'lt', 'order', 'limit', 'update', 'eq']) {
    chain[method] = (...args: unknown[]) => {
      (calls[method] ??= []).push(args);
      return chain;
    };
  }
  chain.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return { chain, calls };
}

function client(chain: Record<string, unknown>) {
  const from = vi.fn(() => chain);
  return { supabase: { from } as unknown as SupabaseClient<Database>, from };
}

const after = new Date('2026-11-17T12:00:00Z');
const before = new Date('2026-11-27T12:00:00Z');

const row = {
  id: 'row-1',
  user_id: 'u1',
  provider: 'instagram',
  provider_account_id: 'ig-1',
  encrypted_tokens: `encrypted.${JSON.stringify({ access_token: 'tok', expiry_date: 1 })}`,
  updated_at: '2026-09-18T12:00:00.123456+00:00',
};

beforeEach(() => {
  vi.mocked(logger.error).mockClear();
});

describe('createTokenRefreshStore.listExpiring', () => {
  it('reads only the given providers with a token expiring inside the window, soonest first', async () => {
    const { chain, calls } = builder({ data: [row], error: null });
    const { supabase, from } = client(chain);

    const result = await createTokenRefreshStore(supabase).listExpiring(['instagram', 'threads'], after, before, 51);

    expect(from).toHaveBeenCalledWith('social_accounts');
    expect(calls.in).toEqual([['provider', ['instagram', 'threads']]]);
    expect(calls.gt).toEqual([['token_expires_at', after.toISOString()]]);
    expect(calls.lt).toEqual([['token_expires_at', before.toISOString()]]);
    expect(calls.order).toEqual([
      ['token_expires_at', { ascending: true }],
      ['id', { ascending: true }],
    ]);
    expect(calls.limit).toEqual([[51]]);
    expect(result).toEqual([
      {
        id: 'row-1',
        userId: 'u1',
        provider: 'instagram',
        providerAccountId: 'ig-1',
        tokens: { access_token: 'tok', expiry_date: 1 },
        updatedAt: row.updated_at,
      },
    ]);
  });

  it('skips and logs a row whose token cannot be decrypted, keeping the others', async () => {
    const broken = { ...row, id: 'row-0', provider_account_id: 'ig-0', encrypted_tokens: 'garbage' };
    const { chain } = builder({ data: [broken, row], error: null });
    const { supabase } = client(chain);

    const result = await createTokenRefreshStore(supabase).listExpiring(['instagram'], after, before, 51);

    expect(result.map((c) => c.id)).toEqual(['row-1']);
    expect(logger.error).toHaveBeenCalledWith(
      '[token-refresh] stored token could not be decrypted',
      expect.any(Error),
      { provider: 'instagram', accountId: 'ig-0' },
    );
  });

  it('drops a row of a provider outside the requested list', async () => {
    const { chain } = builder({ data: [{ ...row, provider: 'youtube' }], error: null });
    const { supabase } = client(chain);

    const result = await createTokenRefreshStore(supabase).listExpiring(['instagram'], after, before, 51);

    expect(result).toEqual([]);
  });

  it('returns no candidates when the query answers null data', async () => {
    const { chain } = builder({ data: null, error: null });
    const { supabase } = client(chain);

    await expect(
      createTokenRefreshStore(supabase).listExpiring(['instagram'], after, before, 51),
    ).resolves.toEqual([]);
  });

  it('throws on a query error instead of reporting nothing due', async () => {
    const { chain } = builder({ data: null, error: { message: 'boom' } });
    const { supabase } = client(chain);

    await expect(
      createTokenRefreshStore(supabase).listExpiring(['instagram'], after, before, 51),
    ).rejects.toThrow('Failed to list expiring social tokens: boom');
  });
});

describe('createTokenRefreshStore.saveRefreshed', () => {
  const candidate: TokenRefreshCandidate = {
    id: 'row-1',
    userId: 'u1',
    provider: 'instagram',
    providerAccountId: 'ig-1',
    tokens: { access_token: 'tok' },
    updatedAt: row.updated_at,
  };
  const expiresAt = new Date('2027-01-16T12:00:00Z');

  it('writes the encrypted token and expiry only to the exact row it read', async () => {
    const { chain, calls } = builder({ data: [{ id: 'row-1' }], error: null });
    const { supabase } = client(chain);

    const result = await createTokenRefreshStore(supabase).saveRefreshed(
      candidate,
      { access_token: 'new', expiry_date: expiresAt.getTime() },
      expiresAt,
    );

    expect(result).toBe('saved');
    const [update] = calls.update[0] as [Record<string, unknown>];
    expect(update.encrypted_tokens).toBe(`encrypted.${JSON.stringify({ access_token: 'new', expiry_date: expiresAt.getTime() })}`);
    expect(update.token_expires_at).toBe(expiresAt.toISOString());
    expect(typeof update.updated_at).toBe('string');
    expect(calls.eq).toEqual([
      ['id', 'row-1'],
      ['user_id', 'u1'],
      ['updated_at', row.updated_at],
    ]);
    expect(calls.select).toEqual([['id']]);
  });

  it('returns row_changed when the row was reconnected or deleted during the run', async () => {
    const { chain } = builder({ data: [], error: null });
    const { supabase } = client(chain);

    const result = await createTokenRefreshStore(supabase).saveRefreshed(candidate, { access_token: 'new' }, expiresAt);

    expect(result).toBe('row_changed');
  });

  it('returns row_changed when the update answers null data', async () => {
    const { chain } = builder({ data: null, error: null });
    const { supabase } = client(chain);

    const result = await createTokenRefreshStore(supabase).saveRefreshed(candidate, { access_token: 'new' }, expiresAt);

    expect(result).toBe('row_changed');
  });

  it('throws on an update error', async () => {
    const { chain } = builder({ data: null, error: { message: 'denied' } });
    const { supabase } = client(chain);

    await expect(
      createTokenRefreshStore(supabase).saveRefreshed(candidate, { access_token: 'new' }, expiresAt),
    ).rejects.toThrow('Failed to save refreshed social token: denied');
  });
});
