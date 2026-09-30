import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextResponse } from 'next/server';

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
}));
vi.mock('@/lib/supabase/service', () => ({
  createSupabaseServiceClient: vi.fn(),
}));
vi.mock('@/lib/request-auth', () => ({
  requireSupabaseSession: vi.fn(),
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

import { GET, POST, PATCH, DELETE } from '../route';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { requireSupabaseSession } from '@/lib/request-auth';
import { logger } from '@/lib/logger';
import { trackApiEvent } from '@/lib/analytics';

const USER_ID = 'user-1';

//---------------
// mockSupabase — per-table builder, distinguishing each route flow:
// list (GET), persona (ownership check), existing (duplicate schedule),
// insert, update and delete.
//---------------
function mockSupabase(handlers: {
  list?: { data: unknown; error: unknown };
  persona?: { data: unknown };
  existing?: { data: unknown };
  accounts?: { data: unknown; error: unknown };
  // Filtered by the .eq('provider', ...) the route applies per network.
  accountsByProvider?: Record<string, unknown[]>;
  insert?: { data: unknown; error: unknown };
  // Current schedule row (used by PATCH for the partial merge).
  current?: { data: unknown };
  update?: { error: unknown };
  remove?: { error: unknown };
  deleteError?: unknown;
  noSession?: boolean;
  rpc?: {
    spend?: { data: unknown; error: unknown };
    grant?: { data: unknown; error: unknown };
    refund?: { data: unknown; error: unknown };
  };
  slotsInsert?: { error?: unknown; returnedRows?: Record<string, unknown>[] };
}) {
  const insertedRows: Record<string, unknown>[] = [];
  const updatedRows: Record<string, unknown>[] = [];
  const slotRows: Record<string, unknown>[] = [];
  const sentSlotRows: Record<string, unknown>[] = [];
  const deleteCalls: { table: string }[] = [];
  const rpcCalls: { name: string; params: unknown }[] = [];
  const selectArgs: string[] = [];
  // Column list requested by the scheduled_posts insert's .select() —
  // pins that the route reads back id, topic AND slot_at (MINOR 7).
  const slotSelectArgs: string[] = [];
  const client = {
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
      // scheduled_posts — slots created by POST (one row per video).
      // scheduled_posts.id is database-generated: the mock assigns ids
      // itself, like the real table, and records exactly what the route
      // sent in sentSlotRows.
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
          delete: vi.fn(() => {
            deleteCalls.push({ table: 'scheduled_posts' });
            return {
              eq: vi.fn(() => ({
                eq: vi.fn(() => Promise.resolve({ error: handlers.deleteError ?? null })),
              })),
            };
          }),
        };
      }
      // schedules — a distinct flow per operation
      const afterSelect = {
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue(handlers.list ?? { data: [], error: null }),
        maybeSingle: vi.fn().mockResolvedValue(handlers.existing ?? { data: null }),
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
        // update/delete end in .eq().eq() → completion promise
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
  return Object.assign(client, { insertedRows, updatedRows, slotRows, sentSlotRows, slotSelectArgs, deleteCalls, rpcCalls, selectArgs });
}

function jsonRequest(body: unknown, method = 'PATCH'): Request {
  return new Request('http://localhost/api/schedule', { method, body: JSON.stringify(body) });
}

//---------------
// One-off POST body — recurring fields (daysOfWeek/startHour/endHour) no
// longer exist; POST is one-off-only since PR #21.
//---------------
const validOneOffBody = {
  personaId: 'p-1',
  providers: ['youtube'],
  youtubeAccountIds: ['yt-1', 'yt-2'],
  scheduledAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
  postsPerDay: 1,
  topics: ['Launch video'],
  timezone: 'America/Sao_Paulo',
};

function oneOffSupabase(dbHandlers: Parameters<typeof mockSupabase>[0]) {
  return mockSupabase({
    persona: { data: { id: 'p-1', face_mix_percent: 50, face_quality: 'ok' } },
    existing: { data: null },
    insert: { data: { id: 's-1', active: true }, error: null },
    accounts: { data: [{ provider_account_id: 'yt-1' }, { provider_account_id: 'yt-2' }], error: null },
    ...dbHandlers,
  });
}

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
    mockSupabase({ list: { data: [{ id: 's-1' }], error: null } });
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { schedules: unknown[] };
    expect(body.schedules).toHaveLength(1);
  });

  it('POST creates a valid one-off schedule', async () => {
    oneOffSupabase({});
    const res = await POST(jsonRequest(validOneOffBody, 'POST'));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { success: boolean; schedule: { id: string } };
    expect(body.success).toBe(true);
    expect(body.schedule.id).toBe('s-1');
  });

  it('POST persists scheduled_at and ignores recurring fields (PR #21)', async () => {
    const db = oneOffSupabase({});
    const res = await POST(jsonRequest({
      ...validOneOffBody,
      daysOfWeek: [1, 3, 5],
      startHour: 9,
      endHour: 18,
    }, 'POST'));
    expect(res.status).toBe(201);
    expect(db.insertedRows[0]).toMatchObject({
      user_id: USER_ID,
      persona_id: 'p-1',
      scheduled_at: validOneOffBody.scheduledAt,
      days_of_week: null,
      start_hour: null,
      end_hour: null,
      active: true,
    });
  });

  it('POST persists times when sent', async () => {
    const db = oneOffSupabase({});
    const res = await POST(jsonRequest({ ...validOneOffBody, postsPerDay: 3, topics: ['t1', 't2', 't3'], times: ['08:15', '12:45', '20:00'] }, 'POST'));
    expect(res.status).toBe(201);
    expect(db.insertedRows[0].times).toEqual(['08:15', '12:45', '20:00']);
  });

  it('POST without times persists an empty array', async () => {
    const db = oneOffSupabase({});
    const res = await POST(jsonRequest(validOneOffBody, 'POST'));
    expect(res.status).toBe(201);
    expect(db.insertedRows[0].times).toEqual([]);
  });

  it('POST rejects times with an invalid format', async () => {
    oneOffSupabase({});
    const res = await POST(jsonRequest({ ...validOneOffBody, times: ['9h', '25:00'] }, 'POST'));
    expect(res.status).toBe(400);
  });

  it('POST rejects times whose length differs from the topics count', async () => {
    oneOffSupabase({});
    const res = await POST(jsonRequest({ ...validOneOffBody, topics: ['t1'], times: ['09:00', '12:00', '18:00'] }, 'POST'));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/times.*topic/i);
  });

  it('POST rejects multiple topics without times', async () => {
    oneOffSupabase({});
    const res = await POST(jsonRequest({ ...validOneOffBody, postsPerDay: 2, topics: ['t1', 't2'] }, 'POST'));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/times/i);
  });

  it('POST without scheduledAt returns 400 (recurrence removed in PR #21)', async () => {
    mockSupabase({});
    const { scheduledAt: _ignored, ...noDate } = validOneOffBody;
    const res = await POST(jsonRequest(noDate, 'POST'));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/scheduledAt is required/i);
  });

  it('POST rejects scheduledAt less than 24h ahead', async () => {
    mockSupabase({});
    const tooSoon = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    const res = await POST(jsonRequest({ ...validOneOffBody, scheduledAt: tooSoon }, 'POST'));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/at least 24 hours/i);
  });

  it('POST rejects scheduledAt beyond 30 days', async () => {
    mockSupabase({});
    const tooFar = new Date(Date.now() + 31 * 24 * 60 * 60 * 1000).toISOString();
    const res = await POST(jsonRequest({ ...validOneOffBody, scheduledAt: tooFar }, 'POST'));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/more than 30 days/i);
  });

  it('POST rejects scheduledAt with an invalid format', async () => {
    mockSupabase({});
    const res = await POST(jsonRequest({ ...validOneOffBody, scheduledAt: 'not-a-date' }, 'POST'));
    expect(res.status).toBe(400);
  });

  it('POST returns 401 without a session', async () => {
    mockSupabase({ noSession: true });
    vi.mocked(requireSupabaseSession).mockResolvedValue({
      auth: null,
      error: NextResponse.json({ success: false }, { status: 401 }),
    });
    const res = await POST(jsonRequest(validOneOffBody, 'POST'));
    expect(res.status).toBe(401);
  });

  it('POST with invalid JSON returns 400', async () => {
    mockSupabase({});
    const res = await POST(new Request('http://localhost/api/schedule', { method: 'POST', body: '{invalid' }));
    expect(res.status).toBe(400);
  });

  it('POST without personaId returns 400', async () => {
    mockSupabase({});
    const res = await POST(jsonRequest({ ...validOneOffBody, personaId: undefined }, 'POST'));
    expect(res.status).toBe(400);
  });

  it('POST rejects an invalid provider', async () => {
    mockSupabase({});
    const res = await POST(jsonRequest({ ...validOneOffBody, providers: ['tiktok'] }, 'POST'));
    expect(res.status).toBe(400);
  });

  it('POST requires an account for the selected provider (bluesky without accounts → 400)', async () => {
    oneOffSupabase({});
    const res = await POST(jsonRequest({
      ...validOneOffBody,
      providers: ['bluesky'],
      blueskyAccountIds: [],
    }, 'POST'));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/blueskyAccountIds/i);
  });

  it('POST creates a schedule with the bluesky provider and persists bluesky_account_ids', async () => {
    const db = oneOffSupabase({
      accountsByProvider: {
        youtube: [{ provider_account_id: 'yt-1' }, { provider_account_id: 'yt-2' }],
        bluesky: [{ provider_account_id: 'did:plc:abc' }],
      },
    });
    const res = await POST(jsonRequest({
      ...validOneOffBody,
      providers: ['youtube', 'bluesky'],
      blueskyAccountIds: ['did:plc:abc'],
    }, 'POST'));
    expect(res.status).toBe(201);
    expect(db.insertedRows[0]).toMatchObject({
      bluesky_account_ids: ['did:plc:abc'],
      providers: ['youtube', 'bluesky'],
    });
  });

  it('POST rejects another user account', async () => {
    oneOffSupabase({
      accountsByProvider: { youtube: [{ provider_account_id: 'yt-1' }, { provider_account_id: 'yt-2' }] },
    });
    const res = await POST(jsonRequest({
      ...validOneOffBody,
      youtubeAccountIds: ['yt-outro'],
    }, 'POST'));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/Invalid youtube account selection/);
  });

  it('POST returns 404 when the persona is not the user\'s', async () => {
    oneOffSupabase({ persona: { data: null } });
    const res = await POST(jsonRequest(validOneOffBody, 'POST'));
    expect(res.status).toBe(404);
  });

  it('POST allows several schedules for the same persona', async () => {
    const db = oneOffSupabase({ existing: { data: { id: 's-0' } } });
    const res = await POST(jsonRequest(validOneOffBody, 'POST'));
    expect(res.status).toBe(201);
    expect(db.insertedRows).toHaveLength(1);
  });

  it('POST returns 500 when the insert fails', async () => {
    oneOffSupabase({ insert: { data: null, error: { message: 'boom' } } });
    const res = await POST(jsonRequest(validOneOffBody, 'POST'));
    expect(res.status).toBe(500);
  });






  it('PATCH updates times', async () => {
    const db = mockSupabase({
      list: { data: [], error: null },
      current: { data: { posts_per_day: 2 } },
      update: { error: null },
    });
    const res = await PATCH(jsonRequest({ id: 's-1', times: ['07:00'] }, 'PATCH'));
    expect(res.status).toBe(200);
    expect(db.updatedRows[0].times).toEqual(['07:00']);
  });

  it('PATCH rejects invalid times', async () => {
    mockSupabase({ list: { data: [], error: null }, update: { error: null } });
    const res = await PATCH(jsonRequest({ id: 's-1', times: ['bad'] }, 'PATCH'));
    expect(res.status).toBe(400);
  });
















  it('GET includes bluesky_account_ids in the select', async () => {
    const db = mockSupabase({ list: { data: [], error: null } });
    await GET();
    expect(db.selectArgs.some((arg) => arg.includes('bluesky_account_ids'))).toBe(true);
  });

  it('PATCH linkedinAccountIds updates the column and recalculates providers', async () => {
    const db = mockSupabase({
      current: {
        data: { youtube_account_ids: ['yt-1'], instagram_account_ids: ['ig-1'], linkedin_account_ids: [] },
      },
      accountsByProvider: {
        instagram: [{ provider_account_id: 'ig-1' }],
        linkedin: [{ provider_account_id: 'urn:li:organization:9' }],
      },
      update: { error: null },
    });
    const res = await PATCH(jsonRequest({
      id: 's-1',
      youtubeAccountIds: [],
      linkedinAccountIds: ['urn:li:organization:9'],
    }, 'PATCH'));
    expect(res.status).toBe(200);
    expect(db.updatedRows[0]).toMatchObject({
      youtube_account_ids: [],
      instagram_account_ids: ['ig-1'],
      linkedin_account_ids: ['urn:li:organization:9'],
      providers: ['instagram', 'linkedin'],
    });
  });

  it('PATCH blueskyAccountIds updates the column and recalculates providers', async () => {
    const db = mockSupabase({
      current: {
        data: { youtube_account_ids: ['yt-1'], instagram_account_ids: [], linkedin_account_ids: [], bluesky_account_ids: [] },
      },
      accountsByProvider: {
        bluesky: [{ provider_account_id: 'did:plc:abc' }],
      },
      update: { error: null },
    });
    const res = await PATCH(jsonRequest({
      id: 's-1',
      youtubeAccountIds: [],
      blueskyAccountIds: ['did:plc:abc'],
    }, 'PATCH'));
    expect(res.status).toBe(200);
    expect(db.updatedRows[0]).toMatchObject({
      youtube_account_ids: [],
      instagram_account_ids: [],
      linkedin_account_ids: [],
      bluesky_account_ids: ['did:plc:abc'],
      providers: ['bluesky'],
    });
  });

  it('PATCH partial preserves unsent bluesky accounts', async () => {
    const db = mockSupabase({
      current: {
        data: { youtube_account_ids: ['yt-1'], instagram_account_ids: [], linkedin_account_ids: [], bluesky_account_ids: ['did:plc:abc'] },
      },
      accountsByProvider: {
        youtube: [{ provider_account_id: 'yt-1' }],
        linkedin: [{ provider_account_id: 'urn:li:organization:9' }],
        bluesky: [{ provider_account_id: 'did:plc:abc' }],
      },
      update: { error: null },
    });
    const res = await PATCH(jsonRequest({
      id: 's-1',
      linkedinAccountIds: ['urn:li:organization:9'],
    }, 'PATCH'));
    expect(res.status).toBe(200);
    expect(db.updatedRows[0]).toMatchObject({
      youtube_account_ids: ['yt-1'],
      bluesky_account_ids: ['did:plc:abc'],
      linkedin_account_ids: ['urn:li:organization:9'],
      providers: ['youtube', 'linkedin', 'bluesky'],
    });
  });
  it('PATCH partial preserves unsent network accounts', async () => {
    const db = mockSupabase({
      current: {
        data: { youtube_account_ids: ['yt-1'], instagram_account_ids: ['ig-1'], linkedin_account_ids: [] },
      },
      accountsByProvider: {
        youtube: [{ provider_account_id: 'yt-1' }],
        instagram: [{ provider_account_id: 'ig-1' }],
        linkedin: [{ provider_account_id: 'urn:li:organization:9' }],
      },
      update: { error: null },
    });
    const res = await PATCH(jsonRequest({
      id: 's-1',
      linkedinAccountIds: ['urn:li:organization:9'],
    }, 'PATCH'));
    expect(res.status).toBe(200);
    expect(db.updatedRows[0]).toMatchObject({
      youtube_account_ids: ['yt-1'],
      instagram_account_ids: ['ig-1'],
      linkedin_account_ids: ['urn:li:organization:9'],
      providers: ['youtube', 'instagram', 'linkedin'],
    });
  });

  it('PATCH rejects another person\'s account (ownership validated on the final merge)', async () => {
    mockSupabase({
      current: {
        data: { youtube_account_ids: ['yt-1'], instagram_account_ids: [], linkedin_account_ids: [], bluesky_account_ids: [] },
      },
      accountsByProvider: {
        youtube: [{ provider_account_id: 'yt-1' }],
        bluesky: [],
      },
      update: { error: null },
    });
    const res = await PATCH(jsonRequest({
      id: 's-1',
      blueskyAccountIds: ['did:plc:outro'],
    }, 'PATCH'));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('Invalid bluesky account selection');
    // The hint must name the right field: a recordId-shaped id is the classic
    // mix-up with list_social_accounts (recordId vs did).
    expect(body.error).toContain('did');
    expect(body.error).toContain('recordId');
  });

  it('PATCH rejects a kept account that is no longer the user\'s', async () => {
    // Kept (not sent) fields are re-checked against social_accounts whenever
    // any account field is sent, so a revoked account cannot linger in the
    // merged selection.
    mockSupabase({
      current: {
        data: { youtube_account_ids: ['yt-1'], instagram_account_ids: [], linkedin_account_ids: [], bluesky_account_ids: [] },
      },
      accountsByProvider: {
        youtube: [],
      },
      update: { error: null },
    });
    const res = await PATCH(jsonRequest({ id: 's-1', active: true, blueskyAccountIds: [] }, 'PATCH'));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('Invalid youtube account selection');
    expect(body.error).toContain('channelId');
    expect(body.error).toContain('recordId');
  });

  it('PATCH returns 404 when the schedule does not exist', async () => {
    mockSupabase({});
    const res = await PATCH(jsonRequest({ id: 's-404', linkedinAccountIds: ['x'] }, 'PATCH'));
    expect(res.status).toBe(404);
  });



  it('PATCH with active=false pauses the schedule', async () => {
    mockSupabase({ update: { error: null } });
    const res = await PATCH(jsonRequest({ id: 's-1', active: false }, 'PATCH'));
    expect(res.status).toBe(200);
  });

  it('PATCH with nothing to update returns 400', async () => {
    mockSupabase({});
    const res = await PATCH(jsonRequest({ id: 's-1' }, 'PATCH'));
    expect(res.status).toBe(400);
  });

  it('DELETE removes by id', async () => {
    mockSupabase({ remove: { error: null } });
    const res = await DELETE(new Request('http://localhost/api/schedule?id=s-1'));
    expect(res.status).toBe(200);
  });

  it('DELETE without id returns 400', async () => {
    mockSupabase({});
    const res = await DELETE(new Request('http://localhost/api/schedule'));
    expect(res.status).toBe(400);
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
        data: [
          { id: 's-1', persona_id: 'p-allowed' },
          { id: 's-2', persona_id: 'p-other' },
        ],
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
        data: [
          { id: 's-1', persona_id: 'p-allowed' },
          { id: 's-2', persona_id: 'p-other' },
        ],
        error: null,
      },
    });
    const res = await GET(new Request('http://localhost/api/schedule'));
    const body = (await res.json()) as { schedules: { id: string }[] };
    expect(body.schedules.map((s) => s.id)).toEqual(['s-1', 's-2']);
  });

  it('POST rejects an out-of-scope persona with 403', async () => {
    scopedSupabase({
      persona: { data: { id: 'p-allowed' } },
    });
    const scheduledAt = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
    const res = await POST(jsonRequest({
      personaId: 'p-other',
      providers: ['youtube'],
      youtubeAccountIds: ['yt-1'],
      scheduledAt,
    }, 'POST'));
    expect(res.status).toBe(403);
  });

  it('PATCH rejects an out-of-scope schedule with 403', async () => {
    scopedSupabase({
      current: { data: { persona_id: 'p-other' } },
      update: { error: null },
    });
    const res = await PATCH(jsonRequest({ id: 's-2', active: false }, 'PATCH'));
    expect(res.status).toBe(403);
  });

  it('PATCH updates an in-scope schedule', async () => {
    scopedSupabase({
      current: { data: { persona_id: 'p-allowed' } },
      update: { error: null },
    });
    const res = await PATCH(jsonRequest({ id: 's-1', active: false }, 'PATCH'));
    expect(res.status).toBe(200);
  });

  it('PATCH returns 404 for a missing schedule', async () => {
    scopedSupabase({
      current: { data: null },
      update: { error: null },
    });
    const res = await PATCH(jsonRequest({ id: 's-missing', active: false }, 'PATCH'));
    expect(res.status).toBe(404);
  });

  it('DELETE rejects an out-of-scope schedule with 403', async () => {
    scopedSupabase({
      current: { data: { persona_id: 'p-other' } },
      remove: { error: null },
    });
    const res = await DELETE(new Request('http://localhost/api/schedule?id=s-2', { method: 'DELETE' }));
    expect(res.status).toBe(403);
  });

  it('DELETE removes an in-scope schedule', async () => {
    scopedSupabase({
      current: { data: { persona_id: 'p-allowed' } },
      remove: { error: null },
    });
    const res = await DELETE(new Request('http://localhost/api/schedule?id=s-1', { method: 'DELETE' }));
    expect(res.status).toBe(200);
  });

  it('DELETE returns 404 for a missing schedule', async () => {
    scopedSupabase({
      current: { data: null },
      remove: { error: null },
    });
    const res = await DELETE(new Request('http://localhost/api/schedule?id=s-missing', { method: 'DELETE' }));
    expect(res.status).toBe(404);
  });
});

//---------------
// Timezone-aware scheduledAt (fix 1b): a naive "2026-10-01T14:00:00" sent
// with timezone "Europe/Lisbon" must be stored as 14:00 in Lisbon
// (13:00Z in October), not as 14:00 UTC.
//---------------
function naiveWallClock(msFromNow: number, hh = 14, mm = 0): string {
  const d = new Date(Date.now() + msFromNow);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(hh)}:${p(mm)}:00`;
}

function wallClockIn(instant: string, tz: string): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(instant));
}

describe('POST /api/schedule timezone handling', () => {
  it('converts naive scheduledAt to the sent timezone instead of assuming UTC', async () => {
    const db = oneOffSupabase({});
    // America/Sao_Paulo is fixed UTC-3 (no DST): 14:00 wall clock is 17:00Z.
    const naive = naiveWallClock(3 * 86400000);
    const res = await POST(
      jsonRequest({ ...validOneOffBody, scheduledAt: naive, timezone: 'America/Sao_Paulo' }, 'POST'),
    );
    expect(res.status).toBe(201);
    const [datePart] = naive.split('T');
    expect(db.insertedRows[0]).toMatchObject({ scheduled_at: `${datePart}T17:00:00.000Z` });
  });

  it('preserves the wall clock in the sent timezone (reported-bug regression)', async () => {
    const db = oneOffSupabase({});
    const naive = naiveWallClock(3 * 86400000);
    const res = await POST(
      jsonRequest({ ...validOneOffBody, scheduledAt: naive, timezone: 'Europe/Lisbon' }, 'POST'),
    );
    expect(res.status).toBe(201);
    const stored = (db.insertedRows[0] as Record<string, unknown>).scheduled_at as string;
    const [datePart] = naive.split('T');
    expect(wallClockIn(stored, 'Europe/Lisbon')).toBe(`${datePart} 14:00`);
  });

  it('respects an explicit offset in scheduledAt, ignoring the timezone', async () => {
    const db = oneOffSupabase({});
    const res = await POST(
      jsonRequest(
        { ...validOneOffBody, scheduledAt: '2026-10-05T14:00:00+01:00', timezone: 'America/Sao_Paulo' },
        'POST',
      ),
    );
    expect(res.status).toBe(201);
    expect(db.insertedRows[0]).toMatchObject({ scheduled_at: '2026-10-05T13:00:00.000Z' });
  });

  it('rejects an invalid timezone with 400 without creating anything', async () => {
    const db = oneOffSupabase({});
    const res = await POST(
      jsonRequest({ ...validOneOffBody, timezone: 'Mars/Olympus' }, 'POST'),
    );
    expect(res.status).toBe(400);
    expect(db.insertedRows).toHaveLength(0);
  });

  it('validates the 24h window on the converted instant, not on the naive value', async () => {
    const db = oneOffSupabase({});
    // 23h out as a naive wall clock; in America/Sao_Paulo (-3) the real
    // instant is 26h out — inside the window. The old code (naive as UTC)
    // would reject it with 400.
    const naive = new Date(Date.now() + 23 * 3600000).toISOString().slice(0, 19);
    const res = await POST(
      jsonRequest({ ...validOneOffBody, scheduledAt: naive, timezone: 'America/Sao_Paulo' }, 'POST'),
    );
    expect(res.status).toBe(201);
    expect(db.insertedRows).toHaveLength(1);
  });

  it('rejects invalid scheduledAt with 400', async () => {
    const db = oneOffSupabase({});
    const res = await POST(
      jsonRequest({ ...validOneOffBody, scheduledAt: 'not-a-date' }, 'POST'),
    );
    expect(res.status).toBe(400);
    expect(db.insertedRows).toHaveLength(0);
  });
});

describe('POST /api/schedule topics → slots → charging', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates one scheduled_posts per topic, with topic persisted and status pending', async () => {
    const db = oneOffSupabase({});
    const res = await POST(
      jsonRequest(
        {
          ...validOneOffBody,
          postsPerDay: 2,
          topics: ['Morning video', 'Evening video'],
          times: ['09:00', '18:00'],
        },
        'POST',
      ),
    );
    expect(res.status).toBe(201);
    expect(db.slotRows).toHaveLength(2);
    expect(db.slotRows[0]).toMatchObject({ topic: 'Morning video', status: 'pending' });
    expect(db.slotRows[1]).toMatchObject({ topic: 'Evening video', status: 'pending' });
    // Slots land on the scheduledAt calendar date in the caller's timezone:
    // 09:00 America/Sao_Paulo (UTC-3) is 12:00Z on that date.
    const scheduledAt = new Date(validOneOffBody.scheduledAt);
    const datePart = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(scheduledAt);
    expect(db.slotRows[0]).toMatchObject({ slot_at: `${datePart}T12:00:00.000Z` });
    expect(db.slotRows[1]).toMatchObject({ slot_at: `${datePart}T21:00:00.000Z` });
  });

  it('returns the created slots (id, topic, slotAt) for progress polling', async () => {
    oneOffSupabase({});
    const res = await POST(
      jsonRequest(
        { ...validOneOffBody, postsPerDay: 2, topics: ['t1', 't2'], times: ['09:00', '18:00'] },
        'POST',
      ),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      success: boolean;
      schedule: { id: string };
      slots: { id: string; topic: string; slotAt: string; progress: number }[];
    };
    expect(body.success).toBe(true);
    expect(body.schedule.id).toBe('s-1');
    expect(body.slots).toHaveLength(2);
    expect(body.slots[0]).toMatchObject({ topic: 't1' });
    expect(typeof body.slots[0].id).toBe('string');
    expect(typeof body.slots[0].slotAt).toBe('string');
    // Slots are all awaiting at creation: progress starts at 0, stage is
    // null, and the queue position follows creation order.
    expect(body.slots[0]).toMatchObject({
      status: 'awaiting',
      progress: 0,
      stage: null,
      queuePosition: 1,
      queueTotal: 2,
      retryable: null,
    });
    expect(body.slots[1]).toMatchObject({ status: 'awaiting', queuePosition: 2, queueTotal: 2 });
  });

  it('reads back id, topic and slot_at for the inserted slots (never zips the insert payload)', async () => {
    const db = oneOffSupabase({});
    const res = await POST(
      jsonRequest(
        { ...validOneOffBody, postsPerDay: 1, topics: ['t1'], times: ['09:00'] },
        'POST',
      ),
    );
    expect(res.status).toBe(201);
    expect(db.slotSelectArgs).toContain('id, topic, slot_at');
  });

  it('builds the slots response from the returned rows only', async () => {
    // The database echoes back its own topic/slot_at values: if the route
    // zipped the insert payload with the returned ids, the response would
    // show the request values instead of these.
    const returnedRows = [
      { id: 'db-slot-9', topic: 'Stored A', slot_at: '2026-10-02T12:00:00.000Z', status: 'pending' },
      { id: 'db-slot-7', topic: 'Stored B', slot_at: '2026-10-02T18:00:00.000Z', status: 'pending' },
    ];
    oneOffSupabase({ slotsInsert: { returnedRows } });
    const res = await POST(
      jsonRequest(
        { ...validOneOffBody, postsPerDay: 2, topics: ['t1', 't2'], times: ['09:00', '18:00'] },
        'POST',
      ),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      slots: { id: string; topic: string; slotAt: string; queueTotal: number }[];
    };
    expect(body.slots).toHaveLength(2);
    expect(body.slots[0]).toMatchObject({
      id: 'db-slot-9',
      topic: 'Stored A',
      slotAt: '2026-10-02T12:00:00.000Z',
    });
    expect(body.slots[1]).toMatchObject({
      id: 'db-slot-7',
      topic: 'Stored B',
      slotAt: '2026-10-02T18:00:00.000Z',
    });
    expect(body.slots[0].queueTotal).toBe(2);
  });

  it('tracks schedule_created on success (2xx product analytics)', async () => {
    oneOffSupabase({});
    const res = await POST(
      jsonRequest(
        { ...validOneOffBody, postsPerDay: 2, topics: ['t1', 't2'], times: ['09:00', '18:00'] },
        'POST',
      ),
    );
    expect(res.status).toBe(201);
    expect(trackApiEvent).toHaveBeenCalledWith(
      'schedule_created',
      expect.objectContaining({ slots: 2, providers: 1, personaId: 'p-1' }),
    );
  });

  it('does not track schedule_created when creation fails', async () => {
    oneOffSupabase({ persona: { data: null } });
    const res = await POST(jsonRequest(validOneOffBody, 'POST'));
    expect(res.status).toBe(404);
    expect(trackApiEvent).not.toHaveBeenCalled();
  });

  it('rejects a missing topics with 400 without creating anything or spending tokens', async () => {
    const db = oneOffSupabase({});
    const { topics: _ignored, ...noTopics } = validOneOffBody;
    const res = await POST(jsonRequest(noTopics, 'POST'));
    expect(res.status).toBe(400);
    expect(db.insertedRows).toHaveLength(0);
    expect(db.slotRows).toHaveLength(0);
    expect(db.rpcCalls.filter((c) => c.name === 'spend_tokens')).toHaveLength(0);
  });

  it('rejects empty topics, more than 10, or blank strings', async () => {
    for (const topics of [[], Array.from({ length: 11 }, (_, i) => `t${i}`), ['ok', '  ']]) {
      const db = oneOffSupabase({});
      const res = await POST(
        jsonRequest({ ...validOneOffBody, postsPerDay: 1, topics }, 'POST'),
      );
      expect(res.status).toBe(400);
      expect(db.insertedRows).toHaveLength(0);
      expect(db.slotRows).toHaveLength(0);
    }
  });

  it('rejects postsPerDay different from the number of topics', async () => {
    const db = oneOffSupabase({});
    const res = await POST(
      jsonRequest({ ...validOneOffBody, postsPerDay: 2, topics: ['only-one'] }, 'POST'),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/postsPerDay/i);
    expect(db.insertedRows).toHaveLength(0);
  });

  it('charges the tokens upfront (fail-fast) before creating any row', async () => {
    const db = oneOffSupabase({});
    const res = await POST(
      jsonRequest(
        { ...validOneOffBody, postsPerDay: 2, topics: ['t1', 't2'], times: ['09:00', '18:00'] },
        'POST',
      ),
    );
    expect(res.status).toBe(201);
    const spend = db.rpcCalls.filter((c) => c.name === 'spend_tokens');
    expect(spend).toHaveLength(1);
    const params = spend[0].params as Record<string, unknown>;
    // face_mix 50% @ ok = 2 tokens/video × 2 videos; generation id reuses
    // the batch refund path in the engine.
    expect(params.p_amount).toBe(4);
    expect(params.p_generation_id).toMatch(/^batch:/);
  });

  it('insufficient balance → 400 INSUFFICIENT without creating schedule or slots', async () => {
    const db = oneOffSupabase({
      rpc: { spend: { data: { spent: false, balance: 1 }, error: null } },
    });
    const res = await POST(
      jsonRequest(
        { ...validOneOffBody, postsPerDay: 2, topics: ['t1', 't2'], times: ['09:00', '18:00'] },
        'POST',
      ),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; code: string; have: number; need: number };
    expect(body.code).toBe('INSUFFICIENT');
    expect(body.have).toBe(1);
    expect(body.need).toBe(4);
    expect(db.insertedRows).toHaveLength(0);
    expect(db.slotRows).toHaveLength(0);
  });

  it('slots insert failure → rollback (deletes schedule) and refund', async () => {
    const db = oneOffSupabase({ slotsInsert: { error: { message: 'slots boom' } } });
    const res = await POST(
      jsonRequest(
        { ...validOneOffBody, postsPerDay: 2, topics: ['t1', 't2'], times: ['09:00', '18:00'] },
        'POST',
      ),
    );
    expect(res.status).toBe(500);
    const refunds = db.rpcCalls.filter((c) => c.name === 'refund_generation_tokens');
    expect(refunds).toHaveLength(1);
    // The rollback deletes the partial slots and the already-created schedule.
    expect(db.deleteCalls.filter((c) => c.table === 'scheduled_posts')).toHaveLength(1);
    expect(db.deleteCalls.filter((c) => c.table === 'schedules')).toHaveLength(1);
  });

  it('schedule insert failure → refund without creating slots', async () => {
    const db = oneOffSupabase({ insert: { data: null, error: { message: 'boom' } } });
    const res = await POST(jsonRequest(validOneOffBody, 'POST'));
    expect(res.status).toBe(500);
    expect(db.slotRows).toHaveLength(0);
    const refunds = db.rpcCalls.filter((c) => c.name === 'refund_generation_tokens');
    expect(refunds).toHaveLength(1);
  });

  it('id select returns fewer rows than the insert → rollback (deletes schedule+slots) and refund', async () => {
    // The insert succeeds but the .select comes back short: same
    // compensating path as a failed insert — 500, both deletes, refund.
    const db = oneOffSupabase({ slotsInsert: { returnedRows: [{ id: 'db-slot-1' }] } });
    const res = await POST(
      jsonRequest(
        { ...validOneOffBody, postsPerDay: 2, topics: ['t1', 't2'], times: ['09:00', '18:00'] },
        'POST',
      ),
    );
    expect(res.status).toBe(500);
    const refunds = db.rpcCalls.filter((c) => c.name === 'refund_generation_tokens');
    expect(refunds).toHaveLength(1);
    expect(db.deleteCalls.filter((c) => c.table === 'scheduled_posts')).toHaveLength(1);
    expect(db.deleteCalls.filter((c) => c.table === 'schedules')).toHaveLength(1);

    // The mismatch logs a distinct message with observed vs expected counts,
    // not the generic 'slots insert failed' (which would imply a null error).
    const errorCalls = vi.mocked(logger.error).mock.calls;
    expect(errorCalls).toHaveLength(1);
    expect(errorCalls[0][0]).toContain('slots insert returned 1 ids for 2 rows');
  });

  it('rollback delete failure is logged loudly (not swallowed)', async () => {
    // If a compensating delete fails, the engine tick could pick up orphaned
    // pending slots. The failure must be visible in telemetry.
    oneOffSupabase({
      slotsInsert: { returnedRows: [{ id: 'db-slot-1' }] },
      deleteError: new Error('delete blocked'),
    });
    const res = await POST(
      jsonRequest(
        { ...validOneOffBody, postsPerDay: 2, topics: ['t1', 't2'], times: ['09:00', '18:00'] },
        'POST',
      ),
    );
    expect(res.status).toBe(500);
    const errorCalls = vi.mocked(logger.error).mock.calls;
    const rollbackLogs = errorCalls.filter((c) =>
      String(c[0]).includes('rollback deletes failed'),
    );
    expect(rollbackLogs).toHaveLength(1);
  });
});

describe('POST /api/schedule multi-day times (one request, several days)', () => {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const TZ = 'America/Sao_Paulo';

  //---------------
  // wallClockInSP — "YYYY-MM-DDTHH:MM:SS" wall clock in America/Sao_Paulo,
  // on the SP calendar date `msAhead` from now. Naive (no offset): the API
  // interprets it in the request's `timezone`.
  //---------------
  function wallClockInSP(msAhead: number, hhmm: string): string {
    const d = new Date(Date.now() + msAhead);
    const datePart = new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d);
    return `${datePart}T${hhmm}:00`;
  }

  // Expected UTC instant for a naive SP wall clock (SP has no DST: UTC-3).
  function spToUtcIso(wallClock: string): string {
    return new Date(`${wallClock}-03:00`).toISOString();
  }

  it('creates slots on different days in a single request', async () => {
    const db = oneOffSupabase({});
    const t1 = wallClockInSP(2 * DAY_MS, '15:00');
    const t2 = wallClockInSP(3 * DAY_MS, '10:30');
    const t3 = wallClockInSP(4 * DAY_MS, '20:00');
    const res = await POST(
      jsonRequest(
        {
          ...validOneOffBody,
          postsPerDay: 3,
          topics: ['Day 1 video', 'Day 2 video', 'Day 3 video'],
          times: [t1, t2, t3],
        },
        'POST',
      ),
    );
    expect(res.status).toBe(201);
    expect(db.slotRows).toHaveLength(3);
    expect(db.slotRows[0]).toMatchObject({ topic: 'Day 1 video', slot_at: spToUtcIso(t1), status: 'pending' });
    expect(db.slotRows[1]).toMatchObject({ topic: 'Day 2 video', slot_at: spToUtcIso(t2), status: 'pending' });
    expect(db.slotRows[2]).toMatchObject({ topic: 'Day 3 video', slot_at: spToUtcIso(t3), status: 'pending' });
    // The parent row persists the datetime strings as given.
    expect(db.insertedRows[0].times).toEqual([t1, t2, t3]);
    // All three videos are charged upfront.
    const spends = db.rpcCalls.filter((c) => c.name === 'spend_tokens');
    expect(spends).toHaveLength(1);
  });

  it('rejects datetime beyond 30 days naming the entry, without creating or spending', async () => {
    const db = oneOffSupabase({});
    const bad = wallClockInSP(40 * DAY_MS, '10:00');
    const res = await POST(
      jsonRequest(
        {
          ...validOneOffBody,
          postsPerDay: 2,
          topics: ['t1', 't2'],
          times: [wallClockInSP(2 * DAY_MS, '10:00'), bad],
        },
        'POST',
      ),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/times\[1\]/);
    expect(db.insertedRows).toHaveLength(0);
    expect(db.slotRows).toHaveLength(0);
    expect(db.rpcCalls.filter((c) => c.name === 'spend_tokens')).toHaveLength(0);
  });

  it('rejects datetime less than 24h ahead', async () => {
    const db = oneOffSupabase({});
    const soon = wallClockInSP(2 * 60 * 60 * 1000, '10:00');
    const res = await POST(
      jsonRequest({ ...validOneOffBody, times: [soon] }, 'POST'),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/times\[0\]/);
    expect(db.slotRows).toHaveLength(0);
  });

  it('persists kind=batch so the recurring partial unique index never blocks a second schedule', async () => {
    const db = oneOffSupabase({});
    const res = await POST(
      jsonRequest(
        {
          ...validOneOffBody,
          postsPerDay: 3,
          topics: ['Day 1 video', 'Day 2 video', 'Day 3 video'],
          times: [
            wallClockInSP(2 * DAY_MS, '15:00'),
            wallClockInSP(3 * DAY_MS, '10:30'),
            wallClockInSP(4 * DAY_MS, '20:00'),
          ],
        },
        'POST',
      ),
    );
    expect(res.status).toBe(201);
    // One-off rows must not fall back to the kind='recurring' default: the
    // partial unique index schedules_persona_owner_recurring would reject
    // the persona's second schedule with a 500 (PR #28 removed the 409
    // guard, but the DB guard still fires on the default).
    //
    // DB schema anchor: the `schedules.kind` CHECK constraint allows
    // ('recurring', 'batch') with a partial unique index
    // `schedules_persona_owner_recurring` on the 'recurring' rows.
    // (Applied manually in the Supabase dashboard SQL editor; the repo
    // tracks only persona-images.sql in-repo.)
    // The inserted literal must be one of those two values — and 'batch'
    // for one-off rows — or the insert fails at the database.
    const SCHEDULE_KIND_CHECK_VALUES = ['recurring', 'batch'] as const;
    const kind = (db.insertedRows[0] as Record<string, unknown>)['kind'];
    expect(SCHEDULE_KIND_CHECK_VALUES).toContain(kind);
    expect(db.insertedRows[0]).toMatchObject({ kind: 'batch' });
  });

  it('rejects a date without time as ambiguous', async () => {
    oneOffSupabase({});
    const res = await POST(
      jsonRequest({ ...validOneOffBody, times: ['2026-10-05'] }, 'POST'),
    );
    expect(res.status).toBe(400);
  });

  it('accepts an explicit offset in datetime', async () => {
    const db = oneOffSupabase({});
    // 15:00 at +01:00 is an explicit instant; the request timezone is ignored.
    const at = new Date(Date.now() + 3 * DAY_MS);
    const datePart = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(at);
    const withOffset = `${datePart}T15:00:00+01:00`;
    const res = await POST(
      jsonRequest({ ...validOneOffBody, times: [withOffset] }, 'POST'),
    );
    expect(res.status).toBe(201);
    expect(db.slotRows).toHaveLength(1);
    expect(db.slotRows[0]).toMatchObject({ slot_at: new Date(withOffset).toISOString() });
  });

  it('mixes HH:MM (on the scheduledAt day) with explicit datetime', async () => {
    const db = oneOffSupabase({});
    const t2 = wallClockInSP(3 * DAY_MS, '18:00');
    const res = await POST(
      jsonRequest(
        {
          ...validOneOffBody,
          postsPerDay: 2,
          topics: ['Morning', 'Later day'],
          times: ['09:00', t2],
        },
        'POST',
      ),
    );
    expect(res.status).toBe(201);
    expect(db.slotRows).toHaveLength(2);
    // '09:00' lands on the scheduledAt calendar date in the caller timezone.
    const scheduledAt = new Date(validOneOffBody.scheduledAt);
    const datePart = new Intl.DateTimeFormat('en-CA', {
      timeZone: TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(scheduledAt);
    expect(db.slotRows[0]).toMatchObject({ topic: 'Morning', slot_at: `${datePart}T12:00:00.000Z` });
    expect(db.slotRows[1]).toMatchObject({ topic: 'Later day', slot_at: spToUtcIso(t2) });
  });
});

describe('POST /api/schedule slots insert (database-generated id)', () => {
  it('sends no own id on the slots insert; the response uses the database ids', async () => {
    const db = oneOffSupabase({});
    const res = await POST(
      jsonRequest(
        { ...validOneOffBody, postsPerDay: 2, topics: ['t1', 't2'], times: ['09:00', '18:00'] },
        'POST',
      ),
    );
    expect(res.status).toBe(201);
    // scheduled_posts.id is database-generated (like the batch route): the
    // route must not send client-generated uuids — the insert breaks.
    for (const row of db.sentSlotRows) {
      expect(row).not.toHaveProperty('id');
    }
    // The response carries the database-assigned ids.
    const body = (await res.json()) as { slots: { id: unknown }[] };
    expect(body.slots[0].id).toBe('db-slot-1');
    expect(body.slots[1].id).toBe('db-slot-2');
  });
});
