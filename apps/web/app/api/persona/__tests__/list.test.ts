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

function mockAuth(overrides: { user?: { id: string } | null } = {}) {
  vi.mocked(requireSupabaseSession).mockResolvedValue(
    overrides.user === null
      ? {
        auth: null,
        error: new Response(JSON.stringify({ error: 'Authentication required.' }), {
          status: 401,
        }) as never,
      }
      : {
        auth: { userId: USER_ID, accessToken: 'token' },
        error: null,
      },
  );
}

function mockSupabase(overrides: { user?: { id: string } | null; error?: { message: string } | null } = {}) {
  mockAuth(overrides);
  const signed: string[] = [];
  const client = {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          order: vi.fn(async () => ({
            data: overrides.error ? null : PERSONAS,
            error: overrides.error ?? null,
          })),
        })),
      })),
    })),
    storage: {
      from: vi.fn(() => ({
        createSignedUrl: vi.fn(async (path: string, _expires: number) => {
          signed.push(path);
          return { data: { signedUrl: `https://supabase.test/signed/${path}` }, error: null };
        }),
      })),
    },
  };
  vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);
  return { client, signed };
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
});
