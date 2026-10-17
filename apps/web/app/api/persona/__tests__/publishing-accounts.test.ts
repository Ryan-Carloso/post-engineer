// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

//---------------
// /api/persona/publishing-accounts tests (real contract).
// The external boundary (Supabase) is mocked; everything else is real:
// auth, rate limit (bypassed), ownership, validation, replace-all write.
//---------------

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
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/rate-limit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/rate-limit')>();
  return { ...actual, applyRateLimit: vi.fn().mockResolvedValue(null) };
});
vi.mock('@/lib/api-error-reporting', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api-error-reporting')>();
  return {
    ...actual,
    withApiErrorReporting: (_route: string, handler: (req: Request) => Promise<Response>) => handler,
  };
});

import { GET, PUT } from '../publishing-accounts/route';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { requireSupabaseSession } from '@/lib/request-auth';

const USER_ID = 'user-uuid-1';
const PERSONA_ID = 'persona-uuid-1';

type Row = Record<string, unknown>;

function makeSupabase(tables: Record<string, Row[]>) {
  const db: Record<string, Row[]> = tables;
  return {
    from(table: string) {
      const rows = db[table] ?? [];
      const filters: Array<(r: Row) => boolean> = [];
      const apply = () => rows.filter((r) => filters.every((f) => f(r)));
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: (col: string, val: unknown) => {
          filters.push((r) => r[col] === val);
          return chain;
        },
        maybeSingle: () => Promise.resolve({ data: apply()[0] ?? null, error: null }),
        delete: () => ({
          eq: (col: string, val: unknown) => {
            filters.push((r) => r[col] === val);
            const gone = apply();
            db[table] = rows.filter((r) => !gone.includes(r));
            return Promise.resolve({ data: null, error: null });
          },
        }),
        insert: (newRows: Row[]) => {
          db[table] = [...rows, ...newRows];
          return Promise.resolve({ data: newRows, error: null });
        },
        then: (resolve: (v: { data: Row[]; error: null }) => unknown) =>
          Promise.resolve({ data: apply(), error: null }).then(resolve),
      };
      return chain;
    },
  };
}

function baseTables(): Record<string, Row[]> {
  return {
    personas: [{ id: PERSONA_ID, user_id: USER_ID }],
    social_accounts: [
      { provider: 'youtube', provider_account_id: 'UC-1', user_id: USER_ID },
      { provider: 'bluesky', provider_account_id: 'did:plc:a', user_id: USER_ID },
    ],
    persona_default_accounts: [],
  };
}

function authed() {
  vi.mocked(requireSupabaseSession).mockResolvedValue({
    auth: { userId: USER_ID, isApiKey: true, personaIds: null },
    error: null,
  } as never);
}

function req(method: string, body?: unknown): Request {
  return new Request(`https://app.test/api/persona/publishing-accounts?personaId=${PERSONA_ID}`, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  authed();
});

describe('GET /api/persona/publishing-accounts', () => {
  it('returns the grouped defaults', async () => {
    const tables = baseTables();
    tables.persona_default_accounts = [
      { persona_id: PERSONA_ID, provider: 'bluesky', provider_account_id: 'did:plc:a' },
    ];
    vi.mocked(createSupabaseServiceClient).mockReturnValue(makeSupabase(tables) as never);
    const res = await GET(req('GET'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.defaults.bluesky).toEqual(['did:plc:a']);
    expect(body.defaults.youtube).toEqual([]);
  });

  it('401s when unauthenticated', async () => {
    vi.mocked(requireSupabaseSession).mockResolvedValue({
      auth: null,
      error: new Response(JSON.stringify({ success: false }), { status: 401 }),
    } as never);
    const res = await GET(req('GET'));
    expect(res.status).toBe(401);
  });

  it('400s when personaId is missing', async () => {
    vi.mocked(createSupabaseServiceClient).mockReturnValue(makeSupabase(baseTables()) as never);
    const res = await GET(new Request('https://app.test/api/persona/publishing-accounts', { method: 'GET' }));
    expect(res.status).toBe(400);
  });

  it('403s when the API key scope denies the persona', async () => {
    vi.mocked(requireSupabaseSession).mockResolvedValue({
      auth: { userId: USER_ID, isApiKey: true, personaIds: ['other-persona'] },
      error: null,
    } as never);
    vi.mocked(createSupabaseServiceClient).mockReturnValue(makeSupabase(baseTables()) as never);
    const res = await GET(req('GET'));
    expect(res.status).toBe(403);
  });
});

describe('PUT /api/persona/publishing-accounts', () => {
  it('replaces the whole set and returns the new state', async () => {
    const tables = baseTables();
    tables.persona_default_accounts = [
      { persona_id: PERSONA_ID, provider: 'youtube', provider_account_id: 'UC-1' },
    ];
    vi.mocked(createSupabaseServiceClient).mockReturnValue(makeSupabase(tables) as never);
    const res = await PUT(req('PUT', { accounts: { bluesky: ['did:plc:a'] } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.defaults.bluesky).toEqual(['did:plc:a']);
    expect(body.defaults.youtube).toEqual([]);
    expect(tables.persona_default_accounts).toHaveLength(1);
  });

  it('404s for a persona that is not the caller\u2019s', async () => {
    const tables = baseTables();
    tables.personas = [];
    vi.mocked(createSupabaseServiceClient).mockReturnValue(makeSupabase(tables) as never);
    const res = await PUT(req('PUT', { accounts: { bluesky: ['did:plc:a'] } }));
    expect(res.status).toBe(404);
  });

  it('400s for an account the user has not connected', async () => {
    vi.mocked(createSupabaseServiceClient).mockReturnValue(makeSupabase(baseTables()) as never);
    const res = await PUT(req('PUT', { accounts: { youtube: ['UC-evil'] } }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('INVALID_PROVIDER_ACCOUNT');
  });

  it('400s for an unknown provider', async () => {
    vi.mocked(createSupabaseServiceClient).mockReturnValue(makeSupabase(baseTables()) as never);
    const res = await PUT(req('PUT', { accounts: { tiktok: ['tt-1'] } }));
    expect(res.status).toBe(400);
  });

  it('400s for a non-object accounts body', async () => {
    vi.mocked(createSupabaseServiceClient).mockReturnValue(makeSupabase(baseTables()) as never);
    const res = await PUT(req('PUT', { accounts: ['did:plc:a'] }));
    expect(res.status).toBe(400);
  });

  it('400s for malformed JSON', async () => {
    vi.mocked(createSupabaseServiceClient).mockReturnValue(makeSupabase(baseTables()) as never);
    const bad = new Request(`https://app.test/api/persona/publishing-accounts?personaId=${PERSONA_ID}`, {
      method: 'PUT',
      body: 'not json{{{',
    });
    const res = await PUT(bad);
    expect(res.status).toBe(400);
  });
});
