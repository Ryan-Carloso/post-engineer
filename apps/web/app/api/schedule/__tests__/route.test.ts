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
import { getPostHogServer } from '@/lib/posthog-server';

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
    expect(body).toEqual({ success: true, cancelledSlotIds: [] });
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
    { id: 'slot-ready', status: 'ready' },
    { id: 'slot-pending', status: 'pending' },
    { id: 'slot-published', status: 'published' },
    { id: 'slot-failed', status: 'failed' },
    { id: 'slot-publishing', status: 'publishing' },
  ];

  it('deletes only pending and ready slots and reports the cancelled ids', async () => {
    const db = mockSupabase({ scheduleSlots: MIXED_SLOTS, remove: { error: null } });
    const res = await DELETE(new Request('http://localhost/api/schedule?id=11111111-1111-4111-8111-111111111111'));
    expect(res.status).toBe(200);
    expect(db.rpcCalls).toEqual([]);
    expect(db.deleteCalls.map((call) => call.table)).toEqual(['scheduled_posts', 'schedules']);
  });

  it('removes stored images of cancelled image slots, and only those', async () => {
    const db = mockSupabase({
      scheduleSlots: [
        { id: 'slot-img', status: 'ready', media_kind: 'image', media_ref: 'scheduled-media/user-1/a.jpg' },
        { id: 'slot-vid', status: 'ready', media_kind: null, media_ref: null },
        { id: 'slot-pub-img', status: 'published', media_kind: 'image', media_ref: 'scheduled-media/user-1/keep.jpg' },
      ],
      remove: { error: null },
    });
    const res = await DELETE(new Request('http://localhost/api/schedule?id=11111111-1111-4111-8111-111111111111'));
    expect(res.status).toBe(200);
    expect(db.removedStoragePaths).toEqual(['scheduled-media/user-1/a.jpg']);
    expect(db.slotSelectArgs.every((arg) => arg.includes('media_kind') && arg.includes('media_ref'))).toBe(true);
  });

  it('does not delete the schedule when the slot delete fails', async () => {
    const db = mockSupabase({
      scheduleSlots: [{ id: 'slot-g', status: 'ready' }],
      slotDeleteError: { message: 'slot delete down' },
    });
    const res = await DELETE(new Request('http://localhost/api/schedule?id=11111111-1111-4111-8111-111111111111'));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Failed to cancel unpublished slots.');
    expect(db.deleteCalls.map((call) => call.table)).toEqual(['scheduled_posts']);
    expect(db.rpcCalls).toEqual([]);
  });

  it('stops before any delete when the slot list cannot be read', async () => {
    const db = mockSupabase({
      scheduleSlots: [{ id: 'slot-g', status: 'ready' }],
      slotsError: { message: 'select down' },
    });
    const res = await DELETE(new Request('http://localhost/api/schedule?id=11111111-1111-4111-8111-111111111111'));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Failed to list schedule slots.');
    expect(db.deleteCalls).toEqual([]);
    expect(db.slotDeleteFilters).toEqual([]);
  });

  it('still removes orphan slots when the schedule row is already gone', async () => {
    const db = mockSupabase({
      scheduleSlots: [{ id: 'slot-g', status: 'pending' }],
    });
    const res = await DELETE(new Request('http://localhost/api/schedule?id=88888888-8888-4888-8888-888888888888'));
    expect(res.status).toBe(200);
    expect(db.deleteCalls.map((call) => call.table)).toEqual(['scheduled_posts', 'schedules']);
  });

  it('reports a schedule-row delete failure after the slots are already gone', async () => {
    const db = mockSupabase({
      scheduleSlots: [{ id: 'slot-g', status: 'pending' }],
      remove: { error: { message: 'schedule delete down' } },
    });
    const res = await DELETE(new Request('http://localhost/api/schedule?id=11111111-1111-4111-8111-111111111111'));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Unpublished slots were removed but the schedule could not be deleted.');
    expect(db.deleteCalls.map((call) => call.table)).toEqual(['scheduled_posts', 'schedules']);
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
    expect(JSON.stringify(client.captureAs.mock.calls)).not.toContain('not-a-real-token');
  });

});
