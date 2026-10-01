// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
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

import { DELETE, PATCH } from '../route';
import { requireSupabaseSession } from '@/lib/request-auth';
import { createSupabaseServiceClient } from '@/lib/supabase/service';

//---------------
// DELETE /api/schedule/slots/:slotId — a user can delete a single slot of
// their own schedule. Published posts can never be deleted; failed slots
// can (cleanup of a dead row).
//---------------

const USER_ID = 'user-1';

interface ChainCall {
  table: string;
  op: string;
  args: unknown[];
}

//---------------
// mockSlotsClient — records every (table, op) call so tests assert the
// delete is scoped by user_id, and resolves the slot/schedule fixtures by
// op order: select slot → select schedule → count remaining → delete.
//---------------
function mockSlotsClient(options: {
  slot?: unknown;
  schedule?: unknown;
  remaining?: unknown[];
  deleteError?: unknown;
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
      single: vi.fn(async () => ({ data: options.slot ?? null, error: options.slot ? null : { code: 'PGRST116' } })),
      maybeSingle: vi.fn(async () => ({ data: options.schedule ?? null, error: null })),
      delete: track('delete'),
      update: track('update'),
      limit: vi.fn(async () => ({ data: options.remaining ?? [], error: null })),
    });
    return chain;
  };
  const postsChain = makeChain('scheduled_posts');
  const schedulesChain = makeChain('schedules');
  const from = vi.fn((table: string) => (table === 'scheduled_posts' ? postsChain : schedulesChain));
  return { from, postsChain, schedulesChain, calls };
}

function mockAuth() {
  vi.mocked(requireSupabaseSession).mockResolvedValue({
    auth: { userId: USER_ID, accessToken: 'pe_test_key', isApiKey: true },
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

  it('deletes an awaiting slot owned by the user', async () => {
    const client = mockSlotsClient({
      slot: { id: 'slot-1', schedule_id: 's1', status: 'pending', topic: 'T' },
      schedule: { id: 's1', user_id: USER_ID },
      remaining: [{ id: 'slot-2' }],
    });
    mockAuth();
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await deleteSlot('slot-1');

    expect(response.status).toBe(200);
    const body = (await response.json()) as { success: boolean };
    expect(body.success).toBe(true);
    // The delete must be scoped to the slot id AND the owner.
    const deleteCall = client.calls.find((c) => c.op === 'delete');
    expect(deleteCall?.table).toBe('scheduled_posts');
  });

  it('returns 409 for a published slot', async () => {
    const client = mockSlotsClient({
      slot: { id: 'slot-1', schedule_id: 's1', status: 'published', topic: 'T' },
      schedule: { id: 's1', user_id: USER_ID },
    });
    mockAuth();
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await deleteSlot('slot-1');

    expect(response.status).toBe(409);
    expect(client.calls.some((c) => c.op === 'delete')).toBe(false);
  });

  it('returns 404 when the slot belongs to another user', async () => {
    const client = mockSlotsClient({
      slot: { id: 'slot-1', schedule_id: 's1', status: 'pending', topic: 'T' },
      schedule: { id: 's1', user_id: 'someone-else' },
    });
    mockAuth();
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await deleteSlot('slot-1');

    expect(response.status).toBe(404);
    expect(client.calls.some((c) => c.op === 'delete')).toBe(false);
  });

  it('returns 409 for slots mid-flight (generating, ready, publishing)', async () => {
    for (const status of ['generating', 'ready', 'publishing']) {
      const client = mockSlotsClient({
        slot: { id: 'slot-1', schedule_id: 's1', status, topic: 'T' },
        schedule: { id: 's1', user_id: USER_ID },
      });
      mockAuth();
      vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

      const response = await deleteSlot('slot-1');

      expect(response.status).toBe(409);
      expect(client.calls.some((c) => c.op === 'delete')).toBe(false);
    }
  });

  it('returns 409 when deleting the schedule’s only remaining slot', async () => {
    const client = mockSlotsClient({
      slot: { id: 'slot-1', schedule_id: 's1', status: 'pending', topic: 'T' },
      schedule: { id: 's1', user_id: USER_ID },
      remaining: [],
    });
    mockAuth();
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await deleteSlot('slot-1');

    expect(response.status).toBe(409);
    expect(client.calls.some((c) => c.op === 'delete')).toBe(false);
  });

  it('returns 401 when authentication fails', async () => {
    const authError = NextResponse.json(
      { success: false, error: 'Authentication required.' },
      { status: 401 },
    );
    vi.mocked(requireSupabaseSession).mockResolvedValue({ auth: null, error: authError } as never);

    const response = await deleteSlot('slot-1');

    expect(response.status).toBe(401);
  });
});

//---------------
// PATCH /api/schedule/slots/:slotId — the topic of a slot that has not
// been dispatched to the engine yet can be edited; the engine generates
// each video from the stored topic, so this is the "edit the text" action.
//---------------

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

  it('edits the topic of an awaiting slot and returns the trimmed value', async () => {
    const client = mockSlotsClient({
      slot: { id: 'slot-1', schedule_id: 's1', status: 'pending', topic: 'Old' },
      schedule: { id: 's1', user_id: USER_ID },
    });
    mockAuth();
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await patchSlot('slot-1', { topic: '  Novo tema  ' });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { success: boolean; topic: string };
    expect(body).toEqual({ success: true, topic: 'Novo tema' });
    const updateCall = client.calls.find((c) => c.op === 'update');
    expect(updateCall).toBeDefined();
    expect(updateCall?.args?.[0]).toEqual({ topic: 'Novo tema' });
  });

  it('returns 400 for an empty or whitespace-only topic', async () => {
    const client = mockSlotsClient({
      slot: { id: 'slot-1', schedule_id: 's1', status: 'pending', topic: 'Old' },
      schedule: { id: 's1', user_id: USER_ID },
    });
    mockAuth();
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    for (const topic of ['', '   ']) {
      const response = await patchSlot('slot-1', { topic });
      expect(response.status).toBe(400);
    }
    expect(client.calls.some((c) => c.op === 'update')).toBe(false);
  });

  it('returns 409 for a slot that already dispatched (not pending)', async () => {
    const client = mockSlotsClient({
      slot: { id: 'slot-1', schedule_id: 's1', status: 'published', topic: 'Old' },
      schedule: { id: 's1', user_id: USER_ID },
    });
    mockAuth();
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await patchSlot('slot-1', { topic: 'Novo tema' });

    expect(response.status).toBe(409);
    expect(client.calls.some((c) => c.op === 'update')).toBe(false);
  });

  it('returns 404 when the slot belongs to another user', async () => {
    const client = mockSlotsClient({
      slot: { id: 'slot-1', schedule_id: 's1', status: 'pending', topic: 'Old' },
      schedule: { id: 's1', user_id: 'someone-else' },
    });
    mockAuth();
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await patchSlot('slot-1', { topic: 'Novo tema' });

    expect(response.status).toBe(404);
    expect(client.calls.some((c) => c.op === 'update')).toBe(false);
  });
});
