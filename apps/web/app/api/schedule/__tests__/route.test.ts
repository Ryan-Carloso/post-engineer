import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

vi.mock('@/lib/rate-limit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/rate-limit')>()),
  applyRateLimit: vi.fn(async () => null),
}));
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
}));
vi.mock('@/lib/supabase/service', () => ({
  createSupabaseServiceClient: vi.fn(),
}));
vi.mock('@/lib/request-auth', () => ({
  requireSupabaseSession: vi.fn(),
  engineAuthHeaders: vi.fn(() => ({ authorization: 'Bearer test-engine-secret', 'x-user-id': 'test-user' })),
}));
vi.mock('@/lib/logger', () => ({
  logger: {
    warn: vi.fn(() => 'test-warn-id'),
    error: vi.fn(() => 'test-error-id'),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));
vi.mock('@/lib/analytics', () => ({
  trackApiEvent: vi.fn(),
}));
vi.mock('@/lib/posthog-server', () => ({
  getPostHogServer: vi.fn(),
}));

import * as scheduleRoute from '../route';
import { GET, DELETE } from '../route';
import { CancelScheduleResponseSchema, ListSchedulesResponseSchema } from '@/lib/contracts/schedule';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { requireSupabaseSession } from '@/lib/request-auth';
import { logger } from '@/lib/logger';
import { trackApiEvent } from '@/lib/analytics';
import { getPostHogServer } from '@/lib/posthog-server';
import { ENGINE_CANCEL_BUDGET_MS } from '@/lib/engine-tasks';

const USER_ID = 'user-1';

function scheduleRow(id: string, persona_id: string | null) {
  return {
    id,
    persona_id,
    providers: ['youtube'],
    youtube_account_ids: ['yt-1'],
    instagram_account_ids: [],
    linkedin_account_ids: [],
    bluesky_account_ids: [],
    threads_account_ids: [],
    facebook_account_ids: [],
    pinterest_account_ids: [],
    pinterest_board_id: null,
    threespeak_account_ids: [],
    rumble_account_ids: [],
    fanvue_account_ids: [],
    telegram_account_ids: [],
    days_of_week: [1, 3, 5],
    start_hour: 9,
    end_hour: 17,
    posts_per_day: 2,
    timezone: 'Europe/Lisbon',
    active: true,
    created_at: '2026-10-01T00:00:00Z',
    publish_mode: 'scheduled',
  };
}

function mockPostHog() {
  const client = {
    capture: vi.fn(),
    captureAs: vi.fn(),
    captureException: vi.fn(),
    captureExceptionAs: vi.fn(),
  };
  vi.mocked(getPostHogServer).mockReturnValue(client);
  return client;
}

function refundIssuedCalls(client: { captureAs: ReturnType<typeof vi.fn> }): [string, string, Record<string, unknown>][] {
  return client.captureAs.mock.calls.filter(
    (call) => call[1] === 'refund_issued',
  ) as [string, string, Record<string, unknown>][];
}

function mockSupabase(handlers: {
  list?: { data: unknown; error: unknown };
  persona?: { data: unknown };
  existing?: { data: unknown };
  accounts?: { data: unknown; error: unknown };
  accountsByProvider?: Record<string, unknown[]>;
  insert?: { data: unknown; error: unknown };
  current?: { data: unknown; error?: unknown };
  update?: { error: unknown };
  remove?: { error: unknown };
  deleteError?: unknown;
  noSession?: boolean;
  rpc?: {
    spend?: { data: unknown; error: unknown };
    grant?: { data: unknown; error: unknown };
    refund?: { data: unknown; error: unknown };
    refundBatch?: { data: unknown; error: unknown };
  };
  slotsInsert?: { error?: unknown; returnedRows?: Record<string, unknown>[] };
  scheduleSlots?: (Record<string, unknown> | null)[];
  slotsError?: unknown;
  remainingSlotsError?: unknown;
  slotDeleteError?: unknown;
  storageRemoveError?: unknown;
}) {
  const insertedRows: Record<string, unknown>[] = [];
  const updatedRows: Record<string, unknown>[] = [];
  const slotRows: Record<string, unknown>[] = [];
  const sentSlotRows: Record<string, unknown>[] = [];
  const deleteCalls: { table: string }[] = [];
  const rpcCalls: { name: string; params: unknown }[] = [];
  const selectArgs: string[] = [];
  const slotSelectArgs: string[] = [];
  const slotDeleteFilters: Record<string, unknown>[] = [];
  const removedStoragePaths: string[] = [];
  let slotReads = 0;
  let liveSlots: (Record<string, unknown> | null)[] = Array.isArray(handlers.scheduleSlots)
    ? handlers.scheduleSlots.map((row) => (row === null ? null : { ...row }))
    : [];
  const client = {
    storage: {
      from: vi.fn(() => ({
        remove: vi.fn(async (paths: string[]) => {
          removedStoragePaths.push(...paths);
          return { error: handlers.storageRemoveError ?? null };
        }),
      })),
    },
    auth: {
      getUser: vi.fn(async () =>
        handlers.noSession
          ? { data: { user: null }, error: null }
          : { data: { user: { id: USER_ID } }, error: null },
      ),
    },
    rpc: vi.fn(async (name: string, params: unknown) => {
      rpcCalls.push({ name, params });
      if (name === 'spend_tokens')
        return handlers.rpc?.spend ?? { data: { spent: true, balance: 100 }, error: null };
      if (name === 'grant_signup_bonus')
        return handlers.rpc?.grant ?? { data: {}, error: null };
      if (name === 'refund_generation_tokens')
        return handlers.rpc?.refund ?? { data: { refunded: true }, error: null };
      if (name === 'refund_batch_tokens')
        return handlers.rpc?.refundBatch ?? { data: { refunded: true }, error: null };
      return { data: null, error: null };
    }),
    from: vi.fn((table: string) => {
      if (table === 'personas') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue(handlers.persona ?? { data: null }),
        };
      }
      if (table === 'social_accounts') {
        let providerFilter = '';
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn(function (this: unknown, col: string, val: unknown) {
            if (col === 'provider') providerFilter = String(val);
            return this;
          }),
          in: vi.fn(async () =>
            handlers.accountsByProvider
              ? { data: handlers.accountsByProvider[providerFilter] ?? [], error: null }
              : handlers.accounts ?? { data: [], error: null },
          ),
        };
      }
      if (table === 'scheduled_posts') {
        return {
          insert: vi.fn((rows: Record<string, unknown>[]) => {
            sentSlotRows.push(...rows);
            const withIds = rows.map((row, index) => ({ ...row, id: `db-slot-${index + 1}` }));
            slotRows.push(...withIds);
            const result = handlers.slotsInsert?.error
              ? { data: null, error: handlers.slotsInsert.error }
              : { data: handlers.slotsInsert?.returnedRows ?? withIds, error: null };
            return {
              select: vi.fn((cols: string) => {
                slotSelectArgs.push(String(cols));
                return Promise.resolve(result);
              }),
            };
          }),
          select: vi.fn((cols: string) => {
            slotSelectArgs.push(String(cols));
            return {
              eq: vi.fn(() => ({
                eq: vi.fn(async () => {
                  slotReads += 1;
                  if (slotReads === 1 && handlers.slotsError) {
                    return { data: null, error: handlers.slotsError };
                  }
                  if (slotReads > 1 && handlers.remainingSlotsError) {
                    return { data: null, error: handlers.remainingSlotsError };
                  }
                  return { data: liveSlots.map((row) => ({ ...row })), error: null };
                }),
              })),
            };
          }),
          delete: vi.fn(() => {
            deleteCalls.push({ table: 'scheduled_posts' });
            const filters: Record<string, unknown> = {};
            const builder = {
              eq: vi.fn((col: string, val: unknown) => {
                filters[col] = val;
                return builder;
              }),
              in: vi.fn(async (col: string, vals: unknown) => {
                const recorded = { ...filters, [col]: vals };
                slotDeleteFilters.push(recorded);
                if (handlers.slotDeleteError) return { error: handlers.slotDeleteError };
                if (col === 'status' && Array.isArray(vals)) {
                  const drop = new Set(vals.map((value) => String(value)));
                  liveSlots = liveSlots.filter((row) => {
                    if (typeof row !== 'object' || row === null) return true;
                    return !drop.has(String(row.status));
                  });
                }
                return { error: null };
              }),
            };
            return builder;
          }),
        };
      }
      const afterSelect = {
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue(handlers.list ?? { data: [], error: null }),
        maybeSingle: vi.fn(async () => {
          return handlers.existing ?? { data: null, error: null };
        }),
        single: vi.fn().mockResolvedValue(
          handlers.current ??
            handlers.insert ?? { data: null, error: { message: 'no insert handler' } },
        ),
      };
      return {
        select: vi.fn((arg: string) => {
          selectArgs.push(String(arg));
          return afterSelect;
        }),
        insert: vi.fn((arg: Record<string, unknown>) => {
          insertedRows.push(arg);
          return { select: vi.fn(() => afterSelect) };
        }),
        update: vi.fn((arg: Record<string, unknown>) => {
          updatedRows.push(arg);
          return {
            eq: vi.fn(() => ({
              eq: vi.fn(() => Promise.resolve({ error: handlers.update?.error ?? null })),
            })),
          };
        }),
        delete: vi.fn(() => {
          deleteCalls.push({ table: 'schedules' });
          return {
            eq: vi.fn(() => ({
              eq: vi.fn(() => Promise.resolve({ error: handlers.remove?.error ?? null })),
            })),
          };
        }),
      };
    }),
  };
  vi.mocked(createSupabaseServerClient).mockResolvedValue(client as never);
  vi.mocked(requireSupabaseSession).mockResolvedValue({
    auth: { userId: USER_ID, accessToken: 'cookie-token' },
    error: null,
  });
  vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);
  return Object.assign(client, {
    insertedRows,
    updatedRows,
    slotRows,
    sentSlotRows,
    slotSelectArgs,
    slotDeleteFilters,
    removedStoragePaths,
    deleteCalls,
    rpcCalls,
    selectArgs,
  });
}

describe('/api/schedule HTTP surface', () => {
  it('handles GET, DELETE and nothing else', () => {
    const handlers = Object.keys(scheduleRoute).filter((name) => /^(GET|POST|PUT|PATCH|DELETE)$/.test(name));
    expect(handlers.sort()).toEqual(['DELETE', 'GET']);
  });
});

describe('/api/schedule', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GET returns 401 without a session', async () => {
    mockSupabase({ noSession: true });
    vi.mocked(requireSupabaseSession).mockResolvedValue({
      auth: null,
      error: NextResponse.json({ success: false }, { status: 401 }),
    });
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it('GET lists the user schedules', async () => {
    mockSupabase({ list: { data: [scheduleRow('s-1', 'persona-123')], error: null } });
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(ListSchedulesResponseSchema.safeParse(body).success).toBe(true);
    expect((body as { schedules: unknown[] }).schedules).toHaveLength(1);
  });

  it('GET returns an empty list when the query returns no rows', async () => {
    mockSupabase({ list: { data: null, error: null } });
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { schedules: unknown[] };
    expect(body.schedules).toEqual([]);
  });


















  it('GET includes bluesky_account_ids in the select', async () => {
    const db = mockSupabase({ list: { data: [], error: null } });
    await GET();
    expect(db.selectArgs.some((arg) => arg.includes('bluesky_account_ids'))).toBe(true);
  });

  it('GET includes publish_mode in the select', async () => {
    const db = mockSupabase({ list: { data: [], error: null } });
    await GET();
    expect(db.selectArgs.some((arg) => arg.includes('publish_mode'))).toBe(true);
  });











  it('DELETE removes by id', async () => {
    const db = mockSupabase({ remove: { error: null } });
    const res = await DELETE(new Request('http://localhost/api/schedule?id=11111111-1111-4111-8111-111111111111'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(CancelScheduleResponseSchema.safeParse(body).success).toBe(true);
    expect(body).toEqual({ success: true, cancelledSlotIds: [], refunds: [], batchDiscountWithheld: 0 });
    expect(db.deleteCalls.map((call) => call.table)).toEqual(['scheduled_posts', 'schedules']);
  });

  it('DELETE without id returns 400', async () => {
    mockSupabase({});
    const res = await DELETE(new Request('http://localhost/api/schedule'));
    expect(res.status).toBe(400);
  });

  it('DELETE returns 404 for a non-UUID schedule id without touching the database', async () => {
    const db = mockSupabase({ remove: { error: null } });
    vi.mocked(requireSupabaseSession).mockResolvedValue({
      auth: {
        userId: USER_ID,
        accessToken: 'pe_live_scoped',
        isApiKey: true,
        keyId: 'key-scoped',
        personaIds: ['p-allowed'],
      },
      error: null,
    } as never);
    const res = await DELETE(new Request('http://localhost/api/schedule?id=ca192c1b'));
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Schedule not found.');
    expect(db.deleteCalls).toEqual([]);
    expect(db.selectArgs).toEqual([]);
    expect(db.slotSelectArgs).toEqual([]);
  });

  it('GET returns 500 when the list query fails', async () => {
    mockSupabase({ list: { data: null, error: { message: 'list down' } } });
    const res = await GET();
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Failed to list schedules.');
  });

  it('DELETE returns the auth error without touching the schedule', async () => {
    const db = mockSupabase({});
    vi.mocked(requireSupabaseSession).mockResolvedValue({
      auth: null,
      error: NextResponse.json({ success: false }, { status: 401 }),
    });
    const res = await DELETE(new Request('http://localhost/api/schedule?id=11111111-1111-4111-8111-111111111111'));
    expect(res.status).toBe(401);
    expect(db.deleteCalls).toEqual([]);
  });
});

describe('/api/schedule persona scoping (scoped API keys)', () => {
  const SCOPED_AUTH = {
    auth: {
      userId: USER_ID,
      accessToken: 'pe_live_scoped',
      isApiKey: true,
      keyId: 'key-scoped',
      personaIds: ['p-allowed'],
    },
    error: null,
  };

  function scopedSupabase(handlers: Parameters<typeof mockSupabase>[0]): void {
    mockSupabase(handlers);
    vi.mocked(requireSupabaseSession).mockResolvedValue(SCOPED_AUTH as never);
  }

  it('GET lists only schedules whose persona is in scope', async () => {
    scopedSupabase({
      list: {
        data: [scheduleRow('s-1', 'p-allowed'), scheduleRow('s-2', 'p-other')],
        error: null,
      },
    });
    const res = await GET(new Request('http://localhost/api/schedule'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { schedules: { id: string }[] };
    expect(body.schedules.map((s) => s.id)).toEqual(['s-1']);
  });

  it('GET with a browser session still lists every schedule', async () => {
    mockSupabase({
      list: {
        data: [scheduleRow('s-1', 'p-allowed'), scheduleRow('s-2', 'p-other')],
        error: null,
      },
    });
    const res = await GET(new Request('http://localhost/api/schedule'));
    const body = (await res.json()) as { schedules: { id: string }[] };
    expect(body.schedules.map((s) => s.id)).toEqual(['s-1', 's-2']);
  });




  it('GET lists a persona-less schedule for a scoped key', async () => {
    scopedSupabase({
      list: {
        data: [scheduleRow('s-1', 'p-allowed'), scheduleRow('s-2', 'p-other'), scheduleRow('s-3', null)],
        error: null,
      },
    });
    const res = await GET(new Request('http://localhost/api/schedule'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { schedules: { id: string }[] };
    expect(body.schedules.map((s) => s.id)).toEqual(['s-1', 's-3']);
  });

  it('DELETE removes a persona-less schedule for a scoped key', async () => {
    scopedSupabase({
      current: { data: { persona_id: null } },
      remove: { error: null },
    });
    const res = await DELETE(new Request('http://localhost/api/schedule?id=33333333-3333-4333-8333-333333333333', { method: 'DELETE' }));
    expect(res.status).toBe(200);
  });

  it('DELETE rejects an out-of-scope schedule with 403', async () => {
    scopedSupabase({
      current: { data: { persona_id: 'p-other' } },
      remove: { error: null },
    });
    const res = await DELETE(new Request('http://localhost/api/schedule?id=22222222-2222-4222-8222-222222222222', { method: 'DELETE' }));
    expect(res.status).toBe(403);
  });

  it('DELETE removes an in-scope schedule', async () => {
    scopedSupabase({
      current: { data: { persona_id: 'p-allowed' } },
      remove: { error: null },
    });
    const res = await DELETE(new Request('http://localhost/api/schedule?id=11111111-1111-4111-8111-111111111111', { method: 'DELETE' }));
    expect(res.status).toBe(200);
  });

  it('DELETE returns 404 for a missing schedule', async () => {
    scopedSupabase({
      current: { data: null },
      remove: { error: null },
    });
    const res = await DELETE(new Request('http://localhost/api/schedule?id=99999999-9999-4999-8999-999999999999', { method: 'DELETE' }));
    expect(res.status).toBe(404);
  });

  it('DELETE returns 500 when the scope lookup fails for a reason other than not found', async () => {
    const db = mockSupabase({
      current: { data: null, error: { code: '57014', message: 'timeout' } },
    });
    vi.mocked(requireSupabaseSession).mockResolvedValue(SCOPED_AUTH as never);
    const res = await DELETE(new Request('http://localhost/api/schedule?id=11111111-1111-4111-8111-111111111111', { method: 'DELETE' }));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Failed to fetch schedule.');
    expect(db.deleteCalls).toEqual([]);
  });
});

describe('DELETE /api/schedule cancels unpublished slots', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const MIXED_SLOTS = [
    { id: 'slot-generating', status: 'generating', charged_tokens: 2, task_id: 'task-g' },
    { id: 'slot-ready', status: 'ready', charged_tokens: 2, task_id: 'task-r' },
    { id: 'slot-pending', status: 'pending', charged_tokens: 2, task_id: null },
    { id: 'slot-published', status: 'published', charged_tokens: 2, task_id: 'task-pub' },
    { id: 'slot-failed', status: 'failed', charged_tokens: 2, task_id: null },
    { id: 'slot-publishing', status: 'publishing', charged_tokens: 2, task_id: 'task-ing' },
  ];

  function refundCalls(db: { rpcCalls: { name: string; params: unknown }[] }): Record<string, unknown>[] {
    return db.rpcCalls
      .filter((call) => call.name === 'refund_batch_tokens')
      .map((call) => call.params as Record<string, unknown>);
  }

  it('deletes pending, generating, and ready slots but refunds only the pending one', async () => {
    const db = mockSupabase({
      scheduleSlots: MIXED_SLOTS,
      remove: { error: null },
    });
    const res = await DELETE(new Request('http://localhost/api/schedule?id=11111111-1111-4111-8111-111111111111'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      cancelledSlotIds: string[];
      refunds: { slotId: string; refunded: boolean; alreadyRefunded: boolean; reason: string }[];
    };
    expect(body.success).toBe(true);
    expect(body.cancelledSlotIds).toEqual(['slot-generating', 'slot-ready', 'slot-pending']);
    expect(body.refunds).toEqual([
      { slotId: 'slot-generating', refunded: false, alreadyRefunded: false, reason: 'already_generated' },
      { slotId: 'slot-ready', refunded: false, alreadyRefunded: false, reason: 'already_generated' },
      { slotId: 'slot-pending', refunded: true, alreadyRefunded: false, reason: 'not_generated' },
    ]);
    expect(db.slotDeleteFilters).toEqual([
      {
        schedule_id: '11111111-1111-4111-8111-111111111111',
        user_id: USER_ID,
        status: ['pending', 'generating', 'ready'],
      },
    ]);
    expect(db.deleteCalls.map((call) => call.table)).toEqual(['scheduled_posts', 'schedules']);
    const refunds = refundCalls(db);
    expect(refunds.map((params) => params.p_refund_key)).toEqual(['batch:11111111-1111-4111-8111-111111111111:slot:slot-pending']);
    expect(refunds.map((params) => params.p_amount)).toEqual([2]);
    expect(refunds.map((params) => params.p_engine_task_id)).toEqual([null]);
    expect(refunds.every((params) => params.p_batch_generation_id === 'batch:11111111-1111-4111-8111-111111111111')).toBe(true);
    expect(refunds.every((params) => params.p_user_id === USER_ID)).toBe(true);
    expect(refunds.every((params) => params.p_reason === 'Schedule cancelled before publish; video refunded')).toBe(true);
    expect(logger.error).not.toHaveBeenCalledWith(
      '[api/schedule] cancel refund failed',
      expect.anything(),
      expect.anything(),
    );
  });

  it('refunds the stored charged_tokens, never a recomputed list price', async () => {
    const db = mockSupabase({
      scheduleSlots: [
        { id: 'slot-full', status: 'pending', faceless: false, full_lipsync: true, charged_tokens: 7, task_id: null },
      ],
      remove: { error: null },
    });
    const res = await DELETE(new Request('http://localhost/api/schedule?id=11111111-1111-4111-8111-111111111111'));
    expect(res.status).toBe(200);
    expect(refundCalls(db).map((params) => params.p_amount)).toEqual([7]);
    expect(db.slotSelectArgs.every((arg) => arg.includes('charged_tokens'))).toBe(true);
  });

  it('removes stored images of cancelled image slots, and only those', async () => {
    const db = mockSupabase({
      scheduleSlots: [
        { id: 'slot-img', status: 'ready', charged_tokens: 0, task_id: null, media_kind: 'image', media_ref: 'scheduled-media/user-1/a.jpg' },
        { id: 'slot-vid', status: 'ready', charged_tokens: 0, task_id: 'task-r', media_kind: null, media_ref: null },
        { id: 'slot-pub-img', status: 'published', charged_tokens: 0, task_id: null, media_kind: 'image', media_ref: 'scheduled-media/user-1/keep.jpg' },
      ],
      remove: { error: null },
    });
    const res = await DELETE(new Request('http://localhost/api/schedule?id=11111111-1111-4111-8111-111111111111'));
    expect(res.status).toBe(200);
    expect(db.removedStoragePaths).toEqual(['scheduled-media/user-1/a.jpg']);
    expect(db.slotSelectArgs.every((arg) => arg.includes('media_kind') && arg.includes('media_ref'))).toBe(true);
  });

  it('cancels a free slot (charged 0) without calling the refund RPC', async () => {
    const db = mockSupabase({
      scheduleSlots: [
        { id: 'slot-free', status: 'pending', charged_tokens: 0, task_id: null },
        { id: 'slot-paid', status: 'pending', charged_tokens: 3, task_id: null },
      ],
    });
    const res = await DELETE(new Request('http://localhost/api/schedule?id=11111111-1111-4111-8111-111111111111'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      cancelledSlotIds: string[];
      refunds: { slotId: string; refunded: boolean; alreadyRefunded: boolean; reason: string }[];
    };
    expect(body.cancelledSlotIds).toEqual(['slot-free', 'slot-paid']);
    expect(body.refunds).toEqual([
      { slotId: 'slot-free', refunded: false, alreadyRefunded: false, reason: 'not_charged' },
      { slotId: 'slot-paid', refunded: true, alreadyRefunded: false, reason: 'not_generated' },
    ]);
    expect(refundCalls(db).map((params) => params.p_refund_key)).toEqual(['batch:11111111-1111-4111-8111-111111111111:slot:slot-paid']);
  });

  it('treats an already-refunded slot as success', async () => {
    mockSupabase({
      scheduleSlots: [{ id: 'slot-g', status: 'pending', charged_tokens: 2, task_id: null }],
      rpc: { refundBatch: { data: { refunded: false, already_refunded: true }, error: null } },
    });
    const res = await DELETE(new Request('http://localhost/api/schedule?id=11111111-1111-4111-8111-111111111111'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { refunds: { refunded: boolean; alreadyRefunded: boolean; reason: string }[] };
    expect(body.refunds).toEqual([{ slotId: 'slot-g', refunded: false, alreadyRefunded: true, reason: 'already_refunded' }]);
    expect(logger.error).not.toHaveBeenCalledWith(
      '[api/schedule] cancel refund failed',
      expect.anything(),
      expect.anything(),
    );
  });

  it('logs a soft refund failure and still deletes the schedule', async () => {
    const db = mockSupabase({
      scheduleSlots: [{ id: 'slot-g', status: 'pending', charged_tokens: 2, task_id: null }],
      rpc: { refundBatch: { data: { refunded: false, already_refunded: false }, error: null } },
    });
    const res = await DELETE(new Request('http://localhost/api/schedule?id=11111111-1111-4111-8111-111111111111'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { refunds: { refunded: boolean; alreadyRefunded: boolean; reason: string }[] };
    expect(body.refunds).toEqual([{ slotId: 'slot-g', refunded: false, alreadyRefunded: false, reason: 'refund_failed' }]);
    expect(logger.error).toHaveBeenCalledWith(
      '[api/schedule] cancel refund failed',
      { refunded: false, already_refunded: false },
      expect.objectContaining({ scheduleId: '11111111-1111-4111-8111-111111111111', slotId: 'slot-g', userId: USER_ID }),
    );
    expect(db.deleteCalls.map((call) => call.table)).toContain('schedules');
  });

  it('does not delete the schedule when the slot delete fails', async () => {
    const db = mockSupabase({
      scheduleSlots: [{ id: 'slot-g', status: 'generating', charged_tokens: 2, task_id: 'task-g' }],
      slotDeleteError: { message: 'slot delete down' },
    });
    const res = await DELETE(new Request('http://localhost/api/schedule?id=11111111-1111-4111-8111-111111111111'));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Failed to cancel unpublished slots.');
    expect(db.deleteCalls.map((call) => call.table)).toEqual(['scheduled_posts']);
    expect(refundCalls(db)).toEqual([]);
  });

  it('stops before any delete when the slot list cannot be read', async () => {
    const db = mockSupabase({
      scheduleSlots: [{ id: 'slot-g', status: 'generating', charged_tokens: 2, task_id: 'task-g' }],
      slotsError: { message: 'select down' },
    });
    const res = await DELETE(new Request('http://localhost/api/schedule?id=11111111-1111-4111-8111-111111111111'));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Failed to list schedule slots.');
    expect(db.deleteCalls).toEqual([]);
    expect(db.slotDeleteFilters).toEqual([]);
  });

  it('skips refunds when the post-delete re-read fails', async () => {
    const db = mockSupabase({
      scheduleSlots: [{ id: 'slot-g', status: 'generating', charged_tokens: 2, task_id: 'task-g' }],
      remainingSlotsError: { message: 'reread down' },
    });
    const res = await DELETE(new Request('http://localhost/api/schedule?id=11111111-1111-4111-8111-111111111111'));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe(
      'Unpublished slots were removed but could not be confirmed, so prepaid tokens were not refunded.',
    );
    expect(refundCalls(db)).toEqual([]);
    expect(db.deleteCalls.map((call) => call.table)).toEqual(['scheduled_posts']);
    expect(logger.error).toHaveBeenCalledWith(
      '[api/schedule] cancel could not re-read slots after delete; refunds skipped',
      { message: 'reread down' },
      expect.objectContaining({ scheduleId: '11111111-1111-4111-8111-111111111111', userId: USER_ID }),
    );
  });

  it('never reads the schedule row to price a refund', async () => {
    const db = mockSupabase({
      scheduleSlots: [{ id: 'slot-g', status: 'generating', charged_tokens: 2, task_id: 'task-g' }],
    });
    const res = await DELETE(new Request('http://localhost/api/schedule?id=11111111-1111-4111-8111-111111111111'));
    expect(res.status).toBe(200);
    expect(db.selectArgs).toEqual([]);
  });

  it('still removes orphan slots when the schedule row is already gone', async () => {
    const db = mockSupabase({
      scheduleSlots: [{ id: 'slot-g', status: 'pending', charged_tokens: 2, task_id: null }],
    });
    const res = await DELETE(new Request('http://localhost/api/schedule?id=88888888-8888-4888-8888-888888888888'));
    expect(res.status).toBe(200);
    expect(refundCalls(db).map((params) => params.p_amount)).toEqual([2]);
    expect(refundCalls(db).map((params) => params.p_batch_generation_id)).toEqual(['batch:88888888-8888-4888-8888-888888888888']);
  });

  it('skips slot rows that cannot be read and still refunds the readable ones', async () => {
    const db = mockSupabase({
      scheduleSlots: [
        null,
        { id: '', status: 'generating', charged_tokens: 2, task_id: 'task-empty' },
        { id: 'slot-bad-status', charged_tokens: 2, task_id: 'task-x' },
        { id: 'slot-bad-task', status: 'generating', charged_tokens: 2, task_id: 12 },
        { id: 'slot-no-charge', status: 'generating', task_id: 'task-nc' },
        { id: 'slot-negative-charge', status: 'generating', charged_tokens: -1, task_id: 'task-neg' },
        { id: 'slot-fractional-charge', status: 'generating', charged_tokens: 1.5, task_id: 'task-frac' },
        { id: 'slot-text-charge', status: 'generating', charged_tokens: '2', task_id: 'task-text' },
        { id: 'slot-good', status: 'pending', charged_tokens: 2, task_id: null },
      ],
    });
    const res = await DELETE(new Request('http://localhost/api/schedule?id=11111111-1111-4111-8111-111111111111'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { cancelledSlotIds: string[] };
    expect(body.cancelledSlotIds).toEqual(['slot-good']);
    expect(refundCalls(db).map((params) => params.p_amount)).toEqual([2]);
    expect(logger.error).toHaveBeenCalledWith(
      '[api/schedule] cancel skipped a slot row that could not be read',
      expect.objectContaining({ scheduleId: '11111111-1111-4111-8111-111111111111', userId: USER_ID }),
    );
  });

  it('logs an RPC refund error and still deletes the schedule', async () => {
    const db = mockSupabase({
      scheduleSlots: [{ id: 'slot-g', status: 'pending', charged_tokens: 2, task_id: null }],
      rpc: { refundBatch: { data: null, error: { message: 'rpc down' } } },
    });
    const res = await DELETE(new Request('http://localhost/api/schedule?id=11111111-1111-4111-8111-111111111111'));
    expect(res.status).toBe(200);
    expect(logger.error).toHaveBeenCalledWith(
      '[api/schedule] cancel refund failed',
      { message: 'rpc down' },
      expect.objectContaining({ scheduleId: '11111111-1111-4111-8111-111111111111', slotId: 'slot-g', userId: USER_ID }),
    );
    expect(db.deleteCalls.map((call) => call.table)).toContain('schedules');
  });

  it('reports a schedule-row delete failure after the slots are already gone', async () => {
    const db = mockSupabase({
      scheduleSlots: [{ id: 'slot-g', status: 'pending', charged_tokens: 2, task_id: null }],
      remove: { error: { message: 'schedule delete down' } },
    });
    const res = await DELETE(new Request('http://localhost/api/schedule?id=11111111-1111-4111-8111-111111111111'));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Unpublished slots were removed but the schedule could not be deleted.');
    expect(refundCalls(db)).toHaveLength(1);
    expect(db.deleteCalls.map((call) => call.table)).toEqual(['scheduled_posts', 'schedules']);
  });

  it('emits refund_issued only for slots whose generation never ran', async () => {
    const client = mockPostHog();
    mockSupabase({
      scheduleSlots: MIXED_SLOTS,
      remove: { error: null },
    });
    const res = await DELETE(new Request('http://localhost/api/schedule?id=11111111-1111-4111-8111-111111111111'));
    expect(res.status).toBe(200);
    await vi.waitFor(() => expect(refundIssuedCalls(client)).toHaveLength(1));
    expect(refundIssuedCalls(client).map(([, , props]) => props.slot_id)).toEqual(['slot-pending']);
    for (const [, , props] of refundIssuedCalls(client)) {
      expect(props).toMatchObject({
        kind: 'schedule_cancelled',
        amount: 2,
        reason: 'Schedule cancelled before publish; video refunded',
        batch_generation_id: 'batch:11111111-1111-4111-8111-111111111111',
        schedule_id: '11111111-1111-4111-8111-111111111111',
      });
    }
    expect(refundIssuedCalls(client).map(([, , props]) => props.engine_task_id)).toEqual([null]);
  });

  it('does not refund a pending slot that already carries a task_id', async () => {
    const client = mockPostHog();
    const db = mockSupabase({
      scheduleSlots: [{ id: 'slot-p', status: 'pending', charged_tokens: 2, task_id: 'task-p' }],
      remove: { error: null },
    });
    const res = await DELETE(new Request('http://localhost/api/schedule?id=11111111-1111-4111-8111-111111111111'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      refunds: { slotId: string; refunded: boolean; alreadyRefunded: boolean; reason: string }[];
    };
    expect(body.refunds).toEqual([
      { slotId: 'slot-p', refunded: false, alreadyRefunded: false, reason: 'already_generated' },
    ]);
    expect(refundCalls(db)).toEqual([]);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(refundIssuedCalls(client)).toEqual([]);
  });

  it('does not emit refund_issued for an already-refunded slot', async () => {
    const client = mockPostHog();
    mockSupabase({
      scheduleSlots: [{ id: 'slot-g', status: 'pending', charged_tokens: 2, task_id: null }],
      rpc: { refundBatch: { data: { refunded: false, already_refunded: true }, error: null } },
    });
    const res = await DELETE(new Request('http://localhost/api/schedule?id=11111111-1111-4111-8111-111111111111'));
    expect(res.status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(refundIssuedCalls(client)).toEqual([]);
  });

  it('does not emit refund_issued when the refund RPC fails', async () => {
    const client = mockPostHog();
    mockSupabase({
      scheduleSlots: [{ id: 'slot-g', status: 'pending', charged_tokens: 2, task_id: null }],
      rpc: { refundBatch: { data: { refunded: false, already_refunded: false }, error: null } },
    });
    const res = await DELETE(new Request('http://localhost/api/schedule?id=11111111-1111-4111-8111-111111111111'));
    expect(res.status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(refundIssuedCalls(client)).toEqual([]);
  });

  it('schedule_deleted carries the schedule id and refunded token total', async () => {
    const client = mockPostHog();
    mockSupabase({
      scheduleSlots: MIXED_SLOTS,
      remove: { error: null },
    });
    const res = await DELETE(new Request('http://localhost/api/schedule?id=11111111-1111-4111-8111-111111111111'));
    expect(res.status).toBe(200);
    await vi.waitFor(() =>
      expect(client.captureAs).toHaveBeenCalledWith(
        USER_ID,
        'schedule_deleted',
        expect.objectContaining({ scheduleId: '11111111-1111-4111-8111-111111111111', refunded: 2 }),
      ),
    );
  });

  it('a credential-shaped schedule id never reaches PostHog', async () => {
    const client = mockPostHog();
    const db = mockSupabase({
      scheduleSlots: MIXED_SLOTS,
      remove: { error: null },
    });
    const res = await DELETE(
      new Request('http://localhost/api/schedule?id=Bearer%20not-a-real-token'),
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Schedule not found.');
    expect(db.deleteCalls).toEqual([]);
    expect(refundIssuedCalls(client)).toEqual([]);
    expect(JSON.stringify(client.captureAs.mock.calls)).not.toContain('not-a-real-token');
  });

  it('emits cancel_refund_skipped when the post-delete re-read fails', async () => {
    mockSupabase({
      scheduleSlots: [{ id: 'slot-g', status: 'generating', charged_tokens: 2, task_id: 'task-g' }],
      remainingSlotsError: { message: 'reread down' },
    });
    const res = await DELETE(new Request('http://localhost/api/schedule?id=11111111-1111-4111-8111-111111111111'));
    expect(res.status).toBe(500);
    expect(vi.mocked(trackApiEvent)).toHaveBeenCalledWith('cancel_refund_skipped', {
      scheduleId: '11111111-1111-4111-8111-111111111111',
      reason: 'slots_reread_failed',
      userId: USER_ID,
    });
  });

  it('signals the engine to cancel generating slots', async () => {
    vi.stubEnv('MONEYPRINT_API_URL', 'https://engine.test');
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      mockSupabase({
        scheduleSlots: MIXED_SLOTS,
        remove: { error: null },
      });
      const res = await DELETE(new Request('http://localhost/api/schedule?id=11111111-1111-4111-8111-111111111111'));
      expect(res.status).toBe(200);
      const calls = fetchMock.mock.calls.map((call: unknown[]) => ({
        url: String(call[0]),
        method: (call[1] as RequestInit | undefined)?.method,
      }));
      expect(calls).toEqual([
        { url: 'https://engine.test/api/v1/tasks/task-g', method: 'DELETE' },
      ]);
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });

  it('still refunds when the engine cancel call fails', async () => {
    vi.stubEnv('MONEYPRINT_API_URL', 'https://engine.test');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('engine down'); }));
    try {
      const db = mockSupabase({
        scheduleSlots: [
          { id: 'slot-g', status: 'generating', charged_tokens: 2, task_id: 'task-g' },
          { id: 'slot-n', status: 'pending', charged_tokens: 3, task_id: null },
        ],
        remove: { error: null },
      });
      const res = await DELETE(new Request('http://localhost/api/schedule?id=11111111-1111-4111-8111-111111111111'));
      expect(res.status).toBe(200);
      const body = (await res.json()) as { cancelledSlotIds: string[] };
      expect(body.cancelledSlotIds).toEqual(['slot-g', 'slot-n']);
      expect(refundCalls(db).map((params) => params.p_amount)).toEqual([3]);
      expect(logger.error).toHaveBeenCalledWith(
        '[api/schedule] engine cancel failed',
        expect.anything(),
        expect.objectContaining({ scheduleId: '11111111-1111-4111-8111-111111111111', slotId: 'slot-g', userId: USER_ID }),
      );
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });

  it('does not let a hung engine cancel block refunds beyond the budget', async () => {
    vi.stubEnv('MONEYPRINT_API_URL', 'https://engine.test');
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: unknown, init?: { signal?: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(new DOMException('The operation was aborted.', 'AbortError')),
            );
          }),
      ),
    );
    vi.useFakeTimers();
    try {
      const db = mockSupabase({
        scheduleSlots: [
          { id: 'slot-g1', status: 'generating', charged_tokens: 2, task_id: 'task-g1' },
          { id: 'slot-g2', status: 'generating', charged_tokens: 2, task_id: 'task-g2' },
          { id: 'slot-n', status: 'pending', charged_tokens: 3, task_id: null },
        ],
        remove: { error: null },
      });
      let settled = false;
      const pending = DELETE(new Request('http://localhost/api/schedule?id=11111111-1111-4111-8111-111111111111')).then((res) => {
        settled = true;
        return res;
      });
      await vi.advanceTimersByTimeAsync(ENGINE_CANCEL_BUDGET_MS + 100);
      expect(settled).toBe(true);
      const res = await pending;
      expect(res.status).toBe(200);
      expect(refundCalls(db).map((params) => params.p_amount)).toEqual([3]);
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });

  it('cancels generating slots concurrently', async () => {
    vi.stubEnv('MONEYPRINT_API_URL', 'https://engine.test');
    const started: string[] = [];
    const resolvers: (() => void)[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (url: string) =>
          new Promise((resolve) => {
            started.push(url);
            resolvers.push(() => resolve({ ok: true, status: 200 }));
          }),
      ),
    );
    try {
      mockSupabase({
        scheduleSlots: [
          { id: 'slot-g1', status: 'generating', charged_tokens: 2, task_id: 'task-g1' },
          { id: 'slot-g2', status: 'generating', charged_tokens: 2, task_id: 'task-g2' },
          { id: 'slot-g3', status: 'generating', charged_tokens: 2, task_id: 'task-g3' },
        ],
        remove: { error: null },
      });
      const pending = DELETE(new Request('http://localhost/api/schedule?id=11111111-1111-4111-8111-111111111111'));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(started.sort()).toEqual([
        'https://engine.test/api/v1/tasks/task-g1',
        'https://engine.test/api/v1/tasks/task-g2',
        'https://engine.test/api/v1/tasks/task-g3',
      ]);
      for (const resolve of resolvers) resolve();
      const res = await pending;
      expect(res.status).toBe(200);
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });
});
