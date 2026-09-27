import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('@/lib/tokens', () => ({
  computeVideoTokens: vi.fn().mockReturnValue(2),
  toFiniteNumber: (value: unknown, fallback = 0): number => {
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? n : fallback;
  },
}));

import { checkAndDeductTokens, refundTokens } from '@/lib/billing/token-check';
import { computeVideoTokens } from '@/lib/tokens';

type RpcResponse = { data: unknown; error: unknown };

function createMockSupabase(responses: Record<string, RpcResponse>) {
  const rpc = vi.fn((fn: string) => Promise.resolve(responses[fn] ?? { data: null, error: null }));
  return {
    client: { rpc } as unknown as SupabaseClient,
    rpc,
  };
}

describe('token wallet operations', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uses the atomic spend RPC and returns the server cost', async () => {
    const mock = createMockSupabase({
      grant_signup_bonus: { data: { granted: true, free_balance: 3 }, error: null },
      spend_tokens: { data: { spent: true, balance: 1, free_balance: 0 }, error: null },
    });
    const result = await checkAndDeductTokens(mock.client, 'user-1', 'generation-1', 50, 'ok');

    expect(result).toEqual({ ok: true, cost: 2 });
    expect(computeVideoTokens).toHaveBeenCalledWith(50, 'ok');
    expect(mock.rpc).toHaveBeenCalledWith('spend_tokens', expect.objectContaining({
      p_user_id: 'user-1',
      p_generation_id: 'generation-1',
      p_amount: 2,
    }));
  });

  it('rejects insufficient balance from the atomic RPC', async () => {
    const mock = createMockSupabase({
      grant_signup_bonus: { data: { granted: true, free_balance: 3 }, error: null },
      spend_tokens: { data: { spent: false, balance: 1, free_balance: 1 }, error: null },
    });
    const result = await checkAndDeductTokens(mock.client, 'user-1', 'generation-1', 0, 'ok');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('INSUFFICIENT_TOKENS');
      expect(result.freeExhausted).toBe(false);
    }
  });

  it('requests an idempotent refund by generation ID', async () => {
    const mock = createMockSupabase({
      refund_generation_tokens: { data: { refunded: true }, error: null },
    });
    await expect(refundTokens(mock.client, 'user-1', 'generation-1')).resolves.toBe(true);
    expect(mock.rpc).toHaveBeenCalledWith('refund_generation_tokens', expect.objectContaining({
      p_user_id: 'user-1',
      p_generation_id: 'generation-1',
    }));
  });
});

describe('free starter tokens', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls the one-time lazy grant before spending', async () => {
    const mock = createMockSupabase({
      grant_signup_bonus: { data: { granted: true, free_balance: 3 }, error: null },
      spend_tokens: { data: { spent: true, balance: 1, free_balance: 1 }, error: null },
    });

    await checkAndDeductTokens(mock.client, 'user-1', 'generation-1', 0, 'ok');

    expect(mock.rpc).toHaveBeenCalledWith('grant_signup_bonus', { p_user_id: 'user-1' });
    const [grantCall, spendCall] = mock.rpc.mock.calls.map((call) => call[0]);
    expect(grantCall).toBe('grant_signup_bonus');
    expect(spendCall).toBe('spend_tokens');
  });

  it('flags freeExhausted only when the grant ran and free balance hit zero', async () => {
    const mock = createMockSupabase({
      grant_signup_bonus: { data: { already: true, free_balance: 0 }, error: null },
      spend_tokens: { data: { spent: false, balance: 0, free_balance: 0 }, error: null },
    });

    const result = await checkAndDeductTokens(mock.client, 'user-1', 'generation-1', 0, 'ok');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.freeExhausted).toBe(true);
      expect(result.statusCode).toBe(402);
      expect(result.error).toContain('INSUFFICIENT_TOKENS_FREE_EXHAUSTED');
    }
  });

  it('does NOT flag freeExhausted when free tokens remain', async () => {
    const mock = createMockSupabase({
      grant_signup_bonus: { data: { already: true, free_balance: 2 }, error: null },
      spend_tokens: { data: { spent: false, balance: 2, free_balance: 2 }, error: null },
    });

    const result = await checkAndDeductTokens(mock.client, 'user-1', 'generation-1', 0, 'ok');

    if (!result.ok) expect(result.freeExhausted).toBe(false);
  });

  it('does NOT flag freeExhausted when the grant never ran (no free tokens at all)', async () => {
    const mock = createMockSupabase({
      grant_signup_bonus: { data: null, error: { message: 'rpc missing' } },
      spend_tokens: { data: { spent: false, balance: 0, free_balance: 0 }, error: null },
    });

    const result = await checkAndDeductTokens(mock.client, 'user-1', 'generation-1', 0, 'ok');

    if (!result.ok) expect(result.freeExhausted).toBe(false);
  });

  it('survives a grant RPC crash and still spends normally', async () => {
    const mock = createMockSupabase({
      grant_signup_bonus: { data: null, error: null },
      spend_tokens: { data: { spent: true, balance: 5, free_balance: 0 }, error: null },
    });
    // grant throws ( network/bug ) — the flow must not break
    mock.rpc.mockImplementation((fn: string) => {
      if (fn === 'grant_signup_bonus') return Promise.reject(new Error('boom'));
      return Promise.resolve({ data: { spent: true, balance: 5, free_balance: 0 }, error: null });
    });

    await expect(
      checkAndDeductTokens(mock.client, 'user-1', 'generation-1', 0, 'ok'),
    ).resolves.toEqual({ ok: true, cost: 2 });
  });

  it('still spends when free balance is zero but paid covers the cost', async () => {
    const mock = createMockSupabase({
      grant_signup_bonus: { data: { already: true, free_balance: 0 }, error: null },
      spend_tokens: { data: { spent: true, balance: 8, free_balance: 0 }, error: null },
    });

    await expect(
      checkAndDeductTokens(mock.client, 'user-1', 'generation-1', 0, 'ok'),
    ).resolves.toEqual({ ok: true, cost: 2 });
  });
});
