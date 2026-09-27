// @vitest-environment node
// POST /api/persona with an image library: `images` files plus parallel
// `imageTags` / `imageDescriptions` JSON arrays and `imagePrimaryIndex`.
// Auth and Supabase are mocked boundaries; form parsing, validation, the
// 10-image cap, and rollback are real.
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/request-auth', () => ({
  requireSupabaseSession: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock('@/lib/supabase/service', () => ({
  createSupabaseServiceClient: vi.fn(),
}));

import { POST } from '../route';
import { requireSupabaseSession } from '@/lib/request-auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';

const USER_ID = 'user-uuid-1';
const PERSONA_ID = 'persona-uuid-1';

function terminal(result: unknown): Record<string, unknown> {
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'neq', 'in', 'insert', 'update', 'delete', 'single']) {
    chain[method] = vi.fn(() => chain);
  }
  chain.then = (resolve: (value: unknown) => void): Promise<unknown> =>
    Promise.resolve(result).then(resolve);
  return chain;
}

function mockClient() {
  const calls = {
    personaInserts: 0,
    personaDeletes: 0,
    imageInserts: [] as Array<Record<string, unknown>>,
    primaryUpdates: [] as Array<{ id: string; isPrimary: boolean }>,
  };
  let imageSeq = 0;
  const client = {
    from: vi.fn((table: string) => {
      if (table === 'personas') {
        return {
          insert: vi.fn(() => {
            calls.personaInserts += 1;
            return terminal({ data: { id: PERSONA_ID }, error: null });
          }),
          delete: vi.fn(() => {
            calls.personaDeletes += 1;
            return terminal({ error: null });
          }),
        };
      }
      return {
        select: vi.fn((columns: string) =>
          columns === 'id'
            ? terminal({ count: 0, error: null })
            : terminal({ data: [], error: null }),
        ),
        insert: vi.fn((values: Record<string, unknown>) => {
          imageSeq += 1;
          calls.imageInserts.push(values);
          return terminal({
            data: { id: `img-${imageSeq}`, ...values, is_primary: false },
            error: null,
          });
        }),
        update: vi.fn((values: Record<string, unknown>) => ({
          eq: vi.fn((column: string, value: unknown) => {
            if (column === 'id' && typeof value === 'string') {
              calls.primaryUpdates.push({ id: value, isPrimary: values.is_primary === true });
            }
            return { neq: vi.fn(() => terminal({ error: null })) };
          }),
        })),
        delete: vi.fn(() => terminal({ error: null })),
      };
    }),
    storage: {
      from: vi.fn(() => ({
        upload: vi.fn(async () => ({ error: null })),
        remove: vi.fn(async () => ({ error: null })),
      })),
    },
  };
  vi.mocked(createSupabaseServerClient).mockResolvedValue(client as never);
  vi.mocked(requireSupabaseSession).mockResolvedValue({
    auth: { userId: USER_ID, accessToken: 'cookie-token' },
    error: null,
  } as never);
  return calls;
}

const png = (name: string, size = 1024): File =>
  new File([new Uint8Array(size)], name, { type: 'image/png' });

function createRequest(fields: Record<string, string>, images: File[] = []): Request {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  form.append('photo', png('main.png'));
  for (const image of images) form.append('images', image);
  return new Request('http://localhost/api/persona', { method: 'POST', body: form });
}

const BASE_FIELDS = {
  name: 'Ana',
  voiceId: 'voice-1',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/persona with image library', () => {
  it('creates the persona with library images, tags, and descriptions', async () => {
    const calls = mockClient();
    const res = await POST(
      createRequest(
        {
          ...BASE_FIELDS,
          imageTags: JSON.stringify(['casual', 'formal']),
          imageDescriptions: JSON.stringify(['at the park', 'at the office']),
        },
        [png('a.png'), png('b.png')],
      ),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; personaId: string; imageIds: string[] };
    expect(body.success).toBe(true);
    expect(body.personaId).toBe(PERSONA_ID);
    expect(body.imageIds).toHaveLength(2);
    expect(calls.imageInserts[0].tag).toBe('casual');
    expect(calls.imageInserts[1].description).toBe('at the office');
  });

  it('marks the chosen primary index', async () => {
    const calls = mockClient();
    const res = await POST(
      createRequest({ ...BASE_FIELDS, imagePrimaryIndex: '1' }, [png('a.png'), png('b.png')]),
    );
    expect(res.status).toBe(200);
    const primary = calls.primaryUpdates.find((update) => update.isPrimary);
    expect(primary?.id).toBe('img-2');
  });

  it('rejects more than 10 library images before creating anything', async () => {
    const calls = mockClient();
    const images = Array.from({ length: 11 }, (_, i) => png(`img-${i}.png`));
    const res = await POST(createRequest(BASE_FIELDS, images));
    expect(res.status).toBe(400);
    expect(calls.personaInserts).toBe(0);
  });

  it('rejects an invalid file before creating anything', async () => {
    const calls = mockClient();
    const bad = new File(['x'], 'doc.pdf', { type: 'application/pdf' });
    const res = await POST(createRequest(BASE_FIELDS, [png('a.png'), bad]));
    expect(res.status).toBe(400);
    expect(calls.personaInserts).toBe(0);
  });

  it('rejects library images in faceless mode', async () => {
    mockClient();
    const res = await POST(
      createRequest({ ...BASE_FIELDS, personaMode: 'faceless' }, [png('a.png')]),
    );
    expect(res.status).toBe(400);
  });

  it('still creates a persona without library images', async () => {
    const calls = mockClient();
    const form = new FormData();
    form.append('name', 'Ana');
    form.append('voiceId', 'voice-1');
    form.append('photo', png('main.png'));
    const res = await POST(new Request('http://localhost/api/persona', { method: 'POST', body: form }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { imageIds: string[] };
    expect(body.imageIds).toEqual([]);
    expect(calls.imageInserts).toHaveLength(0);
  });
});
