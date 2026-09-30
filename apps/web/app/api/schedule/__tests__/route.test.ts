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

import { GET, POST, PATCH, DELETE } from '../route';
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
  noSession?: boolean;
}) {
  const insertedRows: Record<string, unknown>[] = [];
  const updatedRows: Record<string, unknown>[] = [];
  const selectArgs: string[] = [];
  const client = {
    auth: {
      getUser: vi.fn(async () =>
        handlers.noSession
          ? { data: { user: null }, error: null }
          : { data: { user: { id: USER_ID } }, error: null },
      ),
    },
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
        delete: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => Promise.resolve({ error: handlers.remove?.error ?? null })),
          })),
        })),
      };
    }),
  };
  vi.mocked(createSupabaseServerClient).mockResolvedValue(client as never);
  vi.mocked(requireSupabaseSession).mockResolvedValue({
    auth: { userId: USER_ID, accessToken: 'cookie-token' },
    error: null,
  });
  vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);
  return Object.assign(client, { insertedRows, updatedRows, selectArgs });
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
  postsPerDay: 2,
  timezone: 'America/Sao_Paulo',
};

function oneOffSupabase(dbHandlers: Parameters<typeof mockSupabase>[0]) {
  return mockSupabase({
    persona: { data: { id: 'p-1' } },
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

  it('GET retorna 401 sem sessão', async () => {
    mockSupabase({ noSession: true });
    vi.mocked(requireSupabaseSession).mockResolvedValue({
      auth: null,
      error: NextResponse.json({ success: false }, { status: 401 }),
    });
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it('GET lista as agendas do usuário', async () => {
    mockSupabase({ list: { data: [{ id: 's-1' }], error: null } });
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { schedules: unknown[] };
    expect(body.schedules).toHaveLength(1);
  });

  it('POST cria agenda one-off válida', async () => {
    oneOffSupabase({});
    const res = await POST(jsonRequest(validOneOffBody, 'POST'));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { success: boolean; schedule: { id: string } };
    expect(body.success).toBe(true);
    expect(body.schedule.id).toBe('s-1');
  });

  it('POST persiste scheduled_at e ignora campos de recorrência (PR #21)', async () => {
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

  it('POST persiste times quando enviados', async () => {
    const db = oneOffSupabase({});
    const res = await POST(jsonRequest({ ...validOneOffBody, postsPerDay: 3, times: ['08:15', '12:45', '20:00'] }, 'POST'));
    expect(res.status).toBe(201);
    expect(db.insertedRows[0].times).toEqual(['08:15', '12:45', '20:00']);
  });

  it('POST sem times persiste array vazio', async () => {
    const db = oneOffSupabase({});
    const res = await POST(jsonRequest(validOneOffBody, 'POST'));
    expect(res.status).toBe(201);
    expect(db.insertedRows[0].times).toEqual([]);
  });

  it('POST rejeita times com formato inválido', async () => {
    oneOffSupabase({});
    const res = await POST(jsonRequest({ ...validOneOffBody, times: ['9h', '25:00'] }, 'POST'));
    expect(res.status).toBe(400);
  });

  it('POST rejeita mais times que postsPerDay', async () => {
    oneOffSupabase({});
    const res = await POST(jsonRequest({ ...validOneOffBody, postsPerDay: 2, times: ['09:00', '12:00', '18:00'] }, 'POST'));
    expect(res.status).toBe(400);
  });

  it('POST sem scheduledAt retorna 400 (recorrência removida na PR #21)', async () => {
    mockSupabase({});
    const { scheduledAt: _ignored, ...noDate } = validOneOffBody;
    const res = await POST(jsonRequest(noDate, 'POST'));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/scheduledAt is required/i);
  });

  it('POST rejeita scheduledAt com menos de 24h de antecedência', async () => {
    mockSupabase({});
    const tooSoon = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    const res = await POST(jsonRequest({ ...validOneOffBody, scheduledAt: tooSoon }, 'POST'));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/at least 24 hours/i);
  });

  it('POST rejeita scheduledAt além de 30 dias', async () => {
    mockSupabase({});
    const tooFar = new Date(Date.now() + 31 * 24 * 60 * 60 * 1000).toISOString();
    const res = await POST(jsonRequest({ ...validOneOffBody, scheduledAt: tooFar }, 'POST'));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/more than 30 days/i);
  });

  it('POST rejeita scheduledAt com formato inválido', async () => {
    mockSupabase({});
    const res = await POST(jsonRequest({ ...validOneOffBody, scheduledAt: 'not-a-date' }, 'POST'));
    expect(res.status).toBe(400);
  });

  it('POST retorna 401 sem sessão', async () => {
    mockSupabase({ noSession: true });
    vi.mocked(requireSupabaseSession).mockResolvedValue({
      auth: null,
      error: NextResponse.json({ success: false }, { status: 401 }),
    });
    const res = await POST(jsonRequest(validOneOffBody, 'POST'));
    expect(res.status).toBe(401);
  });

  it('POST com JSON inválido retorna 400', async () => {
    mockSupabase({});
    const res = await POST(new Request('http://localhost/api/schedule', { method: 'POST', body: '{invalid' }));
    expect(res.status).toBe(400);
  });

  it('POST sem personaId retorna 400', async () => {
    mockSupabase({});
    const res = await POST(jsonRequest({ ...validOneOffBody, personaId: undefined }, 'POST'));
    expect(res.status).toBe(400);
  });

  it('POST rejeita provider inválido', async () => {
    mockSupabase({});
    const res = await POST(jsonRequest({ ...validOneOffBody, providers: ['tiktok'] }, 'POST'));
    expect(res.status).toBe(400);
  });

  it('POST exige conta para o provider selecionado (bluesky sem contas → 400)', async () => {
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

  it('POST cria agenda com provider bluesky e persiste bluesky_account_ids', async () => {
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

  it('POST rejeita conta de outro usuário', async () => {
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

  it('POST retorna 404 quando persona não é do usuário', async () => {
    oneOffSupabase({ persona: { data: null } });
    const res = await POST(jsonRequest(validOneOffBody, 'POST'));
    expect(res.status).toBe(404);
  });

  it('POST retorna 409 quando persona já tem agenda', async () => {
    oneOffSupabase({ existing: { data: { id: 's-0' } } });
    const res = await POST(jsonRequest(validOneOffBody, 'POST'));
    expect(res.status).toBe(409);
  });

  it('POST retorna 500 quando o insert falha', async () => {
    oneOffSupabase({ insert: { data: null, error: { message: 'boom' } } });
    const res = await POST(jsonRequest(validOneOffBody, 'POST'));
    expect(res.status).toBe(500);
  });






  it('PATCH atualiza times', async () => {
    const db = mockSupabase({
      list: { data: [], error: null },
      current: { data: { posts_per_day: 2 } },
      update: { error: null },
    });
    const res = await PATCH(jsonRequest({ id: 's-1', times: ['07:00'] }, 'PATCH'));
    expect(res.status).toBe(200);
    expect(db.updatedRows[0].times).toEqual(['07:00']);
  });

  it('PATCH rejeita times inválidos', async () => {
    mockSupabase({ list: { data: [], error: null }, update: { error: null } });
    const res = await PATCH(jsonRequest({ id: 's-1', times: ['bad'] }, 'PATCH'));
    expect(res.status).toBe(400);
  });
















  it('GET inclui bluesky_account_ids no select', async () => {
    const db = mockSupabase({ list: { data: [], error: null } });
    await GET();
    expect(db.selectArgs.some((arg) => arg.includes('bluesky_account_ids'))).toBe(true);
  });

  it('PATCH linkedinAccountIds atualiza coluna e recalcula providers', async () => {
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

  it('PATCH blueskyAccountIds atualiza coluna e recalcula providers', async () => {
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

  it('PATCH parcial preserva contas bluesky não enviadas', async () => {
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
  it('PATCH parcial preserva contas das redes não enviadas', async () => {
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

  it('PATCH rejeita conta de outra pessoa (ownership validado no merge final)', async () => {
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

  it('PATCH rejeita conta mantida que não é mais do usuário', async () => {
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

  it('PATCH retorna 404 quando schedule não existe', async () => {
    mockSupabase({});
    const res = await PATCH(jsonRequest({ id: 's-404', linkedinAccountIds: ['x'] }, 'PATCH'));
    expect(res.status).toBe(404);
  });



  it('PATCH com active=false pausa a agenda', async () => {
    mockSupabase({ update: { error: null } });
    const res = await PATCH(jsonRequest({ id: 's-1', active: false }, 'PATCH'));
    expect(res.status).toBe(200);
  });

  it('PATCH sem nada para atualizar retorna 400', async () => {
    mockSupabase({});
    const res = await PATCH(jsonRequest({ id: 's-1' }, 'PATCH'));
    expect(res.status).toBe(400);
  });

  it('DELETE remove por id', async () => {
    mockSupabase({ remove: { error: null } });
    const res = await DELETE(new Request('http://localhost/api/schedule?id=s-1'));
    expect(res.status).toBe(200);
  });

  it('DELETE sem id retorna 400', async () => {
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
