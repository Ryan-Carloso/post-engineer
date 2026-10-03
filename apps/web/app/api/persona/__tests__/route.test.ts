// @vitest-environment node
// API routes use native Request/FormData (undici); jsdom mixes
// implementations and locks up `request.formData()`. UI tests stay in jsdom.
import '@testing-library/jest-dom/vitest';
import { NextResponse } from 'next/server';
import { describe, it, expect, vi, beforeEach } from 'vitest';

//---------------
// POST /api/persona tests (real contract).
// The external boundary (Supabase) is mocked; everything else is real:
// formData parsing, validations, path assembly, and payload.
//---------------

vi.mock('next/server', async (importOriginal) => {
  // after() needs a request scope; in tests the callback runs inline.
  const actual = await importOriginal<typeof import('next/server')>();
  return {
    ...actual,
    after: (callback: () => unknown) => {
      void Promise.resolve().then(() => callback());
    },
  };
});
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
}));
vi.mock('@/lib/supabase/service', () => ({
  createSupabaseServiceClient: vi.fn(),
}));
vi.mock('@/lib/request-auth', () => ({
  requireSupabaseSession: vi.fn(),
}));
vi.mock('@/lib/analytics', () => ({
  trackApiEvent: vi.fn(),
}));

import { POST, PATCH, DELETE } from '../route';
import { DEFAULT_FACE_MIX_PERCENT } from '@/lib/persona-schema';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { requireSupabaseSession } from '@/lib/request-auth';
import { trackApiEvent } from '@/lib/analytics';

const USER_ID = 'user-uuid-1';

function mockSupabase(overrides: {
  user?: { id: string } | null;
  uploadError?: { message: string } | null;
  insertError?: { message: string } | null;
} = {}) {
  const uploaded: Array<{ path: string; options: { contentType: string } }> = [];
  const inserted: Array<Record<string, unknown>> = [];

  const storageFrom = {
    upload: vi.fn(async (path: string, _body: unknown, options: { contentType: string }) => {
      uploaded.push({ path, options });
      return { data: { path }, error: overrides.uploadError ?? null };
    }),
  };

  const from = {
    insert: vi.fn((values: Record<string, unknown>) => {
      inserted.push(values);
      return {
        select: vi.fn(() => ({
          single: vi.fn(async () => ({
            data: { id: 'persona-uuid-1', ...values },
            error: overrides.insertError ?? null,
          })),
        })),
      };
    }),
  };

  const client = {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: overrides.user === null ? null : { id: USER_ID, ...overrides.user } },
        error: null,
      })),
    },
    storage: { from: vi.fn(() => storageFrom) },
    from: vi.fn(() => from),
  };

  vi.mocked(createSupabaseServerClient).mockResolvedValue(client as never);
  vi.mocked(requireSupabaseSession).mockResolvedValue({
    auth: { userId: USER_ID, accessToken: 'cookie-token' },
    error: null,
  });
  vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);
  return { client, uploaded, inserted };
}

function formRequest(fields: Record<string, string>, files: File[] = []): Request {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    formData.append(key, value);
  }
  for (const file of files) {
    formData.append(file.type.startsWith('audio/') ? 'voiceAudio' : 'photo', file);
  }
  return new Request('http://localhost/api/persona', { method: 'POST', body: formData });
}

const photo = () => new File(['png'], 'foto.png', { type: 'image/png' });

describe('POST /api/persona — modo faceless (100% stock, sem avatar)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('cria persona faceless sem foto nem avatar (apenas voz da casa)', async () => {
    const { uploaded, inserted } = mockSupabase();

    const res = await POST(
      formRequest({ name: 'Canal Ninja', personaMode: 'faceless', voiceId: 'voz-1' }),
    );
    const body = (await res.json()) as { success: boolean; personaId?: string };

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(uploaded).toHaveLength(0);
    expect(inserted[0]).toMatchObject({
      user_id: USER_ID,
      name: 'Canal Ninja',
      photo_path: null,
      avatar_url: null,
      voice_id: 'voz-1',
    });
  });

  it('includes recent_image_ids in the insert (supplies the NOT NULL column explicitly, independent of the DB default)', async () => {
    // Regression: the personas.recent_image_ids column is NOT NULL, and DBs
    // created from the pre-fix consolidated schema have no DEFAULT for it —
    // omitting it from the insert makes PostgreSQL reject every persona
    // creation with a 23502 violation (500). The insert supplies the column
    // explicitly so creation works regardless of the DB default.
    const { inserted } = mockSupabase();

    const res = await POST(
      formRequest({ name: 'Canal Ninja', personaMode: 'faceless', voiceId: 'voz-1' }),
    );

    expect(res.status).toBe(200);
    expect(inserted[0]).toHaveProperty('recent_image_ids');
    expect(inserted[0].recent_image_ids).toEqual([]);
  });

  it('persona insert payload stays in sync with public.personas (both directions)', async () => {
    // Schema-sync test (mirrors the generate-and-schedule phantom-key pin):
    // the supabase-js mock records any payload key, so a speculative key
    // would sail through tests but be rejected by PostgREST in production
    // (cf. PR #55's kind='batch'); conversely a NOT NULL-without-DEFAULT
    // column missing from the payload 500s every call (this PR's 500). Assert
    // both directions so the next column addition fails CI instead of
    // production.
    const { readFileSync } = await import('node:fs');
    const { join, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const sqlPath = join(
      dirname(fileURLToPath(import.meta.url)),
      '..',
      '..',
      '..',
      '..',
      '..',
      '..',
      'supabase',
      'migrations',
      '001_schema.sql',
    );
    const sql = readFileSync(sqlPath, 'utf8');
    const tableMatch = sql.match(
      /create table if not exists public\.personas \(([\s\S]*?)\n\);/i,
    );
    expect(tableMatch).not.toBeNull();
    const columnBlock = tableMatch?.[1] ?? '';
    // Table-level constraints (e.g. `unique (user_id, persona_id),`) start
    // with a keyword, not a column name — filter them so a future phantom
    // key named like a SQL keyword can't false-pass.
    const constraintKeywords = new Set([
      'primary',
      'unique',
      'foreign',
      'check',
      'constraint',
      'exclude',
    ]);
    // Column name -> true when the column is NOT NULL with no DEFAULT (the
    // insert MUST supply it) — e.g. `user_id uuid not null` vs
    // `created_at timestamptz not null default now()`.
    // Assumes one column per physical line: a wrapped definition (e.g. the
    // `default` on its own continuation line) would misparse — fail-closed,
    // but join continuation lines before changing the format.
    const columns = new Map<string, boolean>();
    for (const line of columnBlock.split('\n')) {
      const trimmed = line.trim();
      const name = trimmed.split(/\s+/)[0]?.replace(/["`,]/g, '');
      if (!name || name.startsWith('--') || constraintKeywords.has(name)) {
        continue;
      }
      // Match whole words on the comment-stripped definition: a bare
      // substring match would silently drop a genuinely required column —
      // e.g. `default_topic text not null` or a trailing comment mentioning
      // "default" — and that is exactly the production-500 class this test
      // exists to catch. Column-level PRIMARY KEY is implicitly NOT NULL in
      // PostgreSQL, so it counts even without an explicit `not null`.
      const definition = trimmed.replace(/--.*$/, '');
      const notNull =
        /\bnot null\b/i.test(definition) ||
        /\bprimary key\b/i.test(definition);
      columns.set(name, notNull && !/\bdefault\b/i.test(definition));
    }
    // Sentinels: guard against a degraded parse passing vacuously.
    expect(columns.has('recent_image_ids')).toBe(true);
    expect(columns.get('user_id')).toBe(true);
    expect(columns.get('created_at')).toBe(false);
    // Pins the DEFAULT this PR restores: dropping `default '{}'` from
    // 001_schema.sql must fail CI, not just leave the insert pin green.
    expect(columns.get('recent_image_ids')).toBe(false);

    const { inserted } = mockSupabase();
    const res = await POST(
      formRequest({ name: 'Canal Ninja', personaMode: 'faceless', voiceId: 'voz-1' }),
    );

    expect(res.status).toBe(200);
    const payload = inserted[0];
    expect(payload).toBeDefined();

    // Direction 1: every insert key is a real public.personas column.
    for (const key of Object.keys(payload)) {
      expect(
        columns.has(key),
        `insert key "${key}" is not a public.personas column`,
      ).toBe(true);
    }
    // Direction 2: every NOT NULL-without-DEFAULT column is supplied.
    for (const [name, required] of columns) {
      if (required) {
        expect(payload).toHaveProperty(name);
      }
    }
  });

  it("keeps the recent_image_ids '{}' default literal in sync across SQL files", async () => {
    // The restored default literal now lives in three SQL files (two in
    // supabase/migrations/, plus the deployed-DB fix script at the
    // supabase/ root); a value drift between them would diverge the
    // migration chain, the canonical schema, and the deployed-DB fix
    // script silently. Static `includes` checks only — no dynamic RegExp
    // (CodeQL rule).
    const { readFileSync } = await import('node:fs');
    const { join, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const supabaseDir = join(
      dirname(fileURLToPath(import.meta.url)),
      '..',
      '..',
      '..',
      '..',
      '..',
      '..',
      'supabase',
    );
    const expectations: Array<[string, string]> = [
      [join('migrations', '001_schema.sql'), `recent_image_ids uuid[] not null default '{}'`],
      [
        join('migrations', '002_persona-images.sql'),
        `recent_image_ids uuid[] not null default '{}'`,
      ],
      [
        'fix-recent-image-ids-default.sql',
        `alter column recent_image_ids set default '{}'`,
      ],
    ];
    for (const [file, literal] of expectations) {
      const sql = readFileSync(join(supabaseDir, file), 'utf8');
      expect(
        sql.includes(literal),
        `${file} drifted from the recent_image_ids '{}' default`,
      ).toBe(true);
    }
  });

  it('rejeita foto enviada em modo faceless (evita reativar avatar no engine)', async () => {
    mockSupabase();

    const res = await POST(
      formRequest({ name: 'Canal Ninja', personaMode: 'faceless', voiceId: 'voz-1' }, [photo()]),
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toContain('Faceless');
  });

  it('rejeita avatarUrl enviada em modo faceless', async () => {
    mockSupabase();

    const res = await POST(
      formRequest({
        name: 'Canal Ninja',
        personaMode: 'faceless',
        avatarUrl: 'data:image/png;base64,IA',
        voiceId: 'voz-1',
      }),
    );

    expect(res.status).toBe(400);
  });

  it('rejects an invalid personaMode', async () => {
    mockSupabase();

    const res = await POST(
      formRequest({ name: 'Canal Ninja', personaMode: 'holograma', voiceId: 'voz-1' }),
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { success: boolean; error: string };
    expect(body.error).toContain('personaMode');
  });
});

describe('POST /api/persona', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 without a session', async () => {
    mockSupabase({ user: null });
    vi.mocked(requireSupabaseSession).mockResolvedValue({
      auth: null,
      error: NextResponse.json({ success: false }, { status: 401 }),
    });

    const res = await POST(formRequest({ name: 'Ana', voiceId: 'voz-1' }, [photo()]));
    const body = (await res.json()) as { success: boolean };

    expect(res.status).toBe(401);
    expect(body.success).toBe(false);
  });

  it('retorna 400 sem nome', async () => {
    mockSupabase();

    const res = await POST(formRequest({ voiceId: 'voz-1' }, [photo()]));

    expect(res.status).toBe(400);
    const body = (await res.json()) as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toBeTruthy();
  });

  it('retorna 400 sem identidade visual (nem foto nem avatarUrl)', async () => {
    mockSupabase();

    const res = await POST(formRequest({ name: 'Ana', voiceId: 'voz-1' }));

    expect(res.status).toBe(400);
  });

  it('returns 400 without a voice (missing voiceId)', async () => {
    mockSupabase();

    const res = await POST(formRequest({ name: 'Ana' }, [photo()]));

    expect(res.status).toBe(400);
  });

  it('returns 400 with an unsupported photo format', async () => {
    mockSupabase();
    const gif = new File(['gif'], 'foto.gif', { type: 'image/gif' });

    const res = await POST(formRequest({ name: 'Ana', voiceId: 'voz-1' }, [gif]));

    expect(res.status).toBe(400);
  });

  it('creates a persona with an uploaded photo: uploads to Storage and inserts the row', async () => {
    const { uploaded, inserted } = mockSupabase();

    const res = await POST(formRequest({ name: 'Ana', voiceId: 'voz-1' }, [photo()]));
    const body = (await res.json()) as { success: boolean; personaId?: string };

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    // The route generates the persona id before the upload (the storage folder
    // is {userId}/{personaId}/), so the response id is a fresh UUID — not the
    // fixture's.
    expect(body.personaId).toMatch(/^[0-9a-f-]{36}$/);
    expect(uploaded).toHaveLength(1);
    // Pinned layout: {userId}/{personaId}/photo.png — the folder says whose
    // file it is in the Supabase dashboard.
    expect(uploaded[0].path).toBe(`${USER_ID}/${body.personaId}/photo.png`);
    expect(uploaded[0].options.contentType).toBe('image/png');
    expect(inserted[0]).toMatchObject({
      // The route generates the id before the upload, so the folder is known
      // before the row exists (personas.id defaults to gen_random_uuid()).
      id: body.personaId,
      user_id: USER_ID,
      name: 'Ana',
      photo_path: `${USER_ID}/${body.personaId}/photo.png`,
      voice_id: 'voz-1',
    });
  });

  it('creates a persona with an AI avatar (avatarUrl instead of photo)', async () => {
    const { uploaded, inserted } = mockSupabase();

    const res = await POST(
      formRequest({
        name: 'Robo',
        avatarUrl: 'data:image/png;base64,IA',
        voiceId: 'voz-1',
      }),
    );
    const body = (await res.json()) as { success: boolean };

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(uploaded).toHaveLength(0);
    expect(inserted[0]).toMatchObject({
      name: 'Robo',
      avatar_url: 'data:image/png;base64,IA',
      voice_id: 'voz-1',
    });
  });

  it('tracks persona_created on success (2xx product analytics)', async () => {
    mockSupabase();

    const res = await POST(formRequest({ name: 'Ana', voiceId: 'voz-1' }, [photo()]));
    const body = (await res.json()) as { success: boolean; personaId?: string };

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    // The event must carry the id the route actually used.
    expect(trackApiEvent).toHaveBeenCalledWith(
      'persona_created',
      expect.objectContaining({ personaId: body.personaId }),
    );
  });

  it('does not track persona_created when creation fails', async () => {
    mockSupabase({ insertError: { message: 'db down' } });

    const res = await POST(formRequest({ name: 'Ana', voiceId: 'voz-1' }, [photo()]));

    expect(res.status).toBe(500);
    expect(trackApiEvent).not.toHaveBeenCalled();
  });

  it('retorna 500 quando o upload no Storage falha', async () => {
    mockSupabase({ uploadError: { message: 'bucket down' } });

    const res = await POST(formRequest({ name: 'Ana', voiceId: 'voz-1' }, [photo()]));

    expect(res.status).toBe(500);
    const body = (await res.json()) as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toBeTruthy();
  });

  it('retorna 500 quando o insert na tabela falha', async () => {
    mockSupabase({ insertError: { message: 'check violation' } });

    const res = await POST(formRequest({ name: 'Ana', voiceId: 'voz-1' }, [photo()]));

    expect(res.status).toBe(500);
    const body = (await res.json()) as { success: boolean; error: string };
    expect(body.success).toBe(false);
  });

  //---------------
  // Content preferences (optional): language, videoAspect,
  // scriptPrompt, paragraphNumber. Persisted on the persona and applied
  // as defaults in the video job.
  //---------------

  it('creates a persona with full content preferences', async () => {
    const { inserted } = mockSupabase();

    const res = await POST(
      formRequest({
        name: 'Ana',
        voiceId: 'voz-1',
        language: 'pt',
        videoAspect: '16:9',
        scriptPrompt: 'Storytelling com hook forte.',
        paragraphNumber: '3',
      }, [photo()]),
    );

    expect(res.status).toBe(200);
    expect(inserted[0]).toMatchObject({
      language: 'pt',
      video_aspect: '16:9',
      script_prompt: 'Storytelling com hook forte.',
      paragraph_number: 3,
    });
  });

  it('creates a persona without preferences: columns stay null (house default)', async () => {
    const { inserted } = mockSupabase();

    const res = await POST(formRequest({ name: 'Ana', voiceId: 'voz-1' }, [photo()]));

    expect(res.status).toBe(200);
    expect(inserted[0]).toMatchObject({
      language: null,
      video_aspect: null,
      script_prompt: null,
      paragraph_number: null,
    });
  });

  it('returns 400 with an invalid videoAspect', async () => {
    mockSupabase();

    const res = await POST(
      formRequest({ name: 'Ana', voiceId: 'voz-1', videoAspect: '4:3' }, [photo()]),
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('videoAspect');
  });

  it('cria persona com nicho', async () => {
    const { inserted } = mockSupabase();

    const res = await POST(
      formRequest({ name: 'Ana', voiceId: 'voz-1', niche: 'finanças pessoais' }, [photo()]),
    );

    expect(res.status).toBe(200);
    expect(inserted[0]).toMatchObject({ niche: 'finanças pessoais' });
  });

  it('cria persona sem nicho: coluna fica null', async () => {
    const { inserted } = mockSupabase();

    const res = await POST(formRequest({ name: 'Ana', voiceId: 'voz-1' }, [photo()]));

    expect(res.status).toBe(200);
    expect(inserted[0]).toMatchObject({ niche: null });
  });

  it('retorna 400 com niche acima de 300 caracteres', async () => {
    mockSupabase();

    const res = await POST(
      formRequest({ name: 'Ana', voiceId: 'voz-1', niche: 'x'.repeat(301) }, [photo()]),
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('niche');
  });

  it('retorna 400 com paragraphNumber fora de 1–10', async () => {
    mockSupabase();

    const res = await POST(
      formRequest({ name: 'Ana', voiceId: 'voz-1', paragraphNumber: '11' }, [photo()]),
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('paragraphNumber');
  });

  it('returns 400 with a non-numeric paragraphNumber', async () => {
    mockSupabase();

    const res = await POST(
      formRequest({ name: 'Ana', voiceId: 'voz-1', paragraphNumber: 'muito' }, [photo()]),
    );

    expect(res.status).toBe(400);
  });
});

describe('POST /api/persona — mix faceless/face (híbrido) e qualidade', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a hybrid persona: persists faceMixPercent and faceQuality', async () => {
    const { inserted } = mockSupabase();

    const res = await POST(
      formRequest({
        name: 'Mix 40',
        voiceId: 'voz-1',
        faceMixPercent: '40',
        faceQuality: 'very_good',
      }, [photo()]),
    );

    expect(res.status).toBe(200);
    expect(inserted[0]).toMatchObject({
      face_mix_percent: 40,
      face_quality: 'very_good',
    });
  });

  it('cria persona 100% faceless: mix 0, sem foto, qualidade ok', async () => {
    const { inserted } = mockSupabase();

    const res = await POST(
      formRequest({
        name: 'Ninja',
        personaMode: 'faceless',
        voiceId: 'voz-1',
        faceMixPercent: '0',
        faceQuality: 'ok',
      }),
    );

    expect(res.status).toBe(200);
    expect(inserted[0]).toMatchObject({
      face_mix_percent: 0,
      face_quality: 'ok',
      photo_path: null,
      avatar_url: null,
    });
  });

  it('faceless sem faceMixPercent persiste 0 (sem backdoor do NULL)', async () => {
    const { inserted } = mockSupabase();

    const res = await POST(
      formRequest({ name: 'Ninja', personaMode: 'faceless', voiceId: 'voz-1' }),
    );

    expect(res.status).toBe(200);
    expect(inserted[0]).toMatchObject({ face_mix_percent: 0 });
  });

  it('rejects a photo when the mix is 0 (faceless)', async () => {
    mockSupabase();

    const res = await POST(
      formRequest({
        name: 'Ninja',
        voiceId: 'voz-1',
        faceMixPercent: '0',
      }, [photo()]),
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toContain('faceMixPercent');
  });

  it('retorna 400 com faceMixPercent fora de 0–100', async () => {
    mockSupabase();

    const res = await POST(
      formRequest({
        name: 'Ana',
        voiceId: 'voz-1',
        faceMixPercent: '150',
      }, [photo()]),
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('faceMixPercent');
  });

  it('returns 400 with a non-numeric faceMixPercent', async () => {
    mockSupabase();

    const res = await POST(
      formRequest({
        name: 'Ana',
        voiceId: 'voz-1',
        faceMixPercent: 'muito',
      }, [photo()]),
    );

    expect(res.status).toBe(400);
  });

  it('returns 400 with an invalid faceQuality', async () => {
    mockSupabase();

    const res = await POST(
      formRequest({
        name: 'Ana',
        voiceId: 'voz-1',
        faceQuality: 'ultra',
      }, [photo()]),
    );

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('faceQuality');
  });

  it('persona without mix stores the shared default — no new row keeps NULL', async () => {
    // A persona-mode creation that omitted faceMixPercent used to store
    // NULL, which the images route treats as faceless — permanently
    // write-locking the library for a persona the creation accepted as
    // face-requiring. New rows are coerced to the UI store's default so
    // NULL keeps meaning "legacy faceless-mode row" everywhere.
    const { inserted } = mockSupabase();

    const res = await POST(formRequest({ name: 'Ana', voiceId: 'voz-1' }, [photo()]));

    expect(res.status).toBe(200);
    expect(inserted[0]).toMatchObject({
      face_mix_percent: DEFAULT_FACE_MIX_PERCENT,
      face_quality: null,
    });
  });

  it('faceless without explicit mix is stored as 0 so the library guard holds', async () => {
    // A faceless creation with no explicit faceMixPercent used to store
    // NULL, which passed the POST /api/persona/images `=== 0` faceless
    // check — a backdoor for library uploads on faceless personas. New
    // faceless rows are coerced to 0.
    const { inserted } = mockSupabase();

    const res = await POST(
      formRequest({ name: 'Canal Ninja', personaMode: 'faceless', voiceId: 'voz-1' }),
    );

    expect(res.status).toBe(200);
    expect(inserted[0]).toMatchObject({ face_mix_percent: 0, photo_path: null });
  });

  it('faceless with an explicit faceMixPercent is coerced to 0 (backdoor closed)', async () => {
    // A direct API caller can send personaMode=faceless with an explicit
    // faceMixPercent=80. Without coercion, 80 is stored and the images
    // route (which treats the stored mix as the facelessness source)
    // would accept library uploads — re-opening the backdoor. The
    // faceless branch is unconditional at the write boundary.
    const { inserted } = mockSupabase();

    const res = await POST(
      formRequest({
        name: 'Canal Ninja',
        personaMode: 'faceless',
        faceMixPercent: '80',
        voiceId: 'voz-1',
      }),
    );

    expect(res.status).toBe(200);
    expect(inserted[0]).toMatchObject({ face_mix_percent: 0 });
  });
});

//---------------
// PATCH — edit an existing persona. All fields optional;
// at least one must be sent. Replaced files are removed
// from Storage.
//---------------

interface PatchOverrides {
  user?: { id: string } | null;
  existing?: Record<string, unknown> | null;
  uploadError?: { message: string } | null;
  updateError?: { message: string } | null;
}

function mockSupabaseForDelete(deleteError: { code?: string; message: string } | null) {
  const client = {
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: USER_ID } }, error: null })),
    },
    storage: {
      from: vi.fn(() => ({
        remove: vi.fn(async () => ({ error: null })),
      })),
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            order: vi.fn(() => ({
              limit: vi.fn(async () => ({ data: [], error: null, count: 0 })),
            })),
            single: vi.fn(async () => ({
              data: { id: 'persona-uuid-1', photo_path: null, voice_audio_path: null },
              error: null,
            })),
            // Thenable for list selects (schedules, generations): resolves
            // to an empty list so the cascade degenerates cleanly.
            then: (resolve: (v: unknown) => void) => {
              resolve({ data: [], error: null });
            },
          })),
        })),
      })),
      delete: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(async () => ({ error: deleteError })),
        })),
      })),
    })),
  };
  vi.mocked(createSupabaseServerClient).mockResolvedValue(client as never);
  vi.mocked(requireSupabaseSession).mockResolvedValue({
    auth: { userId: USER_ID, accessToken: 'cookie-token' },
    error: null,
  });
}

function mockSupabaseForPatch(overrides: PatchOverrides = {}) {
  const uploaded: Array<{ path: string; options: { contentType: string } }> = [];
  const removed: string[] = [];
  const updated: Array<Record<string, unknown>> = [];
  const existing =
    overrides.existing === undefined
      ? {
        id: 'persona-uuid-1',
        user_id: USER_ID,
        name: 'Antiga',
        photo_path: `${USER_ID}/foto-antiga.png`,
        avatar_url: null,
        voice_id: 'voz-antiga',
        voice_audio_path: null,
      }
      : overrides.existing;

  const storageFrom = {
    upload: vi.fn(async (path: string, _body: unknown, options: { contentType: string }) => {
      uploaded.push({ path, options });
      return { data: { path }, error: overrides.uploadError ?? null };
    }),
    remove: vi.fn(async (paths: string[]) => {
      removed.push(...paths);
      return { error: null };
    }),
  };

  const from = {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(async () => ({ data: existing, error: null })),
        })),
      })),
    })),
    update: vi.fn((values: Record<string, unknown>) => {
      updated.push(values);
      return {
        eq: vi.fn(async () => ({ error: overrides.updateError ?? null })),
      };
    }),
  };

  const client = {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: overrides.user === null ? null : { id: USER_ID } },
        error: null,
      })),
    },
    storage: { from: vi.fn(() => storageFrom) },
    from: vi.fn(() => from),
  };

  vi.mocked(createSupabaseServerClient).mockResolvedValue(client as never);
  vi.mocked(requireSupabaseSession).mockResolvedValue({
    auth: { userId: USER_ID, accessToken: 'cookie-token' },
    error: null,
  });
  return { client, uploaded, removed, updated, from };
}

function patchRequest(
  personaId: string,
  fields: Record<string, string> = {},
  files: File[] = [],
): Request {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    formData.append(key, value);
  }
  for (const file of files) {
    formData.append(file.type.startsWith('audio/') ? 'voiceAudio' : 'photo', file);
  }
  return new Request(`http://localhost/api/persona?personaId=${personaId}`, {
    method: 'PATCH',
    body: formData,
  });
}

describe('PATCH /api/persona', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retorna 401 quando não há sessão', async () => {
    mockSupabaseForPatch({ user: null });
    vi.mocked(requireSupabaseSession).mockResolvedValue({
      auth: null,
      error: NextResponse.json({ success: false }, { status: 401 }),
    });

    const res = await PATCH(patchRequest('persona-uuid-1', { name: 'Nova' }));

    expect(res.status).toBe(401);
  });

  it('returns 400 without personaId in the query', async () => {
    mockSupabaseForPatch();
    const request = new Request('http://localhost/api/persona', {
      method: 'PATCH',
      body: new FormData(),
    });

    const res = await PATCH(request);

    expect(res.status).toBe(400);
  });

  it('returns 404 when the persona does not exist or is not the user\'s', async () => {
    mockSupabaseForPatch({ existing: null });

    const res = await PATCH(patchRequest('persona-uuid-1', { name: 'Nova' }));

    expect(res.status).toBe(404);
  });

  it('returns 400 when nothing is sent to update', async () => {
    mockSupabaseForPatch();

    const res = await PATCH(patchRequest('persona-uuid-1'));

    expect(res.status).toBe(400);
  });

  it('atualiza apenas o nome', async () => {
    const { updated } = mockSupabaseForPatch();

    const res = await PATCH(patchRequest('persona-uuid-1', { name: '  Novo Nome  ' }));
    const body = (await res.json()) as { success: boolean };

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(updated[0]).toMatchObject({ name: 'Novo Nome' });
  });

  it('nova foto substitui a antiga: sobe arquivo novo e remove o antigo', async () => {
    const { uploaded, removed, updated } = mockSupabaseForPatch();

    const res = await PATCH(patchRequest('persona-uuid-1', { name: 'Com Foto' }, [photo()]));

    expect(res.status).toBe(200);
    // Pinned layout, PATCH writer: {userId}/{personaId}/photo.png
    expect(uploaded[0].path).toBe(`${USER_ID}/persona-uuid-1/photo.png`);
    expect(updated[0]).toMatchObject({ photo_path: uploaded[0].path });
    expect(removed).toContain(`${USER_ID}/foto-antiga.png`);
  });

  //---------------
  // personas_visual_identity_check: photo_path + avatar_url = at most one.
  // Setting avatar_url without clearing photo_path left the row with BOTH,
  // the check rejected the update (500 on every save) and, without the
  // check, the UI would silently prefer the wrong face.
  //---------------
  it('trocar de foto para personagem limpa photo_path no MESMO update', async () => {
    const { updated, removed } = mockSupabaseForPatch({
      existing: {
        id: 'persona-uuid-1',
        user_id: USER_ID,
        name: 'Com Foto',
        photo_path: `${USER_ID}/foto-antiga.png`,
        avatar_url: null,
        voice_id: 'voz',
        voice_audio_path: null,
      },
    });

    const res = await PATCH(
      patchRequest('persona-uuid-1', { avatarUrl: '/caracter-samples/file-3.png' }),
    );

    expect(res.status).toBe(200);
    // The single update carries the swap; a separate clear would race.
    expect(updated[0]).toMatchObject({
      avatar_url: '/caracter-samples/file-3.png',
      photo_path: null,
    });
    expect(removed).toContain(`${USER_ID}/foto-antiga.png`);
  });

  it('trocar para voz da casa grava voice_id e limpa voice_audio_path', async () => {
    const { updated, removed } = mockSupabaseForPatch({
      existing: {
        id: 'persona-uuid-1',
        user_id: USER_ID,
        name: 'Antiga',
        photo_path: null,
        avatar_url: null,
        voice_id: null,
        voice_audio_path: `${USER_ID}/voz-antiga.mp3`,
      },
    });

    const res = await PATCH(patchRequest('persona-uuid-1', { voiceId: 'voz-nova' }));

    expect(res.status).toBe(200);
    expect(updated[0]).toMatchObject({ voice_id: 'voz-nova', voice_audio_path: null });
    expect(removed).toContain(`${USER_ID}/voz-antiga.mp3`);
  });

  it('returns 400 with an unsupported photo format', async () => {
    mockSupabaseForPatch();
    const gif = new File(['gif'], 'foto.gif', { type: 'image/gif' });

    const res = await PATCH(patchRequest('persona-uuid-1', {}, [gif]));

    expect(res.status).toBe(400);
  });

  it('retorna 500 quando o update falha', async () => {
    mockSupabaseForPatch({ updateError: { message: 'rls blocked' } });

    const res = await PATCH(patchRequest('persona-uuid-1', { name: 'Nova' }));

    expect(res.status).toBe(500);
  });

  //---------------
  // Preservation — what was not edited must stay exactly
  // as it was: the update may only cite changed fields and the
  // Storage cleanup may only remove replaced files.
  //---------------

  describe('preservação de dados não editados', () => {
    const PERSONA_COMPLETA = {
      id: 'persona-uuid-1',
      user_id: USER_ID,
      name: 'Ana Original',
      photo_path: `${USER_ID}/foto-original.png`,
      avatar_url: null,
      voice_id: 'voz-original',
      voice_audio_path: null,
    };

    it('changing only the name preserves photo and voice: update contains only name', async () => {
      const { updated, removed } = mockSupabaseForPatch({ existing: PERSONA_COMPLETA });

      const res = await PATCH(patchRequest('persona-uuid-1', { name: 'Só Nome' }));

      expect(res.status).toBe(200);
      expect(Object.keys(updated[0]).sort()).toEqual(['name']);
      expect(updated[0].name).toBe('Só Nome');
      expect(removed).toEqual([]);
    });

    it('changing only the voice preserves name and photo: update omits photo fields', async () => {
      const { updated, removed } = mockSupabaseForPatch({ existing: PERSONA_COMPLETA });

      const res = await PATCH(patchRequest('persona-uuid-1', { voiceId: 'voz-nova' }));

      expect(res.status).toBe(200);
      expect(Object.keys(updated[0]).sort()).toEqual(['voice_audio_path', 'voice_id']);
      expect(updated[0].voice_id).toBe('voz-nova');
      expect(removed).toEqual([]);
    });

    it('changing only the photo preserves name and voice: update omits voice fields', async () => {
      const { updated, removed } = mockSupabaseForPatch({ existing: PERSONA_COMPLETA });

      const res = await PATCH(patchRequest('persona-uuid-1', {}, [photo()]));

      expect(res.status).toBe(200);
      expect(Object.keys(updated[0]).sort()).toEqual(['avatar_url', 'photo_path']);
      expect(removed).toEqual([`${USER_ID}/foto-original.png`]);
    });

    it('mudar nome e voz junto preserva a foto original', async () => {
      const { uploaded, updated, removed } = mockSupabaseForPatch({ existing: PERSONA_COMPLETA });

      const res = await PATCH(
        patchRequest('persona-uuid-1', { name: 'Ana Editada', voiceId: 'voz-nova' }),
      );

      expect(res.status).toBe(200);
      expect(Object.keys(updated[0]).sort()).toEqual(['name', 'voice_audio_path', 'voice_id']);
      expect(uploaded).toEqual([]);
      expect(removed).toEqual([]);
    });

    it('changing only the name uploads no new file', async () => {
      const { uploaded } = mockSupabaseForPatch({ existing: PERSONA_COMPLETA });

      await PATCH(patchRequest('persona-uuid-1', { name: 'Só Nome' }));

      expect(uploaded).toEqual([]);
    });

    it('preferences: updating language updates only language', async () => {
      const { updated } = mockSupabaseForPatch({ existing: PERSONA_COMPLETA });

      const res = await PATCH(patchRequest('persona-uuid-1', { language: 'en' }));

      expect(res.status).toBe(200);
      expect(Object.keys(updated[0])).toEqual(['language']);
      expect(updated[0].language).toBe('en');
    });

    it('preferences: updates videoAspect, scriptPrompt and paragraphNumber together', async () => {
      const { updated } = mockSupabaseForPatch({ existing: PERSONA_COMPLETA });

      const res = await PATCH(
        patchRequest('persona-uuid-1', {
          videoAspect: '1:1',
          scriptPrompt: 'Direto ao ponto.',
          paragraphNumber: '2',
        }),
      );

      expect(res.status).toBe(200);
      expect(Object.keys(updated[0]).sort()).toEqual(['paragraph_number', 'script_prompt', 'video_aspect']);
      expect(updated[0]).toMatchObject({
        video_aspect: '1:1',
        script_prompt: 'Direto ao ponto.',
        paragraph_number: 2,
      });
    });

    it('niche: updates only the niche', async () => {
      const { updated } = mockSupabaseForPatch({ existing: PERSONA_COMPLETA });

      const res = await PATCH(patchRequest('persona-uuid-1', { niche: 'viagens de motorhome' }));

      expect(res.status).toBe(200);
      expect(Object.keys(updated[0])).toEqual(['niche']);
      expect(updated[0].niche).toBe('viagens de motorhome');
    });

    it('niche: an empty string is treated as a missing field', async () => {
      mockSupabaseForPatch({ existing: PERSONA_COMPLETA });

      const res = await PATCH(patchRequest('persona-uuid-1', { niche: '' }));

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain('Nothing to update');
    });

    it('nicho: retorna 400 acima de 300 caracteres no PATCH', async () => {
      mockSupabaseForPatch({ existing: PERSONA_COMPLETA });

      const res = await PATCH(patchRequest('persona-uuid-1', { niche: 'x'.repeat(301) }));

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain('niche');
    });

    it('preferences: updating language preserves photo and voice intact', async () => {
      const { uploaded, removed, updated } = mockSupabaseForPatch({ existing: PERSONA_COMPLETA });

      await PATCH(patchRequest('persona-uuid-1', { language: 'es' }));

      expect(Object.keys(updated[0])).toEqual(['language']);
      expect(uploaded).toEqual([]);
      expect(removed).toEqual([]);
    });

    it('preferences: returns 400 with an invalid videoAspect on PATCH', async () => {
      mockSupabaseForPatch({ existing: PERSONA_COMPLETA });

      const res = await PATCH(patchRequest('persona-uuid-1', { videoAspect: '21:9' }));

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain('videoAspect');
    });

    it('preferences: returns 400 with an invalid paragraphNumber on PATCH', async () => {
      mockSupabaseForPatch({ existing: PERSONA_COMPLETA });

      const res = await PATCH(patchRequest('persona-uuid-1', { paragraphNumber: '0' }));

      expect(res.status).toBe(400);
    });
  });
});

describe('DELETE /api/persona', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retorna 500 quando o delete falha', async () => {
    mockSupabaseForDelete({
      code: '23503',
      message: 'update or delete on table violates foreign key constraint',
    });

    const res = await DELETE(
      new Request('http://localhost/api/persona?personaId=persona-uuid-1', { method: 'DELETE' }),
    );
    const body = (await res.json()) as { success: boolean };

    expect(res.status).toBe(500);
    expect(body.success).toBe(false);
  });

  it('inclui os image_paths da biblioteca na limpeza do storage', async () => {
    const removed: string[][] = [];
    const client = {
      auth: {
        getUser: vi.fn(async () => ({ data: { user: { id: USER_ID } }, error: null })),
      },
      storage: {
        from: vi.fn(() => ({
          remove: vi.fn(async (paths: string[]) => {
            removed.push(paths);
            return { error: null };
          }),
        })),
      },
      from: vi.fn((table: string) => {
        // The library rows vanish via on delete cascade, but their storage
        // objects must be collected BEFORE the persona row is deleted.
        if (table === 'persona_images') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(async () => ({
                  data: [{ image_path: 'uid/img1.png' }, { image_path: 'uid/img2.png' }],
                  error: null,
                })),
              })),
            })),
          };
        }
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                order: vi.fn(() => ({
                  limit: vi.fn(async () => ({ data: [], error: null, count: 0 })),
                })),
                single: vi.fn(async () => ({
                  data: { id: 'persona-uuid-1', photo_path: null, voice_audio_path: null },
                  error: null,
                })),
                then: (resolve: (v: unknown) => void) => {
                  resolve({ data: [], error: null });
                },
              })),
            })),
          })),
          delete: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(async () => ({ error: null })),
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

    const res = await DELETE(
      new Request('http://localhost/api/persona?personaId=persona-uuid-1', { method: 'DELETE' }),
    );
    const body = (await res.json()) as { success: boolean };

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(removed).toHaveLength(1);
    expect(removed[0]).toEqual(['uid/img1.png', 'uid/img2.png']);
  });

  it('retorna 500 quando a leitura da biblioteca falha', async () => {
    const client = {
      auth: {
        getUser: vi.fn(async () => ({ data: { user: { id: USER_ID } }, error: null })),
      },
      storage: { from: vi.fn(() => ({ remove: vi.fn(async () => ({ error: null })) })) },
      from: vi.fn((table: string) => {
        if (table === 'persona_images') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(async () => ({ data: null, error: { message: 'db down' } })),
              })),
            })),
          };
        }
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                order: vi.fn(() => ({
                  limit: vi.fn(async () => ({ data: [], error: null, count: 0 })),
                })),
                single: vi.fn(async () => ({
                  data: { id: 'persona-uuid-1', photo_path: null, voice_audio_path: null },
                  error: null,
                })),
                then: (resolve: (v: unknown) => void) => {
                  resolve({ data: [], error: null });
                },
              })),
            })),
          })),
          delete: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(async () => ({ error: null })),
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

    const res = await DELETE(
      new Request('http://localhost/api/persona?personaId=persona-uuid-1', { method: 'DELETE' }),
    );

    expect(res.status).toBe(500);
  });
});
