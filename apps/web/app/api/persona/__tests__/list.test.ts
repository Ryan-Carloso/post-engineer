import { describe, it, expect, vi, beforeEach } from 'vitest';

//---------------
// Testes de GET /api/persona/list — personas do usuário logado,
// com signed URLs para foto e amostra de voz.
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

import { GET } from '../list/route';
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
    voice_id: 'voz-1',
    voice_audio_path: null,
    created_at: '2026-08-29T00:00:00Z',
    language: 'pt',
    video_aspect: '9:16',
    script_prompt: 'Storytelling.',
    paragraph_number: 2,
    niche: 'finanças pessoais',
  },
  {
    id: 'p-2',
    name: 'Robo',
    photo_path: null,
    avatar_url: 'data:image/png;base64,IA',
    voice_id: null,
    voice_audio_path: `${USER_ID}/voz.mp3`,
    created_at: '2026-08-29T01:00:00Z',
    language: null,
    video_aspect: null,
    script_prompt: null,
    paragraph_number: null,
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

const LIBRARY_ROWS = [
  {
    id: 'img-primary',
    persona_id: 'p-1',
    image_path: `${USER_ID}/p-1/library.png`,
    is_primary: true,
    created_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'img-other',
    persona_id: 'p-2',
    image_path: `${USER_ID}/p-2/other.png`,
    is_primary: false,
    created_at: '2026-02-01T00:00:00Z',
  },
];

function mockSupabase(
  overrides: {
    user?: { id: string } | null;
    error?: { message: string } | null;
    imagesError?: { message: string } | null;
    images?: typeof LIBRARY_ROWS;
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
      voice_id: string | null;
      voice_audio_path: string | null;
      created_at: string;
      language: string | null;
      video_aspect: string | null;
      script_prompt: string | null;
      paragraph_number: number | null;
      niche?: string;
    }>;
    imagesNull?: boolean;
  } = {},
) {
  mockAuth(overrides);
  const signed: string[] = [];
  const imageFilters: { personaIds?: string[]; userId?: string } = {};
  const personas = overrides.personas ?? PERSONAS;
  const client = {
    from: vi.fn((table: string) => {
      if (table === 'persona_images') {
        return {
          select: vi.fn(() => ({
            in: vi.fn((_col: string, ids: string[]) => {
              imageFilters.personaIds = ids;
              return {
                eq: vi.fn(async (_col: string, userId: string) => {
                  imageFilters.userId = userId;
                  if (overrides.imagesError) {
                    return { data: null, error: overrides.imagesError };
                  }
                  if (overrides.imagesNull) {
                    return { data: null, error: null };
                  }
                  const rows = (overrides.images ?? LIBRARY_ROWS).filter((row) => ids.includes(row.persona_id));
                  return { data: rows, error: null };
                }),
              };
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
  return { client, signed, imageFilters };
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
        voiceId?: string;
        voiceAudioUrl?: string;
      }>;
    };

    expect(res.status).toBe(200);
    expect(body.authenticated).toBe(true);
    expect(body.personas).toHaveLength(2);

    const [ana, robo] = body.personas;
    expect(ana).toMatchObject({
      id: 'p-1',
      name: 'Ana',
      photoUrl: 'https://supabase.test/signed/user-uuid-1/foto.png',
      voiceId: 'voz-1',
    });
    expect(robo).toMatchObject({
      id: 'p-2',
      name: 'Robo',
      avatarUrl: 'data:image/png;base64,IA',
      voiceAudioUrl: 'https://supabase.test/signed/user-uuid-1/voz.mp3',
    });
  });

  it('retorna as preferências de conteúdo e null para as não definidas', async () => {
    mockSupabase();

    const res = await GET(new Request('http://localhost:3434/api/persona/list'));
    const body = (await res.json()) as {
      personas: Array<{
        language?: string;
        videoAspect?: string;
        scriptPrompt?: string;
        paragraphNumber?: number;
      }>;
    };

    expect(body.personas[0]).toMatchObject({
      language: 'pt',
      videoAspect: '9:16',
      scriptPrompt: 'Storytelling.',
      paragraphNumber: 2,
    });
    expect(body.personas[1].language).toBeUndefined();
    expect(body.personas[1].videoAspect).toBeUndefined();
    expect(body.personas[1].scriptPrompt).toBeUndefined();
    expect(body.personas[1].paragraphNumber).toBeUndefined();
  });

  it('retorna o nicho e undefined quando não definido', async () => {
    mockSupabase();

    const res = await GET(new Request('http://localhost:3434/api/persona/list'));
    const body = (await res.json()) as {
      personas: Array<{ niche?: string }>;
    };

    expect(body.personas[0].niche).toBe('finanças pessoais');
    expect(body.personas[1].niche).toBeUndefined();
  });

  it('retorna 500 quando a query falha', async () => {
    mockSupabase({ error: { message: 'db down' } });

    const res = await GET(new Request('http://localhost:3434/api/persona/list'));

    expect(res.status).toBe(500);
  });

  it('signs only the chosen library path and omits image_path', async () => {
    const { signed } = mockSupabase();

    const res = await GET(new Request('http://localhost:3434/api/persona/list'));
    const body = (await res.json()) as { personas: unknown[] };

    expect(res.status).toBe(200);
    expect(body.personas[0]).toEqual({
      id: 'p-1',
      name: 'Ana',
      createdAt: '2026-08-29T00:00:00Z',
      photoUrl: `https://supabase.test/signed/${USER_ID}/foto.png`,
      libraryUrl: `https://supabase.test/signed/${USER_ID}/p-1/library.png`,
      voiceId: 'voz-1',
      language: 'pt',
      videoAspect: '9:16',
      scriptPrompt: 'Storytelling.',
      paragraphNumber: 2,
      niche: 'finanças pessoais',
    });
    expect(body.personas[1]).toEqual({
      id: 'p-2',
      name: 'Robo',
      createdAt: '2026-08-29T01:00:00Z',
      avatarUrl: 'data:image/png;base64,IA',
      libraryUrl: `https://supabase.test/signed/${USER_ID}/p-2/other.png`,
      voiceAudioUrl: `https://supabase.test/signed/${USER_ID}/voz.mp3`,
    });
    expect(signed.sort()).toEqual(
      [
        `${USER_ID}/foto.png`,
        `${USER_ID}/p-1/library.png`,
        `${USER_ID}/p-2/other.png`,
        `${USER_ID}/voz.mp3`,
      ].sort(),
    );
  });

  it('skips the persona_images query when the persona list is empty', async () => {
    const { client, signed } = mockSupabase({ personas: [] });

    const res = await GET(new Request('http://localhost:3434/api/persona/list'));
    const body = (await res.json()) as { authenticated: boolean; personas: unknown[] };

    expect(res.status).toBe(200);
    expect(body.authenticated).toBe(true);
    expect(body.personas).toEqual([]);
    expect(client.from.mock.calls.map((call) => call[0])).not.toContain('persona_images');
    expect(signed).toEqual([]);
    expect(client.storage.from).not.toHaveBeenCalled();
  });

  it('scopes the library query to the caller and listed personas', async () => {
    const { imageFilters } = mockSupabase();
    await GET(new Request('http://localhost:3434/api/persona/list'));
    expect(imageFilters.userId).toBe(USER_ID);
    expect(imageFilters.personaIds).toEqual(['p-1', 'p-2']);
  });

  it('does not let a scoped key see another persona library image', async () => {
    const { signed, imageFilters } = mockSupabase({
      isApiKey: true,
      personaIds: ['p-1'],
    });

    const res = await GET(new Request('http://localhost:3434/api/persona/list'));
    const body = (await res.json()) as { personas: Array<{ id: string; libraryUrl?: string }> };

    expect(body.personas.map((p) => p.id)).toEqual(['p-1']);
    expect(imageFilters.personaIds).toEqual(['p-1']);
    expect(signed).not.toContain(`${USER_ID}/p-2/other.png`);
    expect(body.personas[0].libraryUrl).toBe(
      `https://supabase.test/signed/${USER_ID}/p-1/library.png`,
    );
  });

  it('returns 500 when the persona_images query fails', async () => {
    mockSupabase({ imagesError: { message: 'images down' } });

    const res = await GET(new Request('http://localhost:3434/api/persona/list'));

    expect(res.status).toBe(500);
  });

  it('omits libraryUrl when signing the chosen path fails', async () => {
    mockSupabase({ signErrorPaths: [`${USER_ID}/p-1/library.png`] });

    const res = await GET(new Request('http://localhost:3434/api/persona/list'));
    const body = (await res.json()) as { personas: Array<{ id: string; libraryUrl?: string; photoUrl?: string }> };

    expect(res.status).toBe(200);
    expect(body.personas[0].libraryUrl).toBeUndefined();
    expect(body.personas[0].photoUrl).toBe(`https://supabase.test/signed/${USER_ID}/foto.png`);
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

  it('still lists a persona whose only face is the library image', async () => {
    mockSupabase({
      personas: [
        {
          id: 'p-lib',
          name: 'Lib Only',
          photo_path: null,
          avatar_url: null,
          voice_id: null,
          voice_audio_path: null,
          created_at: '2026-08-29T00:00:00Z',
          language: null,
          video_aspect: null,
          script_prompt: null,
          paragraph_number: null,
        },
      ],
      images: [
        {
          id: 'img-lib',
          persona_id: 'p-lib',
          image_path: `${USER_ID}/p-lib/face.png`,
          is_primary: false,
          created_at: '2026-02-01T00:00:00Z',
        },
      ],
    });

    const warn = vi.spyOn(logger, 'warn');
    const res = await GET(new Request('http://localhost:3434/api/persona/list'));
    const body = (await res.json()) as {
      personas: Array<{ id: string; libraryUrl?: string; avatarUrl?: string; photoUrl?: string }>;
    };

    expect(res.status).toBe(200);
    expect(body.personas).toHaveLength(1);
    expect(body.personas[0].avatarUrl).toBeUndefined();
    expect(body.personas[0].photoUrl).toBeUndefined();
    expect(body.personas[0].libraryUrl).toBe(
      `https://supabase.test/signed/${USER_ID}/p-lib/face.png`,
    );
    expect(warn.mock.calls.some((call) => String(call[0]).includes('no avatar source'))).toBe(false);
    warn.mockRestore();
  });

  it('warns when a persona has no avatar, photo, or library face', async () => {
    const warn = vi.spyOn(logger, 'warn');
    mockSupabase({
      personas: [
        {
          id: 'p-blank',
          name: 'Blank',
          photo_path: null,
          avatar_url: null,
          voice_id: null,
          voice_audio_path: null,
          created_at: '2026-08-29T00:00:00Z',
          language: null,
          video_aspect: null,
          script_prompt: null,
          paragraph_number: null,
        },
      ],
      images: [],
    });
    await GET(new Request('http://localhost:3434/api/persona/list'));
    expect(warn.mock.calls.some((call) => String(call[0]).includes('no avatar source'))).toBe(true);
    warn.mockRestore();
  });

  it('omits libraryUrl when the signed url is empty', async () => {
    mockSupabase({ signEmptyUrlPaths: [`${USER_ID}/p-1/library.png`] });
    const res = await GET(new Request('http://localhost:3434/api/persona/list'));
    const body = (await res.json()) as { personas: Array<{ libraryUrl?: string }> };
    expect(body.personas[0].libraryUrl).toBeUndefined();
  });

  it('omits libraryUrl when sign returns null data without an error', async () => {
    mockSupabase({ signNullDataPaths: [`${USER_ID}/p-1/library.png`] });
    const res = await GET(new Request('http://localhost:3434/api/persona/list'));
    const body = (await res.json()) as { personas: Array<{ libraryUrl?: string }> };
    expect(body.personas[0].libraryUrl).toBeUndefined();
  });

  it('omits libraryUrl when persona_images returns null rows without an error', async () => {
    mockSupabase({ imagesNull: true });
    const res = await GET(new Request('http://localhost:3434/api/persona/list'));
    const body = (await res.json()) as { personas: Array<{ libraryUrl?: string; photoUrl?: string }> };
    expect(res.status).toBe(200);
    expect(body.personas[0].libraryUrl).toBeUndefined();
    expect(body.personas[0].photoUrl).toBe(`https://supabase.test/signed/${USER_ID}/foto.png`);
  });
});
