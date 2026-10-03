//---------------
// Tests for /api/admin/refund-reviews (GET list, POST approve/reject).
//
// Auth (session + admin allowlist) and the service client are mocked
// boundaries; the approve->refund wiring and state transitions are real.
//---------------

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/request-auth', () => ({ requireSupabaseSession: vi.fn() }));

vi.mock('@/lib/supabase/service', () => ({ createSupabaseServiceClient: vi.fn() }));

vi.mock('@/lib/posthog-server', () => ({ getPostHogServer: vi.fn() }));

import { GET, POST } from '../refund-reviews/route';
import { requireSupabaseSession } from '@/lib/request-auth';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { getPostHogServer } from '@/lib/posthog-server';
import { REVIEW_APPROVE_REFUND_REASON } from '@/lib/billing/reconcile';

const captureAs = vi.fn();
const mockSession = vi.mocked(requireSupabaseSession);
const mockServiceClient = vi.mocked(createSupabaseServiceClient);

const ADMIN_ID = 'admin-user-uuid';
const REVIEW = {
  id: '11111111-1111-4111-8111-111111111111',
  user_id: 'user-uuid-1',
  kind: 'stuck_generation',
  ref_id: 'gen-stuck-1',
  tokens: 2,
  evidence: { engine_outcome: 'alive' },
  status: 'pending',
  note: null,
  created_at: new Date().toISOString(),
  decided_at: null,
};

interface DbConfig {
  reviews?: Array<Record<string, unknown>>;
  rpcRefunded?: boolean;
  rpcError?: boolean;
}

const calls = {
  rpcs: [] as Array<{ name: string; args: Record<string, unknown> }>,
  updates: [] as Array<{ table: string; fields: Record<string, unknown> }>,
};

function makeClient(cfg: DbConfig): unknown {
  const table = (name: string): unknown => {
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      order: () => builder,
      limit: () => Promise.resolve({ data: cfg.reviews ?? [], error: null }),
      maybeSingle: () => Promise.resolve({ data: cfg.reviews?.[0] ?? null, error: null }),
      update: (fields: Record<string, unknown>) => {
        calls.updates.push({ table: name, fields });
        return { eq: () => Promise.resolve({ data: null, error: null }) };
      },
    };
    return builder;
  };
  return {
    from: (name: string) => table(name),
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.rpcs.push({ name, args });
      if (name === 'refund_generation_tokens') {
        if (cfg.rpcError) return { data: null, error: { message: 'db down' } };
        return { data: { refunded: cfg.rpcRefunded ?? true }, error: null };
      }
      return { data: null, error: null };
    },
  };
}

function authedAs(userId: string | null) {
  if (userId === null) {
    mockSession.mockResolvedValue({
      auth: null,
      error: new Response('Unauthorized', { status: 401 }) as never,
    });
  } else {
    mockSession.mockResolvedValue({
      auth: { userId, accessToken: 'tok' },
      error: null,
    });
  }
}

function postRequest(body: unknown): Request {
  return new Request('https://app.example/api/admin/refund-reviews', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  calls.rpcs.length = 0;
  calls.updates.length = 0;
  process.env.ADMIN_USER_IDS = ADMIN_ID;
  vi.mocked(getPostHogServer).mockReturnValue({
    capture: vi.fn(),
    captureAs,
    captureException: vi.fn(),
  });
  mockServiceClient.mockReturnValue(makeClient({}) as never);
});

describe('GET /api/admin/refund-reviews', () => {
  it('lists pending reviews for an admin', async () => {
    authedAs(ADMIN_ID);
    mockServiceClient.mockReturnValue(makeClient({ reviews: [REVIEW] }) as never);

    const response = await GET(new Request('https://app.example/api/admin/refund-reviews'));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { success: boolean; reviews: unknown[] };
    expect(body.success).toBe(true);
    expect(body.reviews).toHaveLength(1);
  });

  it('returns 403 for a non-admin user', async () => {
    authedAs('some-other-user');
    const response = await GET(new Request('https://app.example/api/admin/refund-reviews'));
    expect(response.status).toBe(403);
  });

  it('returns 401 without a session', async () => {
    authedAs(null);
    const response = await GET(new Request('https://app.example/api/admin/refund-reviews'));
    expect(response.status).toBe(401);
  });

  it('returns 400 for an invalid status filter', async () => {
    authedAs(ADMIN_ID);
    const response = await GET(
      new Request('https://app.example/api/admin/refund-reviews?status=bogus'),
    );
    expect(response.status).toBe(400);
  });
});

describe('POST /api/admin/refund-reviews', () => {
  it('approve calls the refund RPC and marks the review approved', async () => {
    authedAs(ADMIN_ID);
    mockServiceClient.mockReturnValue(makeClient({ reviews: [REVIEW] }) as never);

    const response = await POST(postRequest({ id: REVIEW.id, decision: 'approve' }));

    expect(response.status).toBe(200);
    expect(calls.rpcs).toEqual([
      {
        name: 'refund_generation_tokens',
        args: {
          p_user_id: REVIEW.user_id,
          p_generation_id: REVIEW.ref_id,
          p_reason: REVIEW_APPROVE_REFUND_REASON,
        },
      },
    ]);
    expect(calls.updates).toHaveLength(1);
    expect(calls.updates[0].fields).toMatchObject({ status: 'approved' });
    expect(calls.updates[0].fields.decided_at).toBeTruthy();
    expect(captureAs).toHaveBeenCalledWith(
      REVIEW.user_id,
      'refund_issued',
      expect.objectContaining({ reason: REVIEW_APPROVE_REFUND_REASON }),
    );
  });

  it('approve marks approved without a second PostHog event when the RPC no-ops (already settled)', async () => {
    authedAs(ADMIN_ID);
    mockServiceClient.mockReturnValue(
      makeClient({ reviews: [REVIEW], rpcRefunded: false }) as never,
    );

    const response = await POST(postRequest({ id: REVIEW.id, decision: 'approve' }));

    expect(response.status).toBe(200);
    expect(calls.updates[0].fields).toMatchObject({ status: 'approved' });
    expect(captureAs).not.toHaveBeenCalledWith(
      REVIEW.user_id,
      'refund_issued',
      expect.anything(),
    );
  });

  it('approve leaves the review pending when the refund RPC errors', async () => {
    authedAs(ADMIN_ID);
    mockServiceClient.mockReturnValue(
      makeClient({ reviews: [REVIEW], rpcError: true }) as never,
    );

    const response = await POST(postRequest({ id: REVIEW.id, decision: 'approve' }));

    expect(response.status).toBe(500);
    expect(calls.updates).toHaveLength(0);
  });

  it('reject marks the review rejected with the note and never refunds', async () => {
    authedAs(ADMIN_ID);
    mockServiceClient.mockReturnValue(makeClient({ reviews: [REVIEW] }) as never);

    const response = await POST(
      postRequest({ id: REVIEW.id, decision: 'reject', note: 'video was delivered' }),
    );

    expect(response.status).toBe(200);
    expect(calls.rpcs).toHaveLength(0);
    expect(calls.updates[0].fields).toMatchObject({
      status: 'rejected',
      note: 'video was delivered',
    });
    expect(captureAs).not.toHaveBeenCalled();
  });

  it('returns 409 for an already-decided review', async () => {
    authedAs(ADMIN_ID);
    mockServiceClient.mockReturnValue(
      makeClient({ reviews: [{ ...REVIEW, status: 'approved' }] }) as never,
    );

    const response = await POST(postRequest({ id: REVIEW.id, decision: 'approve' }));

    expect(response.status).toBe(409);
    expect(calls.rpcs).toHaveLength(0);
    expect(calls.updates).toHaveLength(0);
  });

  it('returns 404 for an unknown review id', async () => {
    authedAs(ADMIN_ID);
    mockServiceClient.mockReturnValue(makeClient({ reviews: [] }) as never);

    const response = await POST(
      postRequest({ id: '99999999-9999-4999-8999-999999999999', decision: 'approve' }),
    );

    expect(response.status).toBe(404);
  });

  it('returns 400 for an invalid decision', async () => {
    authedAs(ADMIN_ID);
    const response = await POST(postRequest({ id: REVIEW.id, decision: 'maybe' }));
    expect(response.status).toBe(400);
  });

  it('returns 403 for a non-admin user', async () => {
    authedAs('some-other-user');
    const response = await POST(postRequest({ id: REVIEW.id, decision: 'approve' }));
    expect(response.status).toBe(403);
    expect(calls.rpcs).toHaveLength(0);
  });
});
