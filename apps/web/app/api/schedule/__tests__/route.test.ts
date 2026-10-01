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

import { GET, PATCH, DELETE } from '../route';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { requireSupabaseSession } from '@/lib/request-auth';

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
