// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

vi.mock('@/lib/request-auth', () => ({
  requireSupabaseSession: vi.fn(),
  // The slot presentation lib reads live engine progress with these
  // headers — the module mock must keep them available.
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
vi.mock('@/lib/rate-limit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/rate-limit')>();
  return { ...actual, applyRateLimit: vi.fn().mockResolvedValue(null) };
});

import { DELETE, GET, PATCH } from '../route';
import { requireSupabaseSession } from '@/lib/request-auth';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { createSupabaseServerClient } from '@/lib/supabase/server';

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
// delete is scoped by user_id, and resolves the slot/schedule/persona
// fixtures per table (posts: single → slot; schedules: maybeSingle →
// schedule; personas: single → persona).
//---------------
function mockSlotsClient(options: {
  slot?: unknown;
  schedule?: unknown;
  persona?: unknown;
  /** Makes the personas single() resolve with a DB error instead of a row. */
  personaError?: unknown;
  remaining?: unknown[];
  history?: unknown[];
  historyError?: unknown;
  deleteError?: unknown;
  rpcResult?: string;
  rpcError?: unknown;
  updateConflict?: boolean;
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
      single: vi.fn(async () => {
        // PATCH's UPDATE ... .select('id').single() runs after an update()
        // call; updateConflict simulates the row dispatching (pending →
        // generating) between the status check and the write.
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
  const historyChain = makeChain('scheduled_post_progress_history');
  // The progress-history select ends in .order() (not .single()); resolve
  // the fixture rows there.
  (historyChain as Record<string, unknown>).order = vi.fn(async () => ({
    data: options.historyError ? null : (options.history ?? []),
    error: options.historyError ?? null,
  }));
  const from = vi.fn((table: string) =>
    table === 'scheduled_posts'
      ? postsChain
      : table === 'schedules'
        ? schedulesChain
        : table === 'scheduled_post_progress_history'
          ? historyChain
          : personasChain,
  );
  const rpc = vi.fn(async () => ({
    data: options.rpcResult ?? 'deleted',
    error: options.rpcError ?? null,
  }));
  return { from, rpc, postsChain, schedulesChain, personasChain, historyChain, calls };
}

function mockAuth() {
  vi.mocked(requireSupabaseSession).mockResolvedValue({
    auth: { userId: USER_ID, accessToken: 'pe_test_key', isApiKey: true },
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

  it('deletes an awaiting slot owned by the user', async () => {
    const client = mockSlotsClient({
      slot: { id: 'slot-1', schedule_id: 's1', status: 'pending', topic: 'T' },
      schedule: { id: 's1', user_id: USER_ID },
      rpcResult: 'deleted',
    });
    mockAuth();
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await deleteSlot('slot-1');

    expect(response.status).toBe(200);    const body = (await response.json()) as { success: boolean };
    expect(body.success).toBe(true);
    // The atomic RPC scopes the delete to the slot id AND the owner.
    expect(client.rpc).toHaveBeenCalledWith('delete_slot_if_not_last', {
      p_slot_id: 'slot-1',
      p_user_id: USER_ID,
    });
  });

  it('uses the service client for OAuth callers (no cookie session)', async () => {
    const client = mockSlotsClient({
      slot: { id: 'slot-1', schedule_id: 's1', status: 'pending', topic: 'T' },
      schedule: { id: 's1', user_id: USER_ID },
      rpcResult: 'deleted',
    });
    mockOAuthAuth();
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await deleteSlot('slot-1');

    expect(response.status).toBe(200);
    expect(createSupabaseServiceClient).toHaveBeenCalled();
    expect(createSupabaseServerClient).not.toHaveBeenCalled();
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

    const response = await deleteSlot('slot-1');

    expect(response.status).toBe(500);
    expect(logger.error).toHaveBeenCalledWith(
      '[api/schedule/slots] slot lookup failed',
      expect.objectContaining({ code: 'XX000' }),
    );
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
      rpcResult: 'is_last_slot',
    });
    mockAuth();
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await deleteSlot('slot-1');

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
    // The status guard is re-checked in the UPDATE predicate itself.
    const eqCalls = client.calls.filter((c) => c.op === 'eq');
    expect(eqCalls.some((c) => c.args?.[0] === 'status' && c.args?.[1] === 'pending')).toBe(true);
  });

  it('returns 409 when the slot dispatches between the status check and the update', async () => {
    const client = mockSlotsClient({
      slot: { id: 'slot-1', schedule_id: 's1', status: 'pending', topic: 'Old' },
      schedule: { id: 's1', user_id: USER_ID },
      updateConflict: true,
    });
    mockAuth();
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await patchSlot('slot-1', { topic: 'Novo tema' });

    expect(response.status).toBe(409);
  });

  it('uses the service client for OAuth callers (no cookie session)', async () => {
    const client = mockSlotsClient({
      slot: { id: 'slot-1', schedule_id: 's1', status: 'pending', topic: 'Old' },
      schedule: { id: 's1', user_id: USER_ID },
    });
    mockOAuthAuth();
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await patchSlot('slot-1', { topic: 'Novo tema' });

    expect(response.status).toBe(200);
    expect(createSupabaseServiceClient).toHaveBeenCalled();
    expect(createSupabaseServerClient).not.toHaveBeenCalled();
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

//---------------
// GET /api/schedule/slots/[slotId] — one post's full detail (slot +
// schedule + persona) with the same presentation contract as
// /api/schedule/status (pending→awaiting, live engine progress). A
// 404 covers unknown ids AND other users' slots.
//---------------

const SLOT_DETAIL_ROW = {
  id: 'slot-1',
  schedule_id: 's1',
  slot_at: '2030-06-01T10:00:00.000Z',
  status: 'pending',
  topic: 'Next big thing',
  error: null,
  published_at: null,
  task_id: null,
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
};

describe('GET /api/schedule/slots/[slotId]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('MONEYPRINT_API_URL', 'https://engine.test');
    vi.stubEnv('MONEYPRINT_API_SECRET', 'secret');
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
      params: Promise.resolve({ slotId: 'slot-1' }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      success: boolean;
      slot: Record<string, unknown>;
      schedule: Record<string, unknown>;
      persona: { id: string; name: string };
    };
    expect(body.success).toBe(true);
    expect(body.slot).toMatchObject({
      id: 'slot-1',
      scheduleId: 's1',
      slotAt: '2030-06-01T10:00:00.000Z',
      status: 'awaiting',
      topic: 'Next big thing',
      taskId: null,
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

  it('skips the persona lookup for a slot on a persona-less schedule', async () => {
    // No persona is a real state (a post created without one, migration
    // 012): the route must not issue `.eq('id', null)` and log a spurious
    // failure on every request.
    const client = mockSlotsClient({
      slot: SLOT_DETAIL_ROW,
      schedule: { ...SCHEDULE_ROW, persona_id: null },
      persona: null,
    });
    mockAuth();
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await GET(new Request('https://example.com/api/schedule/slots/slot-1'), {
      params: Promise.resolve({ slotId: 'slot-1' }),
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
    // The persona name is cosmetic on the detail page: a failed lookup
    // degrades to null, but never silently.
    const { logger } = await import('@/lib/logger');
    const client = mockSlotsClient({
      slot: SLOT_DETAIL_ROW,
      schedule: SCHEDULE_ROW,
      personaError: { code: 'XX000', message: 'connection reset' },
    });
    mockAuth();
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await GET(new Request('https://example.com/api/schedule/slots/slot-1'), {
      params: Promise.resolve({ slotId: 'slot-1' }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { success: boolean; persona: unknown };
    expect(body.success).toBe(true);
    expect(body.persona).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(
      '[api/schedule/slots] persona lookup failed',
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
      params: Promise.resolve({ slotId: 'slot-1' }),
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
      params: Promise.resolve({ slotId: 'slot-1' }),
    });

    expect(response.status).toBe(429);
  });

  it('enriches a generating slot with live engine progress', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ body: { progress: 62, stage: 'lipsync' } }) })),
    );
    const client = mockSlotsClient({
      slot: { ...SLOT_DETAIL_ROW, status: 'generating', task_id: 'task-1' },
      schedule: SCHEDULE_ROW,
      persona: { id: 'p1', name: 'Viva Leve' },
    });
    mockAuth();
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await GET(new Request('https://example.com/api/schedule/slots/slot-1'), {
      params: Promise.resolve({ slotId: 'slot-1' }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { slot: { progress: number; stage: string | null } };
    expect(body.slot.progress).toBe(62);
    expect(body.slot.stage).toBe('lipsync');
  });

  it('returns 404 for another user’s slot without leaking the row', async () => {
    // The ownership probe reads the slot by (id, user_id); a foreign slot
    // resolves no schedule row the caller owns → 404, never the row.
    const client = mockSlotsClient({
      slot: { ...SLOT_DETAIL_ROW, user_id: 'someone-else' },
      schedule: null,
      persona: { id: 'p1', name: 'Viva Leve' },
    });
    mockAuth();
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await GET(new Request('https://example.com/api/schedule/slots/slot-1'), {
      params: Promise.resolve({ slotId: 'slot-1' }),
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
      params: Promise.resolve({ slotId: 'slot-1' }),
    });

    expect(response.status).toBe(401);
  });

  it('returns the recorded progress history with the slot', async () => {
    const client = mockSlotsClient({
      slot: SLOT_DETAIL_ROW,
      schedule: SCHEDULE_ROW,
      persona: { id: 'p1', name: 'Viva Leve' },
      history: [
        { progress: 40, stage: 'subtitle', recorded_at: '2026-10-05T22:10:00.000Z' },
        { progress: 50, stage: 'materials', recorded_at: '2026-10-05T22:12:00.000Z' },
      ],
    });
    mockAuth();
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await GET(new Request('https://example.com/api/schedule/slots/slot-1'), {
      params: Promise.resolve({ slotId: 'slot-1' }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      slot: { progressHistory: { progress: number; stage: string | null; recordedAt: string }[] };
    };
    expect(body.slot.progressHistory).toEqual([
      { progress: 40, stage: 'subtitle', recordedAt: '2026-10-05T22:10:00.000Z' },
      { progress: 50, stage: 'materials', recordedAt: '2026-10-05T22:12:00.000Z' },
    ]);
    // The history lookup is scoped to the slot and its owner.
    const historyCalls = client.calls.filter((c) => c.table === 'scheduled_post_progress_history');
    expect(historyCalls.filter((c) => c.op === 'eq').map((c) => c.args)).toEqual([
      ['post_id', 'slot-1'],
      ['user_id', USER_ID],
    ]);
  });

  it('defaults progressHistory to [] when nothing was recorded', async () => {
    const client = mockSlotsClient({
      slot: SLOT_DETAIL_ROW,
      schedule: SCHEDULE_ROW,
      persona: { id: 'p1', name: 'Viva Leve' },
    });
    mockAuth();
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await GET(new Request('https://example.com/api/schedule/slots/slot-1'), {
      params: Promise.resolve({ slotId: 'slot-1' }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { slot: { progressHistory: unknown[] } };
    expect(body.slot.progressHistory).toEqual([]);
  });

  it('degrades to [] when the history lookup fails', async () => {
    const client = mockSlotsClient({
      slot: SLOT_DETAIL_ROW,
      schedule: SCHEDULE_ROW,
      persona: { id: 'p1', name: 'Viva Leve' },
      historyError: { message: 'db down' },
    });
    mockAuth();
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const response = await GET(new Request('https://example.com/api/schedule/slots/slot-1'), {
      params: Promise.resolve({ slotId: 'slot-1' }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { slot: { progressHistory: unknown[] } };
    expect(body.slot.progressHistory).toEqual([]);
  });
});

//---------------
// Published links — the engine records one publish_results entry per
// (provider, video) it published; the detail endpoint surfaces them so the
// user can open where the post actually went. Only a published slot is
// worth the engine round-trip: everything earlier has nothing to link to.
//---------------

describe('GET /api/schedule/slots/[slotId] published links', () => {
  const PUBLISHED_ROW = { ...SLOT_DETAIL_ROW, status: 'published', task_id: 'task-1' };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('MONEYPRINT_API_URL', 'https://engine.test');
    vi.stubEnv('MONEYPRINT_API_SECRET', 'secret');
    mockAuth();
  });

  function mockPublished(publishResults: unknown) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ body: { state: 2, progress: 100, publish_results: publishResults } }),
      })),
    );
    const client = mockSlotsClient({
      slot: PUBLISHED_ROW,
      schedule: SCHEDULE_ROW,
      persona: { id: 'p1', name: 'Viva Leve' },
    });
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);
  }

  async function getBody(): Promise<{ slot: { publishLinks: unknown } }> {
    const response = await GET(new Request('https://example.com/api/schedule/slots/slot-1'), {
      params: Promise.resolve({ slotId: 'slot-1' }),
    });
    expect(response.status).toBe(200);
    return (await response.json()) as { slot: { publishLinks: unknown } };
  }

  it('returns the provider links recorded by the engine', async () => {
    mockPublished([
      { provider: 'youtube', video: 'final-1.mp4', videoUrl: 'https://www.youtube.com/watch?v=abc' },
      { provider: 'instagram', video: 'final-1.mp4', permalink: 'https://www.instagram.com/p/xyz/' },
    ]);

    const body = await getBody();
    expect(body.slot.publishLinks).toEqual([
      { provider: 'youtube', url: 'https://www.youtube.com/watch?v=abc' },
      { provider: 'instagram', url: 'https://www.instagram.com/p/xyz/' },
    ]);
  });

  it('derives the Bluesky URL from the at:// record URI', async () => {
    mockPublished([
      { provider: 'bluesky', video: 'final-1.mp4', postId: 'at://did:plc:abc/app.bsky.feed.post/xyz' },
    ]);

    const body = await getBody();
    expect(body.slot.publishLinks).toEqual([
      { provider: 'bluesky', url: 'https://bsky.app/profile/did:plc:abc/post/xyz' },
    ]);
  });

  it('returns no links when the engine recorded none', async () => {
    mockPublished([]);

    const body = await getBody();
    expect(body.slot.publishLinks).toEqual([]);
  });

  it('drops a provider entry with no usable URL', async () => {
    mockPublished([{ provider: 'linkedin', video: 'final-1.mp4' }]);

    const body = await getBody();
    expect(body.slot.publishLinks).toEqual([]);
  });

  // A slot that never reached published has nothing to link to — the engine
  // round-trip would be a wasted request on every detail view.
  it('does not call the engine for a slot that is not published', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const client = mockSlotsClient({
      slot: { ...SLOT_DETAIL_ROW, status: 'awaiting', task_id: null },
      schedule: SCHEDULE_ROW,
      persona: { id: 'p1', name: 'Viva Leve' },
    });
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const body = await getBody();
    expect(body.slot.publishLinks).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // The post itself is already loaded and renderable — a failed engine
  // lookup must degrade to "no links", never a 404/500 on the detail page.
  it('degrades to no links when the engine lookup fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('engine down'); }));
    const client = mockSlotsClient({
      slot: PUBLISHED_ROW,
      schedule: SCHEDULE_ROW,
      persona: { id: 'p1', name: 'Viva Leve' },
    });
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const body = await getBody();
    expect(body.slot.publishLinks).toEqual([]);
  });

  it('has no links for a published slot with no engine task id', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const client = mockSlotsClient({
      slot: { ...SLOT_DETAIL_ROW, status: 'published', task_id: null },
      schedule: SCHEDULE_ROW,
      persona: { id: 'p1', name: 'Viva Leve' },
    });
    vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);

    const body = await getBody();
    expect(body.slot.publishLinks).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

//---------------
// GET failure logging — a DB outage must NEVER masquerade as "not
// found": PGRST116 (zero rows) is the only 404; anything else is a loud
// logger.error with the real error and a 500.
//---------------

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
      params: Promise.resolve({ slotId: 'slot-1' }),
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
      params: Promise.resolve({ slotId: 'slot-1' }),
    });

    expect(response.status).toBe(500);
    expect(logger.error).toHaveBeenCalledWith(
      '[api/schedule/slots] schedule lookup failed',
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
      params: Promise.resolve({ slotId: 'slot-1' }),
    });

    expect(response.status).toBe(404);
    expect(logger.error).not.toHaveBeenCalled();
  });
});
