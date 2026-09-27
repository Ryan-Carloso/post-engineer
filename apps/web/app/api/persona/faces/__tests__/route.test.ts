import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock('@/lib/supabase/service', () => ({
  createSupabaseServiceClient: vi.fn(),
}));

vi.mock('@/lib/api-keys', () => ({
  resolveApiKey: vi.fn(),
  validateApiKeyFormat: (key: string) => key.startsWith('post-engineer_'),
}));

//---------------
// Testes de GET /api/persona/faces — catálogo de rostos padrão da casa
// (public/caracter-samples). Auth = sessão Supabase OU API key (MCP).
//---------------

import { GET } from '../route';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { resolveApiKey } from '@/lib/api-keys';

const USER_ID = 'user-1';
const ACCESS_TOKEN = 'sb-faces-token';
const APP_URL = 'https://post-engineer.test';

function mockSession(opts?: { noSession?: boolean; noToken?: boolean }): void {
  const client = {
    auth: {
      getUser: vi.fn(async () =>
        opts?.noSession
          ? { data: { user: null }, error: null }
          : { data: { user: { id: USER_ID } }, error: null },
      ),
      getSession: vi.fn(async () =>
        opts?.noToken
          ? { data: { session: null }, error: null }
          : { data: { session: { access_token: ACCESS_TOKEN } }, error: null },
      ),
    },
  };
  vi.mocked(createSupabaseServerClient).mockResolvedValue(client as never);
}

describe('GET /api/persona/faces', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NEXT_PUBLIC_APP_URL', APP_URL);
    mockSession();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('retorna o catálogo de rostos padrão com URLs absolutas', async () => {
    const res = await GET();

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.faces).toHaveLength(14);
    expect(body.faces[0]).toMatchObject({
      id: 'file-1',
      url: `${APP_URL}/caracter-samples/file-1.png`,
      name: 'Character 1',
      gender: 'female',
      age: 23,
      ethnicity: 'White',
      hair: 'shoulder-length wavy blonde',
    });
    expect(typeof body.faces[0].description).toBe('string');
    expect(body.faces[11]).toMatchObject({
      id: 'file-12',
      url: `${APP_URL}/caracter-samples/file-12.png`,
      name: 'Character 12',
      gender: 'male',
      age: 35,
      ethnicity: 'Middle Eastern',
    });
    expect(body.faces[12]).toMatchObject({
      id: 'file-13',
      gender: 'female',
      age: 26,
      ethnicity: 'Black',
    });
    expect(body.faces[13]).toMatchObject({
      id: 'file-14',
      gender: 'male',
      age: 28,
      ethnicity: 'Black',
    });
    for (const face of body.faces) {
      expect(typeof face.age).toBe('number');
      expect(Number.isInteger(face.age)).toBe(true);
    }
  });

  it('aceita API key pessoal via Authorization Bearer (MCP)', async () => {
    vi.mocked(createSupabaseServiceClient).mockReturnValue({} as never);
    vi.mocked(resolveApiKey).mockResolvedValue({
      userId: USER_ID,
      keyId: 'key-1',
      personaIds: null,
    });

    const req = new Request('http://localhost:3434/api/persona/faces', {
      headers: { Authorization: 'Bearer post-engineer_test123' },
    });
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.faces).toHaveLength(14);
    expect(body.faces[3]).toMatchObject({
      id: 'file-4',
      url: `${APP_URL}/caracter-samples/file-4.png`,
      name: 'Character 4',
      gender: 'male',
      age: 23,
    });
  });

  it('retorna 401 com API key inválida', async () => {
    vi.mocked(createSupabaseServiceClient).mockReturnValue({} as never);
    vi.mocked(resolveApiKey).mockResolvedValue(null);

    const req = new Request('http://localhost:3434/api/persona/faces', {
      headers: { Authorization: 'Bearer post-engineer_invalid' },
    });
    const res = await GET(req);

    expect(res.status).toBe(401);
  });

  it('retorna 401 sem sessão', async () => {
    mockSession({ noSession: true });

    const res = await GET();

    expect(res.status).toBe(401);
  });

  it('retorna 401 com sessão sem access token', async () => {
    mockSession({ noToken: true });

    const res = await GET();

    expect(res.status).toBe(401);
  });

  it('retorna 500 quando NEXT_PUBLIC_APP_URL não está definida', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', '');

    const res = await GET();

    expect(res.status).toBe(500);
  });
});
