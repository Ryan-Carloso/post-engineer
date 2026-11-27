// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

vi.mock('@/lib/request-auth', () => ({
  requireSupabaseSession: vi.fn(),
  engineAuthHeaders: (userId: string) => ({ 'x-user-id': userId }),
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
vi.mock('@/lib/access', () => ({
  assertAccessActive: vi.fn(async () => null),
}));
vi.mock('@/lib/rate-limit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/rate-limit')>();
  return { ...actual, applyRateLimit: vi.fn().mockResolvedValue(null) };
});

import { DELETE, GET, PATCH } from '../route';
import { DeleteSlotResponseSchema, GetSlotResponseSchema, UpdateSlotResponseSchema } from '@/lib/contracts/schedule';
import { assertAccessActive } from '@/lib/access';
import { requireSupabaseSession } from '@/lib/request-auth';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { createSupabaseServerClient } from '@/lib/supabase/server';

const USER_ID = 'user-1';

const SLOT_ID = '872827cb-6345-45b8-8153-60924092a648';
const BATCH_ID = 'aad196b2-380d-560d-a506-d6ee93c980ae';

interface ChainCall {
  table: string;
  op: string;
  args: unknown[];
}

function mockSlotsClient(options: {
  slot?: unknown;
  schedule?: unknown;
  persona?: unknown;
  personaError?: unknown;
  remaining?: unknown[];
  deleteError?: unknown;
  rpcResult?: string;
  rpcError?: unknown;
  updateConflict?: boolean;
  promptVersion?: unknown;
  promptVersionError?: unknown;
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
      neq: track('neq'),
      in: track('in'),
      single: vi.fn(async () => {
        const sawUpdate = calls.some((c) => c.table === table && c.op === 'update');
        if (sawUpdate && options.updateConflict) {
          return { data: null, error: { code: 'PGRST116' } };
        }
        if (table === 'personas' && options.personaError) {
          return { data: null, error: options.personaError };
        }
        return {
          data: table === 'personas' ? (options.persona ?? null) : (options.slot ?? null),
          error: (table === 'personas' ? options.persona : options.slot) ? null : { code: 'PGRST116' },
        };
      }),
      maybeSingle: vi.fn(async () => ({ data: options.schedule ?? null, error: null })),
      delete: track('delete'),
      update: track('update'),
      limit: vi.fn(async () => ({ data: options.remaining ?? [], error: null })),
    });
    return chain;
  };
  const postsChain = makeChain('scheduled_posts');
  const schedulesChain = makeChain('schedules');
  const personasChain = makeChain('personas');
  const promptVersionsChain = makeChain('prompt_versions');
  (promptVersionsChain as Record<string, unknown>).maybeSingle = vi.fn(async () => ({
    data: options.promptVersionError ? null : (options.promptVersion ?? null),
    error: options.promptVersionError ?? null,
  }));
  const from = vi.fn((table: string) =>
    table === 'prompt_versions'
      ? promptVersionsChain
      : table === 'scheduled_posts'
        ? postsChain
        : table === 'schedules'
          ? schedulesChain
          : personasChain,
  );
  const rpc = vi.fn(async () => ({
    data: options.rpcResult ?? 'deleted',
    error: options.rpcError ?? null,
  }));
  return { from, rpc, postsChain, schedulesChain, personasChain, calls };
}

function mockAuth(personaIds?: string[] | null) {
  vi.mocked(requireSupabaseSession).mockResolvedValue({
    auth: { userId: USER_ID, accessToken: 'pe_test_key', isApiKey: true, ...(personaIds === undefined ? {} : { personaIds }) },
    error: null,
  } as never);
}

function mockOAuthAuth() {
  vi.mocked(requireSupabaseSession).mockResolvedValue({
    auth: { userId: USER_ID, accessToken: 'oauth-token', isOAuth: true },
    error: null,
  } as never);
}

async function deleteSlot(slotId: string): Promise<Response> {
  return DELETE(new Request(`https://example.com/api/schedule/slots/${slotId}`), {
    params: Promise.resolve({ slotId }),
  });
}

describe('DELETE /api/schedule/slots/[slotId]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deletes a ready slot owned by the user', async () => {
    const client = mockSlotsClient({
      slot: { id: 'slot-1', schedule_id: 's1', status: 'ready', title: 'T' },
      schedule: { id: 's1', user_id: USER_ID },
      rpcResult: 'deleted',
    });
    mockAuth();
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await deleteSlot(SLOT_ID);

    expect(response.status).toBe(200);    const body = (await response.json()) as { success: boolean };
    expect(DeleteSlotResponseSchema.safeParse(body).success).toBe(true);
    expect(body.success).toBe(true);
    expect(client.rpc).toHaveBeenCalledWith('delete_slot_if_not_last', {
      p_slot_id: 'slot-1',
      p_user_id: USER_ID,
    });
  });

  it('uses the service client for OAuth callers (no cookie session)', async () => {
    const client = mockSlotsClient({
      slot: { id: 'slot-1', schedule_id: 's1', status: 'ready', title: 'T' },
      schedule: { id: 's1', user_id: USER_ID },
      rpcResult: 'deleted',
    });
    mockOAuthAuth();
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await deleteSlot(SLOT_ID);

    expect(response.status).toBe(200);
    expect(createSupabaseServiceClient).toHaveBeenCalled();
    expect(createSupabaseServerClient).not.toHaveBeenCalled();
  });

  it('runs delete_slot_if_not_last on the service client for a cookie session (service-role-only RPC)', async () => {
    const sessionClient = mockSlotsClient({
      slot: { id: 'slot-1', schedule_id: 's1', status: 'ready', title: 'T' },
      schedule: { id: 's1', user_id: USER_ID },
      rpcResult: 'deleted',
    });
    const serviceClient = mockSlotsClient({
      slot: { id: 'slot-1', schedule_id: 's1', status: 'ready', title: 'T' },
      schedule: { id: 's1', user_id: USER_ID },
      rpcResult: 'deleted',
    });
    vi.mocked(requireSupabaseSession).mockResolvedValue({
      auth: { userId: USER_ID, accessToken: 'jwt', isApiKey: false, isOAuth: false },
      error: null,
    } as never);
    vi.mocked(createSupabaseServerClient).mockResolvedValue(sessionClient as never);
    vi.mocked(createSupabaseServiceClient).mockReturnValue(serviceClient as never);

    const response = await deleteSlot(SLOT_ID);

    expect(response.status).toBe(200);
    expect(sessionClient.from).toHaveBeenCalled();
    expect(sessionClient.rpc).not.toHaveBeenCalled();
    expect(serviceClient.rpc).toHaveBeenCalledWith('delete_slot_if_not_last', {
      p_slot_id: 'slot-1',
      p_user_id: USER_ID,
    });
  });

  it('returns 409 for a published slot', async () => {
    const client = mockSlotsClient({
      slot: { id: 'slot-1', schedule_id: 's1', status: 'published', title: 'T' },
      schedule: { id: 's1', user_id: USER_ID },
    });
    mockAuth();
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await deleteSlot(SLOT_ID);

    expect(response.status).toBe(409);
    expect(client.calls.some((c) => c.op === 'delete')).toBe(false);
  });

  it('returns 404 when the slot belongs to another user', async () => {
    const client = mockSlotsClient({
      slot: { id: 'slot-1', schedule_id: 's1', status: 'ready', title: 'T' },
      schedule: { id: 's1', user_id: 'someone-else' },
    });
    mockAuth();
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await deleteSlot(SLOT_ID);

    expect(response.status).toBe(404);
    expect(client.calls.some((c) => c.op === 'delete')).toBe(false);
  });

  it('returns 404 and does not delete a slot outside the API key persona scope', async () => {
    const client = mockSlotsClient({
      slot: { id: 'slot-1', schedule_id: 's1', status: 'ready', title: 'T' },
      schedule: { id: 's1', user_id: USER_ID, persona_id: 'p-other' },
    });
    mockAuth(['p-allowed']);
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await deleteSlot(SLOT_ID);

    expect(response.status).toBe(404);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it('returns 500 (not 404) and logs when the slot lookup hits a DB error', async () => {
    const { logger } = await import('@/lib/logger');
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn(async () => ({ data: null, error: { code: 'XX000', message: 'connection reset' } })),
    };
    const client = { from: vi.fn(() => chain) };
    mockAuth();
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await deleteSlot(SLOT_ID);

    expect(response.status).toBe(500);
    expect(logger.error).toHaveBeenCalledWith(
      '[api/schedule/slots] slot lookup failed',
      expect.objectContaining({ code: 'XX000' }),
    );
  });

  it('returns 409 for a slot mid-flight (publishing)', async () => {
    for (const status of ['publishing']) {
      const client = mockSlotsClient({
        slot: { id: 'slot-1', schedule_id: 's1', status, title: 'T' },
        schedule: { id: 's1', user_id: USER_ID },
      });
      mockAuth();
      vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

      const response = await deleteSlot(SLOT_ID);

      expect(response.status).toBe(409);
      expect(client.calls.some((c) => c.op === 'delete')).toBe(false);
    }
  });

  it('deletes an awaiting_approval slot owned by the user', async () => {
    const client = mockSlotsClient({
      slot: { id: 'slot-1', schedule_id: 's1', status: 'awaiting_approval', title: 'T' },
      schedule: { id: 's1', user_id: USER_ID },
      rpcResult: 'deleted',
    });
    mockAuth();
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await deleteSlot(SLOT_ID);

    expect(response.status).toBe(200);
    expect(client.rpc).toHaveBeenCalledWith('delete_slot_if_not_last', {
      p_slot_id: 'slot-1',
      p_user_id: USER_ID,
    });
  });

  it('returns 409 when deleting the last awaiting_approval slot of its schedule', async () => {
    const client = mockSlotsClient({
      slot: { id: 'slot-1', schedule_id: 's1', status: 'awaiting_approval', title: 'T' },
      schedule: { id: 's1', user_id: USER_ID },
      rpcResult: 'is_last_slot',
    });
    mockAuth();
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await deleteSlot(SLOT_ID);

    expect(response.status).toBe(409);
    expect(client.rpc).toHaveBeenCalledWith('delete_slot_if_not_last', {
      p_slot_id: 'slot-1',
      p_user_id: USER_ID,
    });
  });

  it('returns 409 when deleting the schedule’s only remaining slot', async () => {
    const client = mockSlotsClient({
      slot: { id: 'slot-1', schedule_id: 's1', status: 'ready', title: 'T' },
      schedule: { id: 's1', user_id: USER_ID },
      rpcResult: 'is_last_slot',
    });
    mockAuth();
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await deleteSlot(SLOT_ID);

    expect(response.status).toBe(409);
    expect(client.rpc).toHaveBeenCalledWith('delete_slot_if_not_last', {
      p_slot_id: 'slot-1',
      p_user_id: USER_ID,
    });
  });

  it('returns 401 when authentication fails', async () => {
    const authError = NextResponse.json(
      { success: false, error: 'Authentication required.' },
      { status: 401 },
    );
    vi.mocked(requireSupabaseSession).mockResolvedValue({ auth: null, error: authError } as never);

    const response = await deleteSlot(SLOT_ID);

    expect(response.status).toBe(401);
  });
});

async function patchSlot(slotId: string, body: unknown): Promise<Response> {
  return PATCH(new Request(`https://example.com/api/schedule/slots/${slotId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }), {
    params: Promise.resolve({ slotId }),
  });
}

describe('PATCH /api/schedule/slots/[slotId]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('edits the title of a ready slot and returns the trimmed value', async () => {
    const client = mockSlotsClient({
      slot: { id: 'slot-1', schedule_id: 's1', status: 'ready', title: 'Old' },
      schedule: { id: 's1', user_id: USER_ID },
    });
    mockAuth();
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await patchSlot(SLOT_ID, { title: '  Novo tema  ' });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { success: boolean; title: string };
    expect(UpdateSlotResponseSchema.safeParse(body).success).toBe(true);
    expect(body).toEqual({ success: true, title: 'Novo tema' });
    const updateCall = client.calls.find((c) => c.op === 'update');
    expect(updateCall).toBeDefined();
    expect(updateCall?.args?.[0]).toEqual({ title: 'Novo tema' });
    const inCall = client.calls.find((c) => c.op === 'in');
    expect(inCall?.args?.[0]).toBe('status');
    expect(inCall?.args?.[1]).toEqual(['ready']);
  });

  it('reschedules a ready slot within the window', async () => {
    const slotAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const client = mockSlotsClient({
      slot: { id: 'slot-1', schedule_id: 's1', status: 'ready', title: 'Old' },
      schedule: { id: 's1', user_id: USER_ID },
    });
    mockAuth();
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await patchSlot(SLOT_ID, { slotAt });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { success: boolean; slotAt: string };
    expect(body).toEqual({ success: true, slotAt });
  });

  it('rejects rescheduling with 402 when the trial is inactive but allows a title edit', async () => {
    const slotAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const client = mockSlotsClient({
      slot: { id: 'slot-1', schedule_id: 's1', status: 'ready', title: 'Old' },
      schedule: { id: 's1', user_id: USER_ID },
    });
    mockAuth();
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);
    vi.mocked(assertAccessActive).mockResolvedValueOnce(NextResponse.json({ success: false, error: 'Trial expired' }, { status: 402 }));
    const blocked = await patchSlot(SLOT_ID, { slotAt });
    expect(blocked.status).toBe(402);
    expect(client.calls.some((c) => c.op === 'update')).toBe(false);
    const allowed = await patchSlot(SLOT_ID, { title: 'New title' });
    expect(allowed.status).toBe(200);
  });

  it('edits the title and reschedules in one call', async () => {
    const slotAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const client = mockSlotsClient({
      slot: { id: 'slot-1', schedule_id: 's1', status: 'ready', title: 'Old' },
      schedule: { id: 's1', user_id: USER_ID },
    });
    mockAuth();
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await patchSlot(SLOT_ID, { title: 'Novo tema', slotAt });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { success: boolean; title: string; slotAt: string };
    expect(body).toEqual({ success: true, title: 'Novo tema', slotAt });
    const updateCall = client.calls.find((c) => c.op === 'update');
    expect(updateCall?.args?.[0]).toEqual({ title: 'Novo tema', slot_at: slotAt });
  });

  it('returns 400 when the new time is inside the 3h lead', async () => {
    const slotAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const client = mockSlotsClient({
      slot: { id: 'slot-1', schedule_id: 's1', status: 'ready', title: 'Old' },
      schedule: { id: 's1', user_id: USER_ID },
    });
    mockAuth();
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await patchSlot(SLOT_ID, { slotAt });

    expect(response.status).toBe(400);
    expect(client.calls.some((c) => c.op === 'update')).toBe(false);
  });

  it('returns 400 when the new time is more than 30 days ahead', async () => {
    const slotAt = new Date(Date.now() + 31 * 24 * 60 * 60 * 1000).toISOString();
    const client = mockSlotsClient({
      slot: { id: 'slot-1', schedule_id: 's1', status: 'ready', title: 'Old' },
      schedule: { id: 's1', user_id: USER_ID },
    });
    mockAuth();
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await patchSlot(SLOT_ID, { slotAt });

    expect(response.status).toBe(400);
    expect(client.calls.some((c) => c.op === 'update')).toBe(false);
  });

  it('returns 400 for an invalid slotAt', async () => {
    const client = mockSlotsClient({
      slot: { id: 'slot-1', schedule_id: 's1', status: 'ready', title: 'Old' },
      schedule: { id: 's1', user_id: USER_ID },
    });
    mockAuth();
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await patchSlot(SLOT_ID, { slotAt: 'not-a-date' });

    expect(response.status).toBe(400);
    expect(client.calls.some((c) => c.op === 'update')).toBe(false);
  });

  it('returns 400 for a naive slotAt without a timezone offset', async () => {
    const naiveSlotAt = new Date(Date.now() + 24 * 60 * 60 * 1000)
      .toISOString()
      .replace(/Z$/, '');
    const client = mockSlotsClient({
      slot: { id: 'slot-1', schedule_id: 's1', status: 'ready', title: 'Old' },
      schedule: { id: 's1', user_id: USER_ID },
    });
    mockAuth();
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await patchSlot(SLOT_ID, { slotAt: naiveSlotAt });

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain('explicit timezone offset');
    expect(client.calls.some((c) => c.op === 'update')).toBe(false);
  });

  it('returns 409 when rescheduling an ASAP slot', async () => {
    const slotAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const client = mockSlotsClient({
      slot: { id: 'slot-1', schedule_id: 's1', status: 'ready', title: 'Old' },
      schedule: { id: 's1', user_id: USER_ID, publish_mode: 'asap' },
    });
    mockAuth();
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await patchSlot(SLOT_ID, { slotAt });

    expect(response.status).toBe(409);
    expect(client.calls.some((c) => c.op === 'update')).toBe(false);
  });

  it('reschedules an awaiting_approval slot without touching its title', async () => {
    const slotAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const client = mockSlotsClient({
      slot: { id: 'slot-1', schedule_id: 's1', status: 'awaiting_approval', title: 'Old' },
      schedule: { id: 's1', user_id: USER_ID },
    });
    mockAuth();
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await patchSlot(SLOT_ID, { slotAt });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { success: boolean; slotAt: string };
    expect(body).toEqual({ success: true, slotAt });
    const updateCall = client.calls.find((c) => c.op === 'update');
    expect(updateCall?.args?.[0]).toEqual({ slot_at: slotAt });
    const inCall = client.calls.find((c) => c.op === 'in');
    expect(inCall?.args?.[0]).toBe('status');
    expect(inCall?.args?.[1]).toEqual(['awaiting_approval']);
  });

  it('returns 409 when editing the title of an awaiting_approval slot', async () => {
    const client = mockSlotsClient({
      slot: { id: 'slot-1', schedule_id: 's1', status: 'awaiting_approval', title: 'Old' },
      schedule: { id: 's1', user_id: USER_ID },
    });
    mockAuth();
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await patchSlot(SLOT_ID, { title: 'Novo tema' });

    expect(response.status).toBe(409);
    expect(client.calls.some((c) => c.op === 'update')).toBe(false);
  });

  it('returns 409 when editing title and time of an awaiting_approval slot together', async () => {
    const slotAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const client = mockSlotsClient({
      slot: { id: 'slot-1', schedule_id: 's1', status: 'awaiting_approval', title: 'Old' },
      schedule: { id: 's1', user_id: USER_ID },
    });
    mockAuth();
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await patchSlot(SLOT_ID, { title: 'Novo tema', slotAt });

    expect(response.status).toBe(409);
    expect(client.calls.some((c) => c.op === 'update')).toBe(false);
  });

  it('returns 400 when neither title nor slotAt is provided', async () => {
    const client = mockSlotsClient({
      slot: { id: 'slot-1', schedule_id: 's1', status: 'ready', title: 'Old' },
      schedule: { id: 's1', user_id: USER_ID },
    });
    mockAuth();
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await patchSlot(SLOT_ID, {});

    expect(response.status).toBe(400);
    expect(client.calls.some((c) => c.op === 'update')).toBe(false);
  });

  it('returns 409 when the slot dispatches between the status check and the update', async () => {
    const client = mockSlotsClient({
      slot: { id: 'slot-1', schedule_id: 's1', status: 'ready', title: 'Old' },
      schedule: { id: 's1', user_id: USER_ID },
      updateConflict: true,
    });
    mockAuth();
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await patchSlot(SLOT_ID, { title: 'Novo tema' });

    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('The slot changed before this update. Reload and try again.');
  });

  it('returns a retry message, not the move-only message, when a slotAt-only move of an awaiting slot loses the race', async () => {
    const slotAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const client = mockSlotsClient({
      slot: { id: 'slot-1', schedule_id: 's1', status: 'awaiting_approval', title: 'Old' },
      schedule: { id: 's1', user_id: USER_ID },
      updateConflict: true,
    });
    mockAuth();
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await patchSlot(SLOT_ID, { slotAt });

    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('The slot changed before this update. Reload and try again.');
  });

  it('uses the service client for OAuth callers (no cookie session)', async () => {
    const client = mockSlotsClient({
      slot: { id: 'slot-1', schedule_id: 's1', status: 'ready', title: 'Old' },
      schedule: { id: 's1', user_id: USER_ID },
    });
    mockOAuthAuth();
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await patchSlot(SLOT_ID, { title: 'Novo tema' });

    expect(response.status).toBe(200);
    expect(createSupabaseServiceClient).toHaveBeenCalled();
    expect(createSupabaseServerClient).not.toHaveBeenCalled();
  });

  it('returns 400 for an empty or whitespace-only title', async () => {
    const client = mockSlotsClient({
      slot: { id: 'slot-1', schedule_id: 's1', status: 'ready', title: 'Old' },
      schedule: { id: 's1', user_id: USER_ID },
    });
    mockAuth();
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    for (const title of ['', '   ']) {
      const response = await patchSlot(SLOT_ID, { title });
      expect(response.status).toBe(400);
    }
    expect(client.calls.some((c) => c.op === 'update')).toBe(false);
  });

  it('returns 409 for a slot that already dispatched (not ready)', async () => {
    const client = mockSlotsClient({
      slot: { id: 'slot-1', schedule_id: 's1', status: 'published', title: 'Old' },
      schedule: { id: 's1', user_id: USER_ID },
    });
    mockAuth();
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await patchSlot(SLOT_ID, { title: 'Novo tema' });

    expect(response.status).toBe(409);
    expect(client.calls.some((c) => c.op === 'update')).toBe(false);
  });

  it('returns 404 when the slot belongs to another user', async () => {
    const client = mockSlotsClient({
      slot: { id: 'slot-1', schedule_id: 's1', status: 'ready', title: 'Old' },
      schedule: { id: 's1', user_id: 'someone-else' },
    });
    mockAuth();
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await patchSlot(SLOT_ID, { title: 'Novo tema' });

    expect(response.status).toBe(404);
    expect(client.calls.some((c) => c.op === 'update')).toBe(false);
  });

  it('returns 404 and does not update a slot outside the API key persona scope', async () => {
    const client = mockSlotsClient({
      slot: { id: 'slot-1', schedule_id: 's1', status: 'ready', title: 'Old' },
      schedule: { id: 's1', user_id: USER_ID, persona_id: 'p-other' },
    });
    mockAuth(['p-allowed']);
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await patchSlot(SLOT_ID, { title: 'New' });

    expect(response.status).toBe(404);
    expect(client.calls.some((call) => call.op === 'update')).toBe(false);
  });
});

const SLOT_DETAIL_ROW = {
  id: 'slot-1',
  schedule_id: 's1',
  slot_at: '2030-06-01T10:00:00.000Z',
  status: 'ready',
  title: 'Next big thing',
  error: null,
  published_at: null,
  publish_outcomes: null,
};

const SCHEDULE_ROW = {
  id: 's1',
  persona_id: 'p1',
  providers: ['youtube', 'instagram'],
  youtube_account_ids: ['ch1'],
  instagram_account_ids: ['ig1'],
  linkedin_account_ids: [],
  bluesky_account_ids: ['bsky1'],
  timezone: 'Europe/Lisbon',
  publish_mode: 'scheduled',
};

describe('GET /api/schedule/slots/[slotId]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://example.com');
  });

  it('returns the slot with schedule and persona for the owner', async () => {
    const client = mockSlotsClient({
      slot: SLOT_DETAIL_ROW,
      schedule: SCHEDULE_ROW,
      persona: { id: 'p1', name: 'Viva Leve' },
    });
    mockAuth();
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await GET(new Request('https://example.com/api/schedule/slots/slot-1'), {
      params: Promise.resolve({ slotId: SLOT_ID }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      success: boolean;
      slot: Record<string, unknown>;
      schedule: Record<string, unknown>;
      persona: { id: string; name: string };
    };
    expect(GetSlotResponseSchema.safeParse(body).success).toBe(true);
    expect(body.success).toBe(true);
    expect(body.slot).toMatchObject({
      id: 'slot-1',
      scheduleId: 's1',
      slotAt: '2030-06-01T10:00:00.000Z',
      status: 'ready',
      title: 'Next big thing',
      postUrl: 'https://example.com/posts/slot-1',
    });
    expect(body.schedule).toMatchObject({
      id: 's1',
      personaId: 'p1',
      youtubeAccountIds: ['ch1'],
      instagramAccountIds: ['ig1'],
      blueskyAccountIds: ['bsky1'],
      timezone: 'Europe/Lisbon',
    });
    expect(body.persona).toEqual({ id: 'p1', name: 'Viva Leve' });
  });

  const PROMPT_VERSION_ID = '7b0e6c1e-0000-4000-8000-000000000001';

  function installCookieSlotsSession(
    sessionOptions: Parameters<typeof mockSlotsClient>[0],
    serviceOptions: Parameters<typeof mockSlotsClient>[0] = {},
  ) {
    const session = mockSlotsClient(sessionOptions);
    const service = mockSlotsClient(serviceOptions);
    vi.mocked(requireSupabaseSession).mockResolvedValue({
      auth: { userId: USER_ID, accessToken: 'session-token', isApiKey: false, isOAuth: false },
      error: null,
    } as never);
    vi.mocked(createSupabaseServerClient).mockResolvedValue(session as never);
    vi.mocked(createSupabaseServiceClient).mockReturnValue(service as never);
    return { session, service };
  }

  function getSlot(): Promise<Response> {
    return GET(new Request('https://example.com/api/schedule/slots/slot-1'), {
      params: Promise.resolve({ slotId: SLOT_ID }),
    });
  }

  const SESSION_PROMPT_DENIED = { code: '42501', message: 'permission denied for table prompt_versions' };

  it('returns the prompt facts for a cookie-session caller', async () => {
    const { session, service } = installCookieSlotsSession(
      {
        slot: { ...SLOT_DETAIL_ROW, prompt_version_id: PROMPT_VERSION_ID },
        schedule: SCHEDULE_ROW,
        persona: { id: 'p1', name: 'Viva Leve' },
        promptVersionError: SESSION_PROMPT_DENIED,
      },
      {
        promptVersion: { slug: 'community-hook', title: 'Community hook', version: 2, source: 'user', owner_id: 'other-user' },
      },
    );

    const response = await getSlot();

    expect(response.status).toBe(200);
    const body = (await response.json()) as { prompt: unknown };
    expect(GetSlotResponseSchema.safeParse(body).success).toBe(true);
    expect(body.prompt).toEqual({ slug: 'community-hook', title: 'Community hook', version: 2, source: 'user' });
    expect(session.from).not.toHaveBeenCalledWith('prompt_versions');
    expect(service.from).toHaveBeenCalledWith('prompt_versions');
    expect(
      service.calls.filter((call) => call.table === 'prompt_versions' && call.op === 'eq').map((call) => call.args),
    ).toEqual([['id', PROMPT_VERSION_ID]]);
  });

  it('returns 404 without creating the service client when the slot is not the caller\'s', async () => {
    const { session } = installCookieSlotsSession({ slot: null, schedule: SCHEDULE_ROW });

    const response = await getSlot();

    expect(response.status).toBe(404);
    expect(session.calls).toContainEqual({ table: 'scheduled_posts', op: 'eq', args: ['user_id', USER_ID] });
    expect(createSupabaseServiceClient).not.toHaveBeenCalled();
  });

  it('returns 404 without creating the service client when the schedule belongs to another user', async () => {
    const { session } = installCookieSlotsSession({
      slot: { ...SLOT_DETAIL_ROW, prompt_version_id: PROMPT_VERSION_ID },
      schedule: null,
    });

    const response = await getSlot();

    expect(response.status).toBe(404);
    expect(session.calls).toContainEqual({ table: 'schedules', op: 'eq', args: ['user_id', USER_ID] });
    expect(createSupabaseServiceClient).not.toHaveBeenCalled();
  });

  it('returns 404 and never reads prompt_versions for a slot outside the API key persona scope', async () => {
    const client = mockSlotsClient({
      slot: { ...SLOT_DETAIL_ROW, prompt_version_id: PROMPT_VERSION_ID },
      schedule: SCHEDULE_ROW,
      persona: { id: 'p1', name: 'Viva Leve' },
      promptVersion: { slug: 'community-hook', title: 'Community hook', version: 2, source: 'user' },
    });
    mockAuth(['p-allowed']);
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await getSlot();

    expect(response.status).toBe(404);
    expect(client.from).not.toHaveBeenCalledWith('prompt_versions');
  });

  it('logs at error level and returns the slot with a null prompt when the service read fails', async () => {
    const { logger } = await import('@/lib/logger');
    installCookieSlotsSession(
      {
        slot: { ...SLOT_DETAIL_ROW, prompt_version_id: PROMPT_VERSION_ID },
        schedule: SCHEDULE_ROW,
        persona: { id: 'p1', name: 'Viva Leve' },
        promptVersionError: SESSION_PROMPT_DENIED,
      },
      { promptVersionError: { code: 'XX000', message: 'down' } },
    );

    const response = await getSlot();

    expect(response.status).toBe(200);
    const body = (await response.json()) as { slot: { id: string }; prompt: unknown };
    expect(body.slot.id).toBe('slot-1');
    expect(body.prompt).toBeNull();
    expect(logger.error).toHaveBeenCalledWith(
      '[prompt-versions] post prompt lookup failed',
      { code: 'XX000', message: 'down' },
      { versionId: PROMPT_VERSION_ID, code: 'XX000' },
    );
  });

  it('exposes the asap publish mode on the schedule payload', async () => {
    const client = mockSlotsClient({
      slot: SLOT_DETAIL_ROW,
      schedule: { ...SCHEDULE_ROW, publish_mode: 'asap' },
      persona: { id: 'p1', name: 'Viva Leve' },
    });
    mockAuth();
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await GET(new Request('https://example.com/api/schedule/slots/slot-1'), {
      params: Promise.resolve({ slotId: SLOT_ID }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { success: boolean; schedule: Record<string, unknown> };
    expect(body.success).toBe(true);
    expect(body.schedule.publishMode).toBe('asap');
  });

  it('narrows a missing publish mode to scheduled', async () => {
    const { publish_mode: _dropped, ...rowWithoutMode } = SCHEDULE_ROW;
    const client = mockSlotsClient({
      slot: SLOT_DETAIL_ROW,
      schedule: rowWithoutMode,
      persona: { id: 'p1', name: 'Viva Leve' },
    });
    mockAuth();
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await GET(new Request('https://example.com/api/schedule/slots/slot-1'), {
      params: Promise.resolve({ slotId: SLOT_ID }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { success: boolean; schedule: Record<string, unknown> };
    expect(body.success).toBe(true);
    expect(body.schedule.publishMode).toBe('scheduled');
  });

  it('skips the persona lookup for a slot on a persona-less schedule', async () => {
    const client = mockSlotsClient({
      slot: SLOT_DETAIL_ROW,
      schedule: { ...SCHEDULE_ROW, persona_id: null },
      persona: null,
    });
    mockAuth();
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await GET(new Request('https://example.com/api/schedule/slots/slot-1'), {
      params: Promise.resolve({ slotId: SLOT_ID }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      success: boolean;
      schedule: Record<string, unknown>;
      persona: unknown;
    };
    expect(body.success).toBe(true);
    expect(body.schedule).toMatchObject({ id: 's1', personaId: null });
    expect(body.persona).toBeNull();
    expect(client.calls.some((c) => c.table === 'personas')).toBe(false);
  });

  it('degrades to a null persona but logs when the persona lookup hits a DB error', async () => {
    const { logger } = await import('@/lib/logger');
    const client = mockSlotsClient({
      slot: SLOT_DETAIL_ROW,
      schedule: SCHEDULE_ROW,
      personaError: { code: 'XX000', message: 'connection reset' },
    });
    mockAuth();
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await GET(new Request('https://example.com/api/schedule/slots/slot-1'), {
      params: Promise.resolve({ slotId: SLOT_ID }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { success: boolean; persona: unknown };
    expect(body.success).toBe(true);
    expect(body.persona).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(
      '[post-detail] persona lookup failed',
      expect.objectContaining({ code: 'XX000' }),
    );
  });

  it('uses the service client for OAuth callers (no cookie session)', async () => {
    const client = mockSlotsClient({
      slot: SLOT_DETAIL_ROW,
      schedule: SCHEDULE_ROW,
      persona: { id: 'p1', name: 'Viva Leve' },
    });
    mockOAuthAuth();
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await GET(new Request('https://example.com/api/schedule/slots/slot-1'), {
      params: Promise.resolve({ slotId: SLOT_ID }),
    });

    expect(response.status).toBe(200);
    expect(createSupabaseServiceClient).toHaveBeenCalled();
    expect(createSupabaseServerClient).not.toHaveBeenCalled();
  });

  it('returns 429 when the rate limiter rejects the request', async () => {
    const { applyRateLimit } = await import('@/lib/rate-limit');
    vi.mocked(applyRateLimit).mockResolvedValueOnce(
      NextResponse.json({ success: false, error: 'Too many requests.' }, { status: 429 }),
    );
    mockAuth();

    const response = await GET(new Request('https://example.com/api/schedule/slots/slot-1'), {
      params: Promise.resolve({ slotId: SLOT_ID }),
    });

    expect(response.status).toBe(429);
  });

  it('returns 404 for another user’s slot without leaking the row', async () => {
    const client = mockSlotsClient({
      slot: { ...SLOT_DETAIL_ROW, user_id: 'someone-else' },
      schedule: null,
      persona: { id: 'p1', name: 'Viva Leve' },
    });
    mockAuth();
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await GET(new Request('https://example.com/api/schedule/slots/slot-1'), {
      params: Promise.resolve({ slotId: SLOT_ID }),
    });

    expect(response.status).toBe(404);
    const body = (await response.json()) as { success: boolean };
    expect(body.success).toBe(false);
  });

  it('returns 401 when authentication fails', async () => {
    const authError = NextResponse.json(
      { success: false, error: 'Authentication required.' },
      { status: 401 },
    );
    vi.mocked(requireSupabaseSession).mockResolvedValue({ auth: null, error: authError } as never);

    const response = await GET(new Request('https://example.com/api/schedule/slots/slot-1'), {
      params: Promise.resolve({ slotId: SLOT_ID }),
    });

    expect(response.status).toBe(401);
  });

});

describe('GET /api/schedule/slots/[slotId] published links', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuth();
  });

  function mockSlot(row: Record<string, unknown>) {
    const client = mockSlotsClient({
      slot: row,
      schedule: SCHEDULE_ROW,
      persona: { id: 'p1', name: 'Viva Leve' },
    });
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);
  }

  function mockPublished(publishOutcomes: unknown) {
    mockSlot({ ...SLOT_DETAIL_ROW, status: 'published', publish_outcomes: publishOutcomes });
  }

  async function getBody(): Promise<{ slot: { publishLinks: unknown } }> {
    const response = await GET(new Request('https://example.com/api/schedule/slots/slot-1'), {
      params: Promise.resolve({ slotId: SLOT_ID }),
    });
    expect(response.status).toBe(200);
    return (await response.json()) as { slot: { publishLinks: unknown } };
  }

  it('returns the provider links recorded in the publish outcomes', async () => {
    mockPublished([
      { provider: 'youtube', status: 'published', accountId: 'ch1', videoUrl: 'https://www.youtube.com/watch?v=abc' },
      { provider: 'instagram', status: 'published', accountId: 'ig1', permalink: 'https://www.instagram.com/p/xyz/' },
    ]);

    const body = await getBody();
    expect(body.slot.publishLinks).toEqual([
      { provider: 'youtube', url: 'https://www.youtube.com/watch?v=abc' },
      { provider: 'instagram', url: 'https://www.instagram.com/p/xyz/' },
    ]);
  });

  it('derives the Bluesky URL from the at:// record URI', async () => {
    mockPublished([
      { provider: 'bluesky', status: 'published', accountId: 'bsky1', postId: 'at://did:plc:abc/app.bsky.feed.post/xyz' },
    ]);

    const body = await getBody();
    expect(body.slot.publishLinks).toEqual([
      { provider: 'bluesky', url: 'https://bsky.app/profile/did:plc:abc/post/xyz' },
    ]);
  });

  it('returns no links when no outcome was recorded', async () => {
    mockPublished(null);

    const body = await getBody();
    expect(body.slot.publishLinks).toEqual([]);
  });

  it('drops a failed outcome and an outcome with no usable URL', async () => {
    mockPublished([
      { provider: 'linkedin', status: 'published', accountId: 'li1' },
      { provider: 'youtube', status: 'failed', accountId: 'ch1', videoUrl: 'https://www.youtube.com/watch?v=abc' },
    ]);

    const body = await getBody();
    expect(body.slot.publishLinks).toEqual([]);
  });

  it('shows no links for a slot that is not published yet', async () => {
    mockSlot({
      ...SLOT_DETAIL_ROW,
      status: 'publishing',
      publish_outcomes: [{ provider: 'youtube', status: 'published', accountId: 'ch1', videoUrl: 'https://www.youtube.com/watch?v=abc' }],
    });

    const body = await getBody();
    expect(body.slot.publishLinks).toEqual([]);
  });
});

describe('GET /api/schedule/slots/[slotId] failure logging', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireSupabaseSession).mockResolvedValue({
      auth: { userId: USER_ID, accessToken: 'pe_test_key', isApiKey: true },
      error: null,
    } as never);
  });

  it('returns 500 and logs when the slot lookup fails (DB down, not missing)', async () => {
    const { logger } = await import('@/lib/logger');
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn(async () => ({ data: null, error: { code: 'XX000', message: 'connection reset' } })),
    };
    const client = { from: vi.fn(() => chain) };
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await GET(new Request('https://example.com/api/schedule/slots/slot-1'), {
      params: Promise.resolve({ slotId: SLOT_ID }),
    });

    expect(response.status).toBe(500);
    expect(logger.error).toHaveBeenCalledWith(
      '[api/schedule/slots] slot lookup failed',
      expect.objectContaining({ code: 'XX000' }),
    );
  });

  it('returns 500 and logs when the ownership/schedule lookup fails', async () => {
    const { logger } = await import('@/lib/logger');
    const postsChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn(async () => ({ data: SLOT_DETAIL_ROW, error: null })),
    };
    const schedulesChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn(async () => ({ data: null, error: { code: 'XX000', message: 'timeout' } })),
    };
    const client = {
      from: vi.fn((table: string) => (table === 'scheduled_posts' ? postsChain : schedulesChain)),
    };
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await GET(new Request('https://example.com/api/schedule/slots/slot-1'), {
      params: Promise.resolve({ slotId: SLOT_ID }),
    });

    expect(response.status).toBe(500);
    expect(logger.error).toHaveBeenCalledWith(
      '[api/schedule/slots] slot lookup failed',
      expect.objectContaining({ code: 'XX000' }),
    );
  });

  it('keeps PGRST116 as a plain 404 without an error log', async () => {
    const { logger } = await import('@/lib/logger');
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn(async () => ({ data: null, error: { code: 'PGRST116' } })),
    };
    const client = { from: vi.fn(() => chain) };
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await GET(new Request('https://example.com/api/schedule/slots/slot-1'), {
      params: Promise.resolve({ slotId: SLOT_ID }),
    });

    expect(response.status).toBe(404);
    expect(logger.error).not.toHaveBeenCalled();
  });
});

describe('slot id normalization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function slotIdEqCalls(client: { calls: ChainCall[] }, table: string) {
    return client.calls
      .filter((c) => c.table === table && c.op === 'eq' && c.args[0] === 'id')
      .map((c) => c.args[1]);
  }

  it('GET resolves a batch:<scheduleId>:slot:<slotId> key to the slot uuid', async () => {
    const client = mockSlotsClient({
      slot: SLOT_DETAIL_ROW,
      schedule: SCHEDULE_ROW,
      persona: { id: 'p1', name: 'Viva Leve' },
    });
    mockAuth();
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const composite = `batch:${BATCH_ID}:slot:${SLOT_ID}`;
    const response = await GET(new Request(`https://example.com/api/schedule/slots/${composite}`), {
      params: Promise.resolve({ slotId: composite }),
    });

    expect(response.status).toBe(200);
    expect(slotIdEqCalls(client, 'scheduled_posts')).toEqual([SLOT_ID]);
    expect(
      client.calls
        .filter((c) => c.table === 'scheduled_posts' && c.op === 'select')
        .map((c) => c.args),
    ).toEqual([['id, schedule_id, slot_at, status, title, description, error, published_at, publish_outcomes, prompt_version_id, media_kind, media_ref, media_content_type']]);
    expect(
      client.calls
        .filter((c) => c.table === 'scheduled_posts' && c.op === 'eq')
        .map((c) => c.args),
    ).toEqual([
      ['id', SLOT_ID],
      ['user_id', USER_ID],
    ]);
  });

  it('GET 404s a non-uuid id without touching the database', async () => {
    const { logger } = await import('@/lib/logger');
    const client = mockSlotsClient({});
    mockAuth();
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await GET(new Request('https://example.com/api/schedule/slots/not-a-uuid'), {
      params: Promise.resolve({ slotId: 'not-a-uuid' }),
    });

    expect(response.status).toBe(404);
    expect(client.from).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      '[GET /api/schedule/slots] 404 Slot not found.',
      expect.objectContaining({ route: 'GET /api/schedule/slots' }),
    );
  });

  it('GET 404s a malformed batch key without touching the database', async () => {
    const { logger } = await import('@/lib/logger');
    const client = mockSlotsClient({});
    mockAuth();
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const malformed = `batch:${BATCH_ID}:slot:nope`;
    const response = await GET(new Request(`https://example.com/api/schedule/slots/${malformed}`), {
      params: Promise.resolve({ slotId: malformed }),
    });

    expect(response.status).toBe(404);
    expect(client.from).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      '[GET /api/schedule/slots] 404 Slot not found.',
      expect.objectContaining({ route: 'GET /api/schedule/slots' }),
    );
  });

  it('DELETE 404s a non-uuid id without touching the database', async () => {
    const { logger } = await import('@/lib/logger');
    const client = mockSlotsClient({});
    mockAuth();
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await deleteSlot('not-a-uuid');

    expect(response.status).toBe(404);
    expect(client.from).not.toHaveBeenCalled();
    expect(client.rpc).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      '[DELETE /api/schedule/slots] 404 Slot not found.',
      expect.objectContaining({ route: 'DELETE /api/schedule/slots' }),
    );
  });

  it('DELETE resolves a batch key to the slot uuid', async () => {
    const client = mockSlotsClient({
      slot: { id: SLOT_ID, schedule_id: 's1', status: 'ready', title: 'T' },
      schedule: { id: 's1', user_id: USER_ID },
      rpcResult: 'deleted',
    });
    mockAuth();
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await deleteSlot(`batch:${BATCH_ID}:slot:${SLOT_ID}`);

    expect(response.status).toBe(200);
    expect(slotIdEqCalls(client, 'scheduled_posts')).toEqual([SLOT_ID]);
  });

  it('PATCH 404s a non-uuid id without touching the database', async () => {
    const { logger } = await import('@/lib/logger');
    const client = mockSlotsClient({});
    mockAuth();
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await patchSlot('not-a-uuid', { title: 'Novo tema' });

    expect(response.status).toBe(404);
    expect(client.from).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      '[PATCH /api/schedule/slots] 404 Slot not found.',
      expect.objectContaining({ route: 'PATCH /api/schedule/slots' }),
    );
  });

  it('updates a cookie session slot on the service client when the session update is denied', async () => {
    const slot = { id: 'slot-1', schedule_id: 's1', status: 'ready', title: 'Old' };
    const schedule = { id: 's1', user_id: USER_ID };
    const session = mockSlotsClient({ slot, schedule, updateConflict: true });
    const service = mockSlotsClient({ slot, schedule });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(session as never);
    vi.mocked(createSupabaseServiceClient).mockReturnValue(service as never);
    vi.mocked(requireSupabaseSession).mockResolvedValue({
      auth: { userId: USER_ID, accessToken: 'cookie-token', isApiKey: false },
      error: null,
    } as never);

    const response = await patchSlot(SLOT_ID, { title: 'Novo tema' });

    expect(response.status).toBe(200);
    expect(session.calls.some((call) => call.op === 'update')).toBe(false);
    expect(service.calls.find((call) => call.op === 'update')?.args?.[0]).toEqual({ title: 'Novo tema' });
    expect(service.calls.some((call) => call.op === 'eq' && call.args[0] === 'user_id' && call.args[1] === USER_ID)).toBe(true);
  });
});
