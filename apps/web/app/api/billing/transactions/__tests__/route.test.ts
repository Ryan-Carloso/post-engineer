import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextResponse } from 'next/server';

vi.mock('@/lib/request-auth', () => ({
  requireSupabaseSession: vi.fn(),
}));
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
}));
vi.mock('@/lib/supabase/service', () => ({
  createSupabaseServiceClient: vi.fn(),
}));

//---------------
// Tests for GET /api/billing/transactions — the current user's token
// ledger, newest first, paginated. Auth (session, API key or OAuth)
// is resolved by requireSupabaseSession; the route only picks the
// right Supabase client and scopes every query by user_id.
//---------------

import { GET, parseTransactionsLimit, parseTransactionsOffset } from '../route';
import { requireSupabaseSession } from '@/lib/request-auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';

const USER_ID = 'user-1';

interface TxRow {
  id: string;
  amount: string;
  type: string;
  description: string | null;
  reason: string | null;
  generation_id: string | null;
  created_at: string;
}

function txRows(): TxRow[] {
  return [
    {
      id: 'tx-newest',
      amount: '2',
      type: 'generation_refund',
      description: 'Refund for rejected generation',
      reason: 'engine_rejected',
      generation_id: 'gen-2',
      created_at: '2026-09-24T10:00:00.000Z',
    },
    {
      id: 'tx-oldest',
      amount: '-2',
      type: 'video_generation',
      description: 'Video generation',
      reason: null,
      generation_id: 'gen-1',
      created_at: '2026-09-24T09:00:00.000Z',
    },
  ];
}

function mockAuthSession(auth: unknown, error: unknown): void {
  vi.mocked(requireSupabaseSession).mockResolvedValue({ auth, error } as never);
}

function mockTxClient(rows: TxRow[], total: number): {
  from: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  eqCount: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  range: ReturnType<typeof vi.fn>;
} {
  const range = vi.fn().mockResolvedValue({ data: rows, error: null });
  const order = vi.fn().mockReturnValue({ range });
  const eq = vi.fn().mockReturnValue({ order });
  const eqCount = vi.fn().mockResolvedValue({ count: total, error: null });
  const select = vi.fn().mockImplementation((_cols: string, opts?: { count?: string; head?: boolean }) =>
    opts?.head === true ? { eq: eqCount } : { eq },
  );
  const from = vi.fn().mockReturnValue({ select });
  return { from, select, eq, eqCount, order, range };
}

describe('parseTransactionsLimit', () => {
  it('defaults to 20 when missing or non-numeric', () => {
    expect(parseTransactionsLimit(null)).toBe(20);
    expect(parseTransactionsLimit('abc')).toBe(20);
    expect(parseTransactionsLimit('')).toBe(20);
  });

  it('defaults to 20 for zero or negative values', () => {
    expect(parseTransactionsLimit('0')).toBe(20);
    expect(parseTransactionsLimit('-5')).toBe(20);
  });

  it('clamps values above 100 to the max', () => {
    expect(parseTransactionsLimit('500')).toBe(100);
  });

  it('accepts valid values within range', () => {
    expect(parseTransactionsLimit('10')).toBe(10);
    expect(parseTransactionsLimit('100')).toBe(100);
  });
});

describe('parseTransactionsOffset', () => {
  it('defaults to 0 when missing or non-numeric', () => {
    expect(parseTransactionsOffset(null)).toBe(0);
    expect(parseTransactionsOffset('abc')).toBe(0);
  });

  it('clamps negative values to 0', () => {
    expect(parseTransactionsOffset('-3')).toBe(0);
  });

  it('accepts valid non-negative values', () => {
    expect(parseTransactionsOffset('40')).toBe(40);
  });
});

describe('GET /api/billing/transactions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mockSessionAuth(rows: TxRow[] = txRows(), total = 2): ReturnType<typeof mockTxClient> {
    const tx = mockTxClient(rows, total);
    mockAuthSession({ userId: USER_ID, accessToken: 'sb-token' }, null);
    vi.mocked(createSupabaseServerClient).mockResolvedValue({ from: tx.from } as never);
    return tx;
  }

  it('returns 401 when authentication fails', async () => {
    const authError = NextResponse.json(
      { success: false, error: 'Authentication required.' },
      { status: 401 },
    );
    mockAuthSession(null, authError);

    const res = await GET(new Request('https://example.com/api/billing/transactions'));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ success: false, error: 'Authentication required.' });
    expect(createSupabaseServiceClient).not.toHaveBeenCalled();
    expect(createSupabaseServerClient).not.toHaveBeenCalled();
  });

  it('returns the user transactions newest-first with a clean shape', async () => {
    mockSessionAuth();

    const res = await GET(new Request('https://example.com/api/billing/transactions'));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      transactions: [
        {
          id: 'tx-newest',
          amount: 2,
          type: 'generation_refund',
          description: 'Refund for rejected generation',
          reason: 'engine_rejected',
          generationId: 'gen-2',
          createdAt: '2026-09-24T10:00:00.000Z',
        },
        {
          id: 'tx-oldest',
          amount: -2,
          type: 'video_generation',
          description: 'Video generation',
          reason: null,
          generationId: 'gen-1',
          createdAt: '2026-09-24T09:00:00.000Z',
        },
      ],
      total: 2,
      limit: 20,
      offset: 0,
    });
  });

  it('queries only the current user rows, ordered by created_at desc', async () => {
    const tx = mockSessionAuth();

    await GET(new Request('https://example.com/api/billing/transactions'));

    expect(createSupabaseServerClient).toHaveBeenCalledOnce();
    expect(createSupabaseServiceClient).not.toHaveBeenCalled();
    expect(tx.from).toHaveBeenCalledWith('token_transactions');
    expect(tx.eq).toHaveBeenCalledWith('user_id', USER_ID);
    expect(tx.order).toHaveBeenCalledWith('created_at', { ascending: false });
  });

  it('respects limit and offset query params', async () => {
    const tx = mockSessionAuth();

    const res = await GET(new Request('https://example.com/api/billing/transactions?limit=10&offset=20'));

    expect(tx.range).toHaveBeenCalledWith(20, 29);
    expect(await res.json()).toEqual(expect.objectContaining({ limit: 10, offset: 20 }));
  });

  it('clamps invalid pagination params instead of failing', async () => {
    const tx = mockSessionAuth();

    const res = await GET(new Request('https://example.com/api/billing/transactions?limit=abc&offset=-5'));

    expect(tx.range).toHaveBeenCalledWith(0, 19);
    expect(await res.json()).toEqual(expect.objectContaining({ limit: 20, offset: 0 }));
  });

  it('uses the service client for personal API keys (MCP)', async () => {
    const tx = mockTxClient(txRows(), 2);
    mockAuthSession({ userId: USER_ID, accessToken: 'post-engineer_test123', isApiKey: true }, null);
    vi.mocked(createSupabaseServiceClient).mockReturnValue({ from: tx.from } as never);

    const res = await GET(new Request('https://example.com/api/billing/transactions'));

    expect(createSupabaseServiceClient).toHaveBeenCalledOnce();
    expect(createSupabaseServerClient).not.toHaveBeenCalled();
    expect(tx.eq).toHaveBeenCalledWith('user_id', USER_ID);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(expect.objectContaining({ success: true, total: 2 }));
  });

  it('uses the service client for OAuth tokens (no silent-empty via RLS)', async () => {
    const tx = mockTxClient(txRows(), 2);
    mockAuthSession({ userId: USER_ID, accessToken: 'oauth.jwt.token', isOAuth: true }, null);
    vi.mocked(createSupabaseServiceClient).mockReturnValue({ from: tx.from } as never);

    const res = await GET(new Request('https://example.com/api/billing/transactions'));

    expect(createSupabaseServiceClient).toHaveBeenCalledOnce();
    expect(createSupabaseServerClient).not.toHaveBeenCalled();
    expect(tx.eq).toHaveBeenCalledWith('user_id', USER_ID);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(expect.objectContaining({ success: true, total: 2 }));
  });

  it('returns an empty list when the user has no transactions', async () => {
    mockSessionAuth([], 0);

    const res = await GET(new Request('https://example.com/api/billing/transactions'));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      transactions: [],
      total: 0,
      limit: 20,
      offset: 0,
    });
  });

  it('returns 500 without leaking details when the ledger query fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockAuthSession({ userId: USER_ID, accessToken: 'sb-token' }, null);
    vi.mocked(createSupabaseServerClient).mockResolvedValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            order: () => ({ range: () => Promise.resolve({ data: null, error: new Error('db down') }) }),
          }),
        }),
      }),
    } as never);

    const res = await GET(new Request('https://example.com/api/billing/transactions'));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ success: false, error: 'Could not load token transactions.' });
    errorSpy.mockRestore();
  });
});
