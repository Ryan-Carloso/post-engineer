// @vitest-environment node
// API routes use native Request/FormData (undici); jsdom mixes
// implementations and hangs `request.formData()`.
import { describe, expect, it, vi, beforeEach } from 'vitest';

//---------------
// Tests for /api/persona/images — persona image library CRUD.
// Auth and Supabase are mocked boundaries; ownership checks, the 10-image
// limit, file validation, and primary-image handling are real.
//---------------

vi.mock('@/lib/request-auth', () => ({
  requireSupabaseSession: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock('@/lib/supabase/service', () => ({
  createSupabaseServiceClient: vi.fn(),
}));

import { GET, POST, PATCH, DELETE } from '../images/route';
import { requireSupabaseSession } from '@/lib/request-auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';

const USER_ID = 'user-uuid-1';
const PERSONA_ID = 'persona-uuid-1';
const IMAGE_ROW = {
  id: 'img-uuid-1',
  persona_id: PERSONA_ID,
  image_path: `${USER_ID}/abc.png`,
  tag: 'casual',
  description: 'woman in jeans at the park',
  is_primary: false,
  created_at: '2026-09-27T00:00:00Z',
};

interface DbState {
  persona: { id: string } | null;
  imageCount: number;
  imageRow: typeof IMAGE_ROW | null;
  listRows: unknown[];
  insertedRow: unknown | null;
  updatedRow: unknown | null;
}

function terminal(result: unknown): Record<string, unknown> {
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'neq', 'in', 'order', 'insert', 'update', 'delete', 'single']) {
    chain[method] = vi.fn(() => chain);
  }
  chain.then = (resolve: (value: unknown) => void): Promise<unknown> =>
    Promise.resolve(result).then(resolve);
  return chain;
}

function mockClient(state: Partial<DbState> = {}) {
  const full: DbState = {
    persona: { id: PERSONA_ID },
    imageCount: 0,
    imageRow: null,
    listRows: [],
    insertedRow: null,
    updatedRow: null,
    ...state,
  };
  const calls = { unsetPrimary: 0, removedPaths: [] as string[] };
  const updateMock = vi.fn(() => {
    calls.unsetPrimary += 1;
    return terminal({ data: full.updatedRow, error: null });
  });
  const client = {
    from: vi.fn((table: string) => {
      if (table === 'personas') {
        return terminal({ data: full.persona, error: full.persona ? null : { message: 'nf' } });
      }
      return {
        select: vi.fn((columns: string) => {
          if (columns === 'id') {
            return terminal({ count: full.imageCount, error: null });
          }
          if (columns.includes('persona_id')) {
            return terminal({
              data: full.imageRow,
              error: full.imageRow ? null : { message: 'nf' },
            });
          }
          return terminal({ data: full.listRows, error: null });
        }),
        insert: vi.fn(() =>
          terminal({ data: full.insertedRow, error: full.insertedRow ? null : { message: 'ins' } }),
        ),
        update: updateMock,
        delete: vi.fn(() => terminal({ error: null })),
      };
    }),
    storage: {
      from: vi.fn(() => ({
        upload: vi.fn(async () => ({ error: null })),
        remove: vi.fn(async (paths: string[]) => {
          calls.removedPaths.push(...paths);
          return { error: null };
        }),
        createSignedUrl: vi.fn(async (path: string) => ({
          data: { signedUrl: `https://supabase.test/signed/${path}` },
          error: null,
        })),
      })),
    },
  };
  vi.mocked(createSupabaseServerClient).mockResolvedValue(client as never);
  return { calls, client };
}

function mockAuth(auth: { userId: string; isApiKey?: boolean; personaIds?: string[] } | null): void {
  vi.mocked(requireSupabaseSession).mockResolvedValue(
    auth === null
      ? ({ auth: null, error: new Response('unauthorized', { status: 401 }) } as never)
      : ({
        auth: {
          userId: auth.userId,
          isApiKey: auth.isApiKey ?? false,
          personaIds: auth.personaIds ?? null,
        },
        error: null,
      } as never),
  );
}

function imageFile(name = 'photo.png', type = 'image/png', size = 1024): File {
  return new File([new Uint8Array(size)], name, { type });
}

function postForm(fields: Record<string, string | File>): Request {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  return new Request('http://localhost/api/persona/images', { method: 'POST', body: form });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/persona/images', () => {
  it('requires authentication', async () => {
    mockAuth(null);
    mockClient();
    const res = await GET(new Request('http://localhost/api/persona/images?personaId=x'));
    expect(res.status).toBe(401);
  });

  it('requires personaId', async () => {
    mockAuth({ userId: USER_ID });
    mockClient();
    const res = await GET(new Request('http://localhost/api/persona/images'));
    expect(res.status).toBe(400);
  });

  it('rejects a scoped API key without access to the persona', async () => {
    mockAuth({ userId: USER_ID, isApiKey: true, personaIds: ['other-persona'] });
    mockClient();
    const res = await GET(
      new Request(`http://localhost/api/persona/images?personaId=${PERSONA_ID}`),
    );
    expect(res.status).toBe(403);
  });

  it('lists the persona images with signed URLs', async () => {
    mockAuth({ userId: USER_ID });
    mockClient({ listRows: [IMAGE_ROW] });
    const res = await GET(
      new Request(`http://localhost/api/persona/images?personaId=${PERSONA_ID}`),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      images: Array<{ id: string; image_url: string | null }>;
    };
    expect(body.success).toBe(true);
    expect(body.images).toHaveLength(1);
    expect(body.images[0]?.image_url).toBe(
      `https://supabase.test/signed/${IMAGE_ROW.image_path}`,
    );
  });
});

describe('POST /api/persona/images', () => {
  it('rejects the 11th image', async () => {
    mockAuth({ userId: USER_ID });
    mockClient({ imageCount: 10 });
    const res = await POST(
      postForm({ personaId: PERSONA_ID, image: imageFile() }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('10');
  });

  it('rejects non-image files', async () => {
    mockAuth({ userId: USER_ID });
    mockClient();
    const res = await POST(
      postForm({ personaId: PERSONA_ID, image: imageFile('doc.pdf', 'application/pdf') }),
    );
    expect(res.status).toBe(400);
  });

  it('rejects unsupported extensions', async () => {
    mockAuth({ userId: USER_ID });
    mockClient();
    const res = await POST(
      postForm({ personaId: PERSONA_ID, image: imageFile('photo.bmp', 'image/bmp') }),
    );
    expect(res.status).toBe(400);
  });

  it('creates the image and returns 201', async () => {
    mockAuth({ userId: USER_ID });
    mockClient({ insertedRow: IMAGE_ROW });
    const res = await POST(
      postForm({
        personaId: PERSONA_ID,
        image: imageFile(),
        tag: 'casual',
        description: 'at the park',
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { success: boolean; image: { id: string } };
    expect(body.success).toBe(true);
    expect(body.image.id).toBe(IMAGE_ROW.id);
  });
});

describe('PATCH /api/persona/images', () => {
  const patchRequest = (body: unknown): Request =>
    new Request('http://localhost/api/persona/images', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('returns 404 for an unknown image', async () => {
    mockAuth({ userId: USER_ID });
    mockClient({ imageRow: null });
    const res = await PATCH(patchRequest({ id: 'missing', tag: 'x' }));
    expect(res.status).toBe(404);
  });

  it('rejects an empty patch', async () => {
    mockAuth({ userId: USER_ID });
    mockClient({ imageRow: IMAGE_ROW });
    const res = await PATCH(patchRequest({ id: IMAGE_ROW.id }));
    expect(res.status).toBe(400);
  });

  it('updates tag and description', async () => {
    mockAuth({ userId: USER_ID });
    mockClient({ imageRow: IMAGE_ROW, updatedRow: { ...IMAGE_ROW, tag: 'formal' } });
    const res = await PATCH(
      patchRequest({ id: IMAGE_ROW.id, tag: 'formal', description: 'at the office' }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; image: { tag: string } };
    expect(body.image.tag).toBe('formal');
  });

  it('unsets other primaries when marking an image primary', async () => {
    mockAuth({ userId: USER_ID });
    const { calls } = mockClient({ imageRow: IMAGE_ROW, updatedRow: IMAGE_ROW });
    const res = await PATCH(patchRequest({ id: IMAGE_ROW.id, isPrimary: true }));
    expect(res.status).toBe(200);
    // One update for unsetting the others, one for the row itself.
    expect(calls.unsetPrimary).toBe(2);
  });
});

describe('DELETE /api/persona/images', () => {
  it('returns 404 for an unknown image', async () => {
    mockAuth({ userId: USER_ID });
    mockClient({ imageRow: null });
    const res = await DELETE(new Request('http://localhost/api/persona/images?id=missing'));
    expect(res.status).toBe(404);
  });

  it('deletes the row and the storage file', async () => {
    mockAuth({ userId: USER_ID });
    const { calls } = mockClient({ imageRow: IMAGE_ROW });
    const res = await DELETE(
      new Request(`http://localhost/api/persona/images?id=${IMAGE_ROW.id}`),
    );
    expect(res.status).toBe(200);
    expect(calls.removedPaths).toEqual([IMAGE_ROW.image_path]);
  });
});
