import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock('@/lib/supabase/service', () => ({
  createSupabaseServiceClient: vi.fn(),
}));

vi.mock('@/lib/request-auth', () => ({
  requireSupabaseSession: vi.fn(),
}));

import { GET } from '../list/route';
import { ListPersonasResponseSchema } from '@/lib/contracts/personas';
import { requireSupabaseSession } from '@/lib/request-auth';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { logger } from '@/lib/logger';

const USER_ID = 'user-uuid-1';

const PERSONAS = [
  {
    id: 'p-1',
    name: 'Ana',
    photo_path: `${USER_ID}/foto.png`,
    avatar_url: null,
    created_at: '2026-08-29T00:00:00Z',
  },
  {
    id: 'p-2',
    name: 'Robo',
    photo_path: null,
    avatar_url: 'data:image/png;base64,IA',
    created_at: '2026-08-29T01:00:00Z',
  },
];

function mockAuth(
  overrides: {
    user?: { id: string } | null;
    isApiKey?: boolean;
    personaIds?: string[] | null;
  } = {},
) {
  vi.mocked(requireSupabaseSession).mockResolvedValue(
    overrides.user === null
      ? {
        auth: null,
        error: new Response(JSON.stringify({ error: 'Authentication required.' }), {
          status: 401,
        }) as never,
      }
      : {
        auth: {
          userId: USER_ID,
          accessToken: 'token',
          isApiKey: overrides.isApiKey,
          personaIds: overrides.personaIds,
        },
        error: null,
      },
  );
}

const BINDING_ROWS = [
  { persona_id: 'p-1', provider: 'youtube', provider_account_id: 'yt-1' },
  { persona_id: 'p-1', provider: 'instagram', provider_account_id: 'ig-1' },
  { persona_id: 'p-2', provider: 'youtube', provider_account_id: 'yt-2' },
];

const EMPTY_BINDING = {
  youtube: [],
  instagram: [],
  bluesky: [],
  linkedin: [],
  threads: [],
  facebook: [],
  pinterest: [],
  '3speak': [],
  rumble: [],
  fanvue: [],
  telegram: [],
};

function mockSupabase(
  overrides: {
    user?: { id: string } | null;
    error?: { message: string } | null;
    bindingsError?: { message: string } | null;
    bindings?: typeof BINDING_ROWS;
    signErrorPaths?: string[];
    signEmptyUrlPaths?: string[];
    signNullDataPaths?: string[];
    isApiKey?: boolean;
    personaIds?: string[] | null;
    personas?: Array<{
      id: string;
      name: string;
      photo_path: string | null;
      avatar_url: string | null;
      created_at: string;
    }>;
  } = {},
) {
  mockAuth(overrides);
  const signed: string[] = [];
  const bindingFilters: { personaIds?: string[] } = {};
  const personas = overrides.personas ?? PERSONAS;
  const client = {
    from: vi.fn((table: string) => {
      if (table === 'persona_default_accounts') {
        return {
          select: vi.fn(() => ({
            in: vi.fn(async (_col: string, ids: string[]) => {
              bindingFilters.personaIds = ids;
              if (overrides.bindingsError) {
                return { data: null, error: overrides.bindingsError };
              }
              const rows = (overrides.bindings ?? BINDING_ROWS).filter((row) => ids.includes(row.persona_id));
              return { data: rows, error: null };
            }),
          })),
        };
      }
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => {
            const finish = async () => ({
              data: overrides.error ? null : personas,
              error: overrides.error ?? null,
            });
            return {
              in: vi.fn((_col: string, ids: string[]) => ({
                order: vi.fn(async () => ({
                  data: overrides.error ? null : personas.filter((p) => ids.includes(p.id)),
                  error: overrides.error ?? null,
                })),
              })),
              order: vi.fn(finish),
            };
          }),
        })),
      };
    }),
    storage: {
      from: vi.fn(() => ({
        createSignedUrl: vi.fn(async (path: string, _expires: number) => {
          signed.push(path);
          if (overrides.signErrorPaths?.includes(path)) {
            return { data: { signedUrl: 'https://bad.example/signed' }, error: { message: 'sign failed' } };
          }
          if (overrides.signEmptyUrlPaths?.includes(path)) {
            return { data: { signedUrl: '' }, error: null };
          }
          if (overrides.signNullDataPaths?.includes(path)) {
            return { data: null, error: null };
          }
          return { data: { signedUrl: `https://supabase.test/signed/${path}` }, error: null };
        }),
      })),
    },
  };
  vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);
  return { client, signed, bindingFilters };
}

describe('GET /api/persona/list', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retorna 401 sem sessão', async () => {
    mockSupabase({ user: null });

    const res = await GET(new Request('http://localhost:3434/api/persona/list'));
    const body = (await res.json()) as { authenticated: boolean };

    expect(res.status).toBe(401);
    expect(body.authenticated).toBe(false);
  });

  it('retorna personas do usuário com signed URLs', async () => {
    mockSupabase();

    const res = await GET(new Request('http://localhost:3434/api/persona/list'));
    const body = (await res.json()) as {
      authenticated: boolean;
      personas: Array<{
        id: string;
        name: string;
        photoUrl?: string;
        avatarUrl?: string;
      }>;
    };

    expect(res.status).toBe(200);
    expect(ListPersonasResponseSchema.safeParse(body).success).toBe(true);
    expect(body.authenticated).toBe(true);
    expect(body.personas).toHaveLength(2);

    const [ana, robo] = body.personas;
    expect(ana).toMatchObject({
      id: 'p-1',
      name: 'Ana',
      photoUrl: 'https://supabase.test/signed/user-uuid-1/foto.png',
    });
    expect(ana.avatarUrl).toBeUndefined();
    expect(robo).toMatchObject({
      id: 'p-2',
      name: 'Robo',
      avatarUrl: 'data:image/png;base64,IA',
    });
    expect(robo.photoUrl).toBeUndefined();
    expect(Object.keys(ana).sort()).toEqual(['aiLabel', 'boundAccounts', 'createdAt', 'id', 'name', 'photoUrl']);
  });

  it('returns the bound publishing accounts per persona', async () => {
    const { bindingFilters } = mockSupabase();

    const res = await GET(new Request('http://localhost:3434/api/persona/list'));
    const body = (await res.json()) as {
      personas: Array<{ id: string; boundAccounts?: Record<string, string[]> }>;
    };

    expect(res.status).toBe(200);
    expect(body.personas[0].boundAccounts).toEqual({
      ...EMPTY_BINDING,
      youtube: ['yt-1'],
      instagram: ['ig-1'],
    });
    expect(body.personas[1].boundAccounts).toEqual({ ...EMPTY_BINDING, youtube: ['yt-2'] });
    expect(bindingFilters.personaIds).toEqual(['p-1', 'p-2']);
  });

  it('returns an empty binding for a persona with no bound accounts', async () => {
    mockSupabase({
      personas: [
        {
          id: 'p-blank',
          name: 'Blank',
          photo_path: null,
          avatar_url: null,
          created_at: '2026-08-29T00:00:00Z',
        },
      ],
      bindings: [],
    });

    const res = await GET(new Request('http://localhost:3434/api/persona/list'));
    const body = (await res.json()) as {
      personas: Array<{ id: string; boundAccounts?: Record<string, string[]> }>;
    };

    expect(res.status).toBe(200);
    expect(body.personas).toHaveLength(1);
    expect(body.personas[0].boundAccounts).toEqual(EMPTY_BINDING);
  });

  it('returns 500 when the binding query fails', async () => {
    mockSupabase({ bindingsError: { message: 'bindings down' } });

    const res = await GET(new Request('http://localhost:3434/api/persona/list'));

    expect(res.status).toBe(500);
  });

  it('does not let a scoped key see another persona binding', async () => {
    const { bindingFilters } = mockSupabase({
      isApiKey: true,
      personaIds: ['p-1'],
    });

    const res = await GET(new Request('http://localhost:3434/api/persona/list'));
    const body = (await res.json()) as { personas: Array<{ id: string; boundAccounts?: Record<string, string[]> }> };

    expect(body.personas.map((p) => p.id)).toEqual(['p-1']);
    expect(bindingFilters.personaIds).toEqual(['p-1']);
    expect(body.personas[0].boundAccounts).toEqual({
      ...EMPTY_BINDING,
      youtube: ['yt-1'],
      instagram: ['ig-1'],
    });
  });

  it('retorna 500 quando a query falha', async () => {
    mockSupabase({ error: { message: 'db down' } });

    const res = await GET(new Request('http://localhost:3434/api/persona/list'));

    expect(res.status).toBe(500);
  });

  it('omits photoUrl when createSignedUrl returns error even if data.signedUrl is set', async () => {
    const errorSpy = vi.spyOn(logger, 'error');
    mockSupabase({ signErrorPaths: [`${USER_ID}/foto.png`] });

    const res = await GET(new Request('http://localhost:3434/api/persona/list'));
    const body = (await res.json()) as { personas: Array<{ photoUrl?: string }> };

    expect(res.status).toBe(200);
    expect(body.personas[0].photoUrl).toBeUndefined();
    expect(errorSpy.mock.calls.some((call) => String(call[0]).includes('photo sign failed'))).toBe(true);
  });

});
