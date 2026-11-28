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

const mockPublishHeldSlot = vi.hoisted(() =>
  vi.fn(
    async (_options: { request: Request; serviceClient: unknown; userId: string; slot: unknown; route: string }) =>
      NextResponse.json({ success: true, status: 'published', publishes: [] }),
  ),
);
vi.mock('../publish-held', () => ({ publishHeldSlot: mockPublishHeldSlot }));
vi.mock('@/lib/access', () => ({ assertAccessActive: vi.fn(async () => null) }));
const mockUpdateUpload = vi.hoisted(() => vi.fn(async () => true));
vi.mock('@/lib/videos/signed-upload', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/videos/signed-upload')>();
  return { ...actual, createSupabaseVideoUploadStore: () => ({ updateUpload: mockUpdateUpload }) };
});

import { POST } from '../route';
import { assertAccessActive } from '@/lib/access';
import { requireSupabaseSession } from '@/lib/request-auth';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';

const USER_ID = 'user-1';
const SLOT_ID = '872827cb-6345-45b8-8153-60924092a648';
const SCHEDULED_UPLOAD_EXPIRY_MS = 24 * 60 * 60 * 1000;

const futureSlotAt = () => new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
const awaitingSlot = {
  id: 'slot-1',
  schedule_id: 's1',
  status: 'awaiting_approval',
  title: 'T',
  slot_at: futureSlotAt(),
  media_ref: 'upload-1',
  media_kind: 'upload',
};

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

async function postApprove(slotId: string): Promise<Response> {
  return POST(new Request(`https://example.com/api/schedule/slots/${slotId}/approve`, { method: 'POST' }), {
    params: Promise.resolve({ slotId }),
  });
}

describe('POST /api/schedule/slots/[slotId]/approve', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('approves an awaiting_approval slot with a guarded update to ready', async () => {
    const { serviceClient } = mockOwnedClients({
      slot: awaitingSlot,
      schedule: { id: 's1', user_id: USER_ID },
    });
    mockSession();

    const response = await postApprove(SLOT_ID);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, status: 'ready' });
    const updateCall = serviceClient.calls.find((c) => c.op === 'update');
    expect(updateCall?.args?.[0]).toEqual({ status: 'ready' });
    const inCall = serviceClient.calls.find((c) => c.op === 'in');
    expect(inCall?.args).toEqual(['status', ['awaiting_approval']]);
    expect(vi.mocked(applyRateLimit)).toHaveBeenCalledWith(expect.any(Request), RATE_LIMITS.slotApprove, USER_ID);
  });

  it('returns 409 for a slot that is not awaiting approval', async () => {
    const { serviceClient } = mockOwnedClients({
      slot: { ...awaitingSlot, status: 'ready' },
      schedule: { id: 's1', user_id: USER_ID },
    });
    mockSession();

    const response = await postApprove(SLOT_ID);

    expect(response.status).toBe(409);
    expect(serviceClient.calls.some((c) => c.op === 'update')).toBe(false);
    const body = (await response.json()) as { code?: string };
    expect(body.code).toBe('SLOT_NOT_AWAITING_APPROVAL');
  });

  it('returns 409 when the guarded update loses the race', async () => {
    mockOwnedClients({
      slot: awaitingSlot,
      schedule: { id: 's1', user_id: USER_ID },
      updateConflict: true,
    });
    mockSession();

    const response = await postApprove(SLOT_ID);

    expect(response.status).toBe(409);
    const raceBody = (await response.json()) as { code?: string };
    expect(raceBody.code).toBe('SLOT_NOT_AWAITING_APPROVAL');
  });

  it('returns 403 for an API-key caller without touching the database', async () => {
    const { sessionClient, serviceClient } = mockOwnedClients({
      slot: awaitingSlot,
      schedule: { id: 's1', user_id: USER_ID },
    });
    mockApiKey();

    const response = await postApprove(SLOT_ID);

    expect(response.status).toBe(403);
    expect(sessionClient.from).not.toHaveBeenCalled();
    expect(serviceClient.from).not.toHaveBeenCalled();
  });

  it('returns 403 for an OAuth caller', async () => {
    mockOwnedClients({
      slot: awaitingSlot,
      schedule: { id: 's1', user_id: USER_ID },
    });
    mockOAuth();

    const response = await postApprove(SLOT_ID);

    expect(response.status).toBe(403);
  });

  it('returns 401 when authentication fails', async () => {
    const authError = NextResponse.json(
      { success: false, error: 'Authentication required.' },
      { status: 401 },
    );
    vi.mocked(requireSupabaseSession).mockResolvedValue({ auth: null, error: authError } as never);

    const response = await postApprove(SLOT_ID);

    expect(response.status).toBe(401);
  });

  it('returns 404 for a non-UUID slot id without touching the database', async () => {
    const { sessionClient, serviceClient } = mockOwnedClients({
      slot: awaitingSlot,
      schedule: { id: 's1', user_id: USER_ID },
    });
    mockSession();

    const response = await postApprove('not-a-uuid');

    expect(response.status).toBe(404);
    expect(sessionClient.from).not.toHaveBeenCalled();
    expect(serviceClient.from).not.toHaveBeenCalled();
  });

  it('returns 404 when the slot belongs to another user', async () => {
    const { serviceClient } = mockOwnedClients({
      slot: awaitingSlot,
      schedule: { id: 's1', user_id: 'someone-else' },
    });
    mockSession();

    const response = await postApprove(SLOT_ID);

    expect(response.status).toBe(404);
    expect(serviceClient.calls.some((c) => c.op === 'update')).toBe(false);
  });

  it('returns 429 when the slotApprove budget is spent', async () => {
    mockOwnedClients({
      slot: awaitingSlot,
      schedule: { id: 's1', user_id: USER_ID },
    });
    mockSession();
    vi.mocked(applyRateLimit).mockResolvedValueOnce(
      NextResponse.json({ success: false, error: 'Too many requests.' }, { status: 429 }) as never,
    );

    const response = await postApprove(SLOT_ID);

    expect(response.status).toBe(429);
  });

  it('answers 402 and neither moves the slot nor touches its media once access has ended', async () => {
    const { serviceClient } = mockOwnedClients({
      slot: awaitingSlot,
      schedule: { id: 's1', user_id: USER_ID },
    });
    mockSession();
    vi.mocked(assertAccessActive).mockResolvedValueOnce(
      NextResponse.json({ success: false, code: 'BETA_ACCESS_REQUIRED' }, { status: 402 }) as never,
    );

    const response = await postApprove(SLOT_ID);

    expect(response.status).toBe(402);
    const body = (await response.json()) as { code?: string };
    expect(body.code).toBe('BETA_ACCESS_REQUIRED');
    expect(vi.mocked(assertAccessActive)).toHaveBeenCalledWith(USER_ID, {
      route: 'POST /api/schedule/slots/[slotId]/approve',
    });
    expect(serviceClient.calls.some((c) => c.op === 'update')).toBe(false);
    expect(mockUpdateUpload).not.toHaveBeenCalled();
  });

  it('returns 500 when the access lookup fails', async () => {
    const { serviceClient } = mockOwnedClients({
      slot: awaitingSlot,
      schedule: { id: 's1', user_id: USER_ID },
    });
    mockSession();
    vi.mocked(assertAccessActive).mockResolvedValueOnce(
      NextResponse.json({ success: false, code: 'INTERNAL_ERROR' }, { status: 500 }) as never,
    );

    const response = await postApprove(SLOT_ID);

    expect(response.status).toBe(500);
    expect(serviceClient.calls.some((c) => c.op === 'update')).toBe(false);
  });

  it('returns 409 slot_expired for a scheduled slot past the 5-minute grace', async () => {
    const { serviceClient } = mockOwnedClients({
      slot: { ...awaitingSlot, slot_at: new Date(Date.now() - 10 * 60 * 1000).toISOString() },
      schedule: { id: 's1', user_id: USER_ID },
    });
    mockSession();

    const response = await postApprove(SLOT_ID);

    expect(response.status).toBe(409);
    const body = (await response.json()) as { code?: string };
    expect(body.code).toBe('SLOT_EXPIRED');
    expect(serviceClient.calls.some((c) => c.op === 'update')).toBe(false);
    expect(mockUpdateUpload).not.toHaveBeenCalled();
  });

  it('approves a scheduled slot inside the 5-minute grace', async () => {
    mockOwnedClients({
      slot: { ...awaitingSlot, slot_at: new Date(Date.now() - 4 * 60 * 1000).toISOString() },
      schedule: { id: 's1', user_id: USER_ID },
    });
    mockSession();

    const response = await postApprove(SLOT_ID);

    expect(response.status).toBe(200);
  });

  it('approves an ASAP holding row past its slot time without the expiry check', async () => {
    const { serviceClient } = mockOwnedClients({
      slot: { ...awaitingSlot, slot_at: new Date(Date.now() - 10 * 60 * 1000).toISOString() },
      schedule: { id: 's1', user_id: USER_ID, publish_mode: 'asap' },
    });
    mockSession();

    const response = await postApprove(SLOT_ID);

    expect(response.status).toBe(200);
    expect(mockPublishHeldSlot).toHaveBeenCalledTimes(1);
    const heldArgs = mockPublishHeldSlot.mock.calls[0]?.[0] as
      | { serviceClient?: unknown; userId?: string; slot?: { id?: string }; route?: string }
      | undefined;
    expect(heldArgs?.serviceClient).toBe(serviceClient);
    expect(heldArgs?.userId).toBe(USER_ID);
    expect(heldArgs?.slot?.id).toBe('slot-1');
    expect(heldArgs?.route).toBe('POST /api/schedule/slots/[slotId]/approve');
    expect(mockUpdateUpload).not.toHaveBeenCalled();
  });

  it('does not publish a scheduled slot through the held path', async () => {
    mockOwnedClients({
      slot: awaitingSlot,
      schedule: { id: 's1', user_id: USER_ID },
    });
    mockSession();

    const response = await postApprove(SLOT_ID);

    expect(response.status).toBe(200);
    expect(mockPublishHeldSlot).not.toHaveBeenCalled();
  });

  it('extends the video upload expiry to the slot time plus 24 hours', async () => {
    const slotAt = futureSlotAt();
    mockOwnedClients({
      slot: { ...awaitingSlot, slot_at: slotAt },
      schedule: { id: 's1', user_id: USER_ID },
    });
    mockSession();

    const response = await postApprove(SLOT_ID);

    expect(response.status).toBe(200);
    expect(mockUpdateUpload).toHaveBeenCalledWith('upload-1', 'ready', {
      expires_at: new Date(Date.parse(slotAt) + SCHEDULED_UPLOAD_EXPIRY_MS).toISOString(),
    });
  });

  it('returns 409 when the video upload is already consumed', async () => {
    const { serviceClient } = mockOwnedClients({
      slot: awaitingSlot,
      schedule: { id: 's1', user_id: USER_ID },
    });
    mockSession();
    mockUpdateUpload.mockResolvedValueOnce(false);

    const response = await postApprove(SLOT_ID);

    expect(response.status).toBe(409);
    const body = (await response.json()) as { code?: string };
    expect(body.code).toBe('VIDEO_UPLOAD_CONSUMED');
    expect(serviceClient.calls.some((c) => c.op === 'update')).toBe(false);
  });

  it('skips the upload extension for an image slot', async () => {
    mockOwnedClients({
      slot: { ...awaitingSlot, media_kind: 'image', media_ref: 'uploads/user-1/image.jpg' },
      schedule: { id: 's1', user_id: USER_ID },
    });
    mockSession();

    const response = await postApprove(SLOT_ID);

    expect(response.status).toBe(200);
    expect(mockUpdateUpload).not.toHaveBeenCalled();
  });

  it('returns 500 when the guarded update hits a database error', async () => {
    mockOwnedClients({
      slot: awaitingSlot,
      schedule: { id: 's1', user_id: USER_ID },
      updateError: { code: 'XX000', message: 'connection reset' },
    });
    mockSession();

    const response = await postApprove(SLOT_ID);

    expect(response.status).toBe(500);
  });
});
