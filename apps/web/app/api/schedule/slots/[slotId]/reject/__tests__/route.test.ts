// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

vi.mock('@/lib/request-auth', () => ({
  requireSupabaseSession: vi.fn(),
}));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(() => 'log-id'), warn: vi.fn(() => 'log-id'), info: vi.fn(() => 'log-id') },
}));
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
}));
vi.mock('@/lib/supabase/service', () => ({
  createSupabaseServiceClient: vi.fn(),
}));
vi.mock('@/lib/rate-limit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/rate-limit')>();
  return { ...actual, applyRateLimit: vi.fn().mockResolvedValue(null) };
});

import { POST } from '../route';
import { requireSupabaseSession } from '@/lib/request-auth';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';

const USER_ID = 'user-1';
const SLOT_ID = '872827cb-6345-45b8-8153-60924092a648';

interface ChainCall {
  table: string;
  op: string;
  args: unknown[];
}

function mockClient(options: {
  slot?: unknown;
  schedule?: unknown;
  updateConflict?: boolean;
  updateError?: unknown;
}) {
  const calls: ChainCall[] = [];
  const makeChain = (table: string) => {
    const chain: Record<string, unknown> = {};
    const track = (op: string) =>
      vi.fn((...args: unknown[]) => {
        calls.push({ table, op, args });
        return chain;
      });
    Object.assign(chain, {
      select: track('select'),
      eq: track('eq'),
      in: track('in'),
      update: track('update'),
      single: vi.fn(async () => {
        const sawUpdate = calls.some((c) => c.table === table && c.op === 'update');
        if (sawUpdate) {
          if (options.updateError) return { data: null, error: options.updateError };
          if (options.updateConflict) return { data: null, error: { code: 'PGRST116' } };
          return { data: { id: 'slot-1' }, error: null };
        }
        return { data: options.slot ?? null, error: options.slot ? null : { code: 'PGRST116' } };
      }),
      maybeSingle: vi.fn(async () => ({ data: options.schedule ?? null, error: null })),
    });
    return chain;
  };
  const postsChain = makeChain('scheduled_posts');
  const schedulesChain = makeChain('schedules');
  const from = vi.fn((table: string) => (table === 'schedules' ? schedulesChain : postsChain));
  return { from, postsChain, schedulesChain, calls };
}

function mockSession() {
  vi.mocked(requireSupabaseSession).mockResolvedValue({
    auth: { userId: USER_ID, accessToken: 'jwt' },
    error: null,
  } as never);
}

function mockApiKey() {
  vi.mocked(requireSupabaseSession).mockResolvedValue({
    auth: { userId: USER_ID, accessToken: 'pe_test_key', isApiKey: true },
    error: null,
  } as never);
}

function mockOAuth() {
  vi.mocked(requireSupabaseSession).mockResolvedValue({
    auth: { userId: USER_ID, accessToken: 'oauth-token', isOAuth: true },
    error: null,
  } as never);
}

function mockOwnedClients(options: {
  slot?: unknown;
  schedule?: unknown;
  updateConflict?: boolean;
  updateError?: unknown;
}) {
  const sessionClient = mockClient(options);
  const serviceClient = mockClient(options);
  vi.mocked(createSupabaseServerClient).mockResolvedValue(sessionClient as never);
  vi.mocked(createSupabaseServiceClient).mockReturnValue(serviceClient as never);
  return { sessionClient, serviceClient };
}

async function postReject(slotId: string): Promise<Response> {
  return POST(new Request(`https://example.com/api/schedule/slots/${slotId}/reject`, { method: 'POST' }), {
    params: Promise.resolve({ slotId }),
  });
}

describe('POST /api/schedule/slots/[slotId]/reject', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects an awaiting_approval slot with a guarded update to cancelled and clears its media', async () => {
    const { serviceClient } = mockOwnedClients({
      slot: { id: 'slot-1', schedule_id: 's1', status: 'awaiting_approval', title: 'T' },
      schedule: { id: 's1', user_id: USER_ID },
    });
    mockSession();

    const response = await postReject(SLOT_ID);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, status: 'cancelled' });
    const updateCall = serviceClient.calls.find((c) => c.op === 'update');
    expect(updateCall?.args?.[0]).toEqual({ status: 'cancelled', media_ref: null });
    const inCall = serviceClient.calls.find((c) => c.op === 'in');
    expect(inCall?.args).toEqual(['status', ['awaiting_approval']]);
    expect(vi.mocked(applyRateLimit)).toHaveBeenCalledWith(expect.any(Request), RATE_LIMITS.slotApprove, USER_ID);
  });

  it('returns 409 for a slot that is not awaiting approval', async () => {
    const { serviceClient } = mockOwnedClients({
      slot: { id: 'slot-1', schedule_id: 's1', status: 'ready', title: 'T' },
      schedule: { id: 's1', user_id: USER_ID },
    });
    mockSession();

    const response = await postReject(SLOT_ID);

    expect(response.status).toBe(409);
    expect(serviceClient.calls.some((c) => c.op === 'update')).toBe(false);
  });

  it('returns 409 when the guarded update loses the race', async () => {
    mockOwnedClients({
      slot: { id: 'slot-1', schedule_id: 's1', status: 'awaiting_approval', title: 'T' },
      schedule: { id: 's1', user_id: USER_ID },
      updateConflict: true,
    });
    mockSession();

    const response = await postReject(SLOT_ID);

    expect(response.status).toBe(409);
  });

  it('returns 403 for an API-key caller without touching the database', async () => {
    const { sessionClient, serviceClient } = mockOwnedClients({
      slot: { id: 'slot-1', schedule_id: 's1', status: 'awaiting_approval', title: 'T' },
      schedule: { id: 's1', user_id: USER_ID },
    });
    mockApiKey();

    const response = await postReject(SLOT_ID);

    expect(response.status).toBe(403);
    expect(sessionClient.from).not.toHaveBeenCalled();
    expect(serviceClient.from).not.toHaveBeenCalled();
  });

  it('returns 403 for an OAuth caller', async () => {
    mockOwnedClients({
      slot: { id: 'slot-1', schedule_id: 's1', status: 'awaiting_approval', title: 'T' },
      schedule: { id: 's1', user_id: USER_ID },
    });
    mockOAuth();

    const response = await postReject(SLOT_ID);

    expect(response.status).toBe(403);
  });

  it('returns 401 when authentication fails', async () => {
    const authError = NextResponse.json(
      { success: false, error: 'Authentication required.' },
      { status: 401 },
    );
    vi.mocked(requireSupabaseSession).mockResolvedValue({ auth: null, error: authError } as never);

    const response = await postReject(SLOT_ID);

    expect(response.status).toBe(401);
  });

  it('returns 404 for a non-UUID slot id without touching the database', async () => {
    const { sessionClient, serviceClient } = mockOwnedClients({
      slot: { id: 'slot-1', schedule_id: 's1', status: 'awaiting_approval', title: 'T' },
      schedule: { id: 's1', user_id: USER_ID },
    });
    mockSession();

    const response = await postReject('not-a-uuid');

    expect(response.status).toBe(404);
    expect(sessionClient.from).not.toHaveBeenCalled();
    expect(serviceClient.from).not.toHaveBeenCalled();
  });

  it('returns 404 when the slot belongs to another user', async () => {
    const { serviceClient } = mockOwnedClients({
      slot: { id: 'slot-1', schedule_id: 's1', status: 'awaiting_approval', title: 'T' },
      schedule: { id: 's1', user_id: 'someone-else' },
    });
    mockSession();

    const response = await postReject(SLOT_ID);

    expect(response.status).toBe(404);
    expect(serviceClient.calls.some((c) => c.op === 'update')).toBe(false);
  });

  it('returns 429 when the slotApprove budget is spent', async () => {
    mockOwnedClients({
      slot: { id: 'slot-1', schedule_id: 's1', status: 'awaiting_approval', title: 'T' },
      schedule: { id: 's1', user_id: USER_ID },
    });
    mockSession();
    vi.mocked(applyRateLimit).mockResolvedValueOnce(
      NextResponse.json({ success: false, error: 'Too many requests.' }, { status: 429 }) as never,
    );

    const response = await postReject(SLOT_ID);

    expect(response.status).toBe(429);
  });

  it('returns 500 when the guarded update hits a database error', async () => {
    mockOwnedClients({
      slot: { id: 'slot-1', schedule_id: 's1', status: 'awaiting_approval', title: 'T' },
      schedule: { id: 's1', user_id: USER_ID },
      updateError: { code: 'XX000', message: 'connection reset' },
    });
    mockSession();

    const response = await postReject(SLOT_ID);

    expect(response.status).toBe(500);
  });
});
