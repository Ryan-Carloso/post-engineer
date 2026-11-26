// @vitest-environment node
import '@testing-library/jest-dom/vitest';
import { NextResponse } from 'next/server';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { findRepoRoot } from '@/test/repo-root';

vi.mock('next/server', async (importOriginal) => {
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
vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(async () => [{ address: '1.2.3.4' }]),
}));
vi.mock('@/lib/rate-limit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/rate-limit')>();
  return { ...actual, applyRateLimit: vi.fn(async () => null) };
});
const posthogMock = vi.hoisted(() => ({
  capture: vi.fn(),
  captureAs: vi.fn(),
  captureException: vi.fn(),
  captureExceptionAs: vi.fn(),
}));
vi.mock('@/lib/posthog-server', () => ({
  getPostHogServer: vi.fn(() => posthogMock),
}));

import { POST, PATCH, DELETE } from '../route';
import { CreatePersonaResponseSchema, UpdatePersonaResponseSchema } from '@/lib/contracts/personas';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { requireSupabaseSession } from '@/lib/request-auth';
import { trackApiEvent } from '@/lib/analytics';
import { logger } from '@/lib/logger';

const warnSpy = vi.spyOn(logger, 'warn');
function loggedWarnings(): string[] {
  return warnSpy.mock.calls.map((call) => String(call[0]));
}

const USER_ID = 'user-uuid-1';

function mockSupabase(overrides: {
  user?: { id: string } | null;
  uploadError?: { message: string } | null;
  insertError?: { message: string } | null;
  socialAccounts?: Array<{ provider: string; provider_account_id: string }>;
  bindingError?: { message: string } | null;
} = {}) {
  const uploaded: Array<{ path: string; options: { contentType: string } }> = [];
  const inserted: Array<Record<string, unknown>> = [];
  const bindingRows: Array<Record<string, unknown>> = [];

  const storageFrom = {
    upload: vi.fn(async (path: string, _body: unknown, options: { contentType: string }) => {
      uploaded.push({ path, options });
      return { data: { path }, error: overrides.uploadError ?? null };
    }),
    remove: vi.fn(async () => ({ error: null })),
  };

  const personasFrom = {
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
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(async () => ({ data: { id: 'persona-uuid-1' }, error: null })),
        })),
      })),
    })),
    delete: vi.fn(() => ({
      eq: vi.fn(() => ({
        eq: vi.fn(async () => ({ error: null })),
      })),
    })),
  };

  const socialAccountsFrom = {
    select: vi.fn(() => ({
      eq: vi.fn(async () => ({
        data: overrides.socialAccounts ?? [{ provider: 'youtube', provider_account_id: 'acct-1' }],
        error: null,
      })),
    })),
  };

  const bindingFrom = {
    delete: vi.fn(() => ({
      eq: vi.fn(async () => ({ error: null })),
    })),
    insert: vi.fn((values: Record<string, unknown> | Array<Record<string, unknown>>) => {
      bindingRows.push(...(Array.isArray(values) ? values : [values]));
      return { error: overrides.bindingError ?? null };
    }),
  };

  const defaultFrom = {
    insert: personasFrom.insert,
  };

  const client = {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: overrides.user === null ? null : { id: USER_ID, ...overrides.user } },
        error: null,
      })),
    },
    storage: { from: vi.fn(() => storageFrom) },
    from: vi.fn((table: string) => {
      if (table === 'personas') return personasFrom;
      if (table === 'social_accounts') return socialAccountsFrom;
      if (table === 'persona_default_accounts') return bindingFrom;
      return defaultFrom;
    }),
  };

  vi.mocked(createSupabaseServerClient).mockResolvedValue(client as never);
  vi.mocked(requireSupabaseSession).mockResolvedValue({
    auth: { userId: USER_ID, accessToken: 'cookie-token' },
    error: null,
  });
  vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);
  return { client, uploaded, inserted, bindingRows };
}

function formRequest(fields: Record<string, string>, files: File[] = [], opts: { omitBinding?: boolean } = {}): Request {
  const formData = new FormData();
  const withBinding = opts.omitBinding
    ? fields
    : { publishingAccounts: JSON.stringify({ youtube: ['acct-1'] }), ...fields };
  for (const [key, value] of Object.entries(withBinding)) {
    formData.append(key, value);
  }
  for (const file of files) {
    formData.append('photo', file);
  }
  return new Request('http://localhost/api/persona', { method: 'POST', body: formData });
}

const photo = () => new File(['png'], 'foto.png', { type: 'image/png' });


describe('POST /api/persona — account binding (issue #572)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const validFields = {
    name: 'Canal Ninja',
    avatarUrl: 'data:image/png;base64,IA',
    voiceId: 'chatterbox:kokoro_af_heart',
  };

  it('saves the binding rows when creation succeeds', async () => {
    const { bindingRows } = mockSupabase();
    const res = await POST(formRequest(validFields));
    const body = (await res.json()) as { success: boolean; personaId?: string };
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(bindingRows).toEqual([
      { persona_id: body.personaId, provider: 'youtube', provider_account_id: 'acct-1' },
    ]);
  });

  it('rejects creation with no publishingAccounts field', async () => {
    mockSupabase();
    const res = await POST(formRequest(validFields, [], { omitBinding: true }));
    const body = (await res.json()) as { error?: string };
    expect(res.status).toBe(400);
    expect(body.error).toBe('Select at least one publishing account for this persona.');
  });

  it('rejects creation with an empty binding', async () => {
    mockSupabase();
    const res = await POST(
      formRequest({ ...validFields, publishingAccounts: JSON.stringify({ youtube: [] }) }),
    );
    const body = (await res.json()) as { error?: string };
    expect(res.status).toBe(400);
    expect(body.error).toBe('Select at least one publishing account for this persona.');
  });

  it('rejects creation with malformed publishingAccounts JSON', async () => {
    mockSupabase();
    const res = await POST(formRequest({ ...validFields, publishingAccounts: '{not json' }));
    const body = (await res.json()) as { error?: string };
    expect(res.status).toBe(400);
    expect(body.error).toBe('publishingAccounts must be valid JSON.');
  });

  it('rejects creation binding an account the user does not own', async () => {
    mockSupabase({ socialAccounts: [] });
    const res = await POST(formRequest(validFields));
    const body = (await res.json()) as { error?: string; code?: string };
    expect(res.status).toBe(400);
    expect(body.code).toBe('INVALID_PROVIDER_ACCOUNT');
    expect(body.error).toBe('Account acct-1 is not a connected youtube account of this user.');
  });

  it('rolls the persona back when the binding insert fails', async () => {
    const { client } = mockSupabase({ bindingError: { message: 'db down' } });
    const res = await POST(formRequest(validFields));
    const body = (await res.json()) as { error?: string };
    expect(res.status).toBe(500);
    expect(body.error).toBe('Failed to bind publishing accounts to the persona.');
    expect(client.from).toHaveBeenCalledWith('personas');
  });
});

describe('POST /api/persona', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 without a session', async () => {
    mockSupabase();
    vi.mocked(requireSupabaseSession).mockResolvedValue({
      auth: null,
      error: NextResponse.json({ success: false }, { status: 401 }),
    });
    const res = await POST(formRequest({ name: 'Ana' }));
    expect(res.status).toBe(401);
  });

  it('returns 400 without a name', async () => {
    const { inserted } = mockSupabase();
    const res = await POST(formRequest({}));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code?: string }).code).toBe('VALIDATION_FAILED');
    expect(inserted).toEqual([]);
  });

  it('creates a persona with no photo: no upload, photo_path null', async () => {
    const { inserted, uploaded } = mockSupabase();
    const res = await POST(formRequest({ name: '  Ana  ' }));
    const body = (await res.json()) as { success: boolean; personaId: string };
    expect(res.status).toBe(200);
    expect(CreatePersonaResponseSchema.safeParse(body).success).toBe(true);
    expect(body).toEqual({ success: true, personaId: inserted[0]?.id });
    expect(inserted[0]?.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(uploaded).toEqual([]);
    expect(inserted[0]).toMatchObject({ user_id: USER_ID, name: 'Ana', photo_path: null });
    expect(Object.keys(inserted[0] ?? {}).sort()).toEqual(['ai_label', 'id', 'identity_card', 'name', 'photo_path', 'user_id']);
  });

  it('creates a persona with an uploaded photo: uploads to Storage and inserts the path', async () => {
    const { inserted, uploaded } = mockSupabase();
    const res = await POST(formRequest({ name: 'Ana' }, [photo()]));
    expect(res.status).toBe(200);
    expect(uploaded).toHaveLength(1);
    expect(uploaded[0]?.options.contentType).toBe('image/png');
    expect(inserted[0]?.photo_path).toBe(uploaded[0]?.path);
  });

  it('returns 400 with an unsupported photo format', async () => {
    const { inserted, uploaded } = mockSupabase();
    const res = await POST(formRequest({ name: 'Ana' }, [new File(['gif'], 'a.gif', { type: 'image/gif' })]));
    expect(res.status).toBe(400);
    expect(uploaded).toEqual([]);
    expect(inserted).toEqual([]);
  });

  it('tracks persona_created on success and not on failure', async () => {
    const { inserted } = mockSupabase();
    await POST(formRequest({ name: 'Ana' }));
    expect(trackApiEvent).toHaveBeenCalledWith('persona_created', { personaId: inserted[0]?.id });
    vi.mocked(trackApiEvent).mockClear();
    mockSupabase({ insertError: { message: 'boom' } });
    await POST(formRequest({ name: 'Ana' }));
    expect(trackApiEvent).not.toHaveBeenCalled();
  });

  it('returns 500 when the Storage upload fails', async () => {
    const { inserted } = mockSupabase({ uploadError: { message: 'down' } });
    const res = await POST(formRequest({ name: 'Ana' }, [photo()]));
    expect(res.status).toBe(500);
    expect(inserted).toEqual([]);
  });

  it('returns 500 when the insert fails', async () => {
    mockSupabase({ insertError: { message: 'boom' } });
    const res = await POST(formRequest({ name: 'Ana' }));
    expect(res.status).toBe(500);
  });

  it('persona insert payload stays in sync with public.personas (both directions)', async () => {
    const { readFileSync, readdirSync } = await import('node:fs');
    const { join } = await import('node:path');
    const migrationsDir = join(findRepoRoot(import.meta.url), 'supabase', 'migrations');
    const sql = readFileSync(join(migrationsDir, '001_schema.sql'), 'utf8');
    const tableMatch = sql.match(
      /create table if not exists public\.personas \(([\s\S]*?)\n\);/i,
    );
    expect(tableMatch).not.toBeNull();
    const columnBlock = tableMatch?.[1] ?? '';
    const constraintKeywords = new Set([
      'primary',
      'unique',
      'foreign',
      'check',
      'constraint',
      'exclude',
    ]);
    const columns = new Map<string, boolean>();
    for (const line of columnBlock.split('\n')) {
      const trimmed = line.trim();
      const name = trimmed.split(/\s+/)[0]?.replace(/["`,]/g, '');
      if (!name || name.startsWith('--') || constraintKeywords.has(name)) {
        continue;
      }
      const definition = trimmed.replace(/--.*$/, '');
      const notNull =
        /\bnot null\b/i.test(definition) ||
        /\bprimary key\b/i.test(definition);
      columns.set(name, notNull && !/\bdefault\b/i.test(definition));
    }
    for (const file of readdirSync(migrationsDir).sort()) {
      if (!file.endsWith('.sql') || file === '001_schema.sql') continue;
      const later = readFileSync(join(migrationsDir, file), 'utf8');
      const additions = later.matchAll(
        /alter\s+table\s+(?:if\s+exists\s+)?public\.personas\s+add\s+column\s+(?:if\s+not\s+exists\s+)?([\w"]+)/gi,
      );
      for (const addition of additions) {
        const name = (addition[1] ?? '').replace(/"/g, '');
        if (name) columns.set(name, false);
      }
      const drops = later.matchAll(
        /alter\s+table\s+(?:if\s+exists\s+)?public\.personas\s+drop\s+column\s+(?:if\s+exists\s+)?([\w"]+)/gi,
      );
      for (const drop of drops) {
        const name = (drop[1] ?? '').replace(/"/g, '');
        if (name) columns.delete(name);
      }
    }
    expect(columns.has('voice_id')).toBe(false);
    expect(columns.has('identity_card')).toBe(true);
    expect(columns.get('user_id')).toBe(true);
    expect(columns.get('created_at')).toBe(false);

    const { inserted } = mockSupabase();
    const res = await POST(
      formRequest({ name: 'Canal Ninja' }),
    );

    expect(res.status).toBe(200);
    const payload = inserted[0];
    expect(payload).toBeDefined();

    for (const key of Object.keys(payload)) {
      expect(
        columns.has(key),
        `insert key "${key}" is not a public.personas column`,
      ).toBe(true);
    }
    for (const [name, required] of columns) {
      if (required) {
        expect(payload).toHaveProperty(name);
      }
    }
  });

  it('returns 400 with an invalid multipart payload', async () => {
    const res = await POST(
      new Request('http://localhost/api/persona', {
        method: 'POST',
        headers: { 'content-type': 'multipart/form-data; boundary=bad' },
        body: 'not a multipart body',
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; code?: string };
    expect(body.error).toBe('Invalid multipart payload.');
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(loggedWarnings()).toContain('[POST /api/persona] 400 Invalid multipart payload.');
  });

});


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
              data: { id: 'persona-uuid-1', photo_path: null },
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
          eq: vi.fn(async () => ({ error: deleteError })),
        })),
      })),
    })),
  };
  vi.mocked(createSupabaseServerClient).mockResolvedValue(client as never);
  vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);
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
        eq: vi.fn(() => ({
          eq: vi.fn(async () => ({ error: overrides.updateError ?? null })),
        })),
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
  vi.mocked(createSupabaseServiceClient).mockReturnValue(client as never);
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
    formData.append('photo', file);
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
    const body = (await res.json()) as { error: string; code?: string; field?: string };
    expect(body.error).toBe('personaId is required.');
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(body.field).toBe('personaId');
    expect(loggedWarnings()).toContain('[PATCH /api/persona] 400 personaId is required.');
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
    const body = (await res.json()) as { error: string; code?: string };
    expect(body.error).toBe('Nothing to update.');
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(loggedWarnings()).toContain('[PATCH /api/persona] 400 Nothing to update.');
  });

  it('atualiza apenas o nome', async () => {
    const { updated } = mockSupabaseForPatch();

    const res = await PATCH(patchRequest('persona-uuid-1', { name: '  Novo Nome  ' }));
    const body = (await res.json()) as { success: boolean };

    expect(res.status).toBe(200);
    expect(UpdatePersonaResponseSchema.safeParse(body).success).toBe(true);
    expect(body.success).toBe(true);
    expect(updated[0]).toMatchObject({ name: 'Novo Nome' });
  });

  it('nova foto substitui a antiga: sobe arquivo novo e remove o antigo', async () => {
    const { uploaded, removed, updated } = mockSupabaseForPatch();

    const res = await PATCH(patchRequest('persona-uuid-1', { name: 'Com Foto' }, [photo()]));

    expect(res.status).toBe(200);
    expect(uploaded[0].path).toBe(`${USER_ID}/persona-uuid-1/photo.png`);
    expect(updated[0]).toMatchObject({ photo_path: uploaded[0].path });
    expect(removed).toContain(`${USER_ID}/foto-antiga.png`);
  });

  it('returns 400 with an unsupported photo format', async () => {
    mockSupabaseForPatch();
    const gif = new File(['gif'], 'foto.gif', { type: 'image/gif' });

    const res = await PATCH(patchRequest('persona-uuid-1', {}, [gif]));

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; code?: string; field?: string };
    expect(body.error).toBe('Unsupported photo format: image/gif');
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(body.field).toBeUndefined();
    expect(loggedWarnings()).toContain('[PATCH /api/persona] 400 Unsupported photo format.');
  });

  it('retorna 500 quando o update falha', async () => {
    mockSupabaseForPatch({ updateError: { message: 'rls blocked' } });

    const res = await PATCH(patchRequest('persona-uuid-1', { name: 'Nova' }));

    expect(res.status).toBe(500);
  });

  describe('preservação de dados não editados', () => {
    const PERSONA_COMPLETA = {
      id: 'persona-uuid-1',
      user_id: USER_ID,
      name: 'Ana Original',
      photo_path: `${USER_ID}/foto-original.png`,
      avatar_url: null,
    };

    it('changing only the name uploads no new file', async () => {
      const { uploaded } = mockSupabaseForPatch({ existing: PERSONA_COMPLETA });

      await PATCH(patchRequest('persona-uuid-1', { name: 'Só Nome' }));

      expect(uploaded).toEqual([]);
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

});
