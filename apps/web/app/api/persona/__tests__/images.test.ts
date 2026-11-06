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

vi.mock('@/lib/rate-limit', async (importOriginal) => {
  // Rate limiting is covered by the dedicated
  // app/api/persona/__tests__/images-rate-limit.test.ts suite; these
  // payload-behavior tests bypass it so every case reaches the handler.
  const actual = await importOriginal<typeof import('@/lib/rate-limit')>();
  return {
    ...actual,
    applyRateLimit: vi.fn().mockResolvedValue(null),
  };
});

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock('@/lib/supabase/service', () => ({
  createSupabaseServiceClient: vi.fn(),
}));

import { GET, POST, PATCH, DELETE } from '../images/route';
import { requireSupabaseSession } from '@/lib/request-auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { logger } from '@/lib/logger';

// The 400 log line pins the route string and the stable template: without
// it, blanking either string in the response call changes nothing any test
// observes (the body carries neither).
const warnSpy = vi.spyOn(logger, 'warn');
function loggedWarnings(): string[] {
  return warnSpy.mock.calls.map((call) => String(call[0]));
}

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
  /** Makes the set_primary_persona_image RPC fail (primary-swap error path). */
  failPrimarySwap?: boolean;
  /**
   * Makes the set_primary_persona_image RPC fail with code P0002 (the image
   * row vanished between the ownership check and the swap).
   */
  failPrimarySwapGone?: boolean;
  /** Makes the persona_images metadata UPDATE fail (partial-commit path). */
  failUpdate?: boolean;
  /** Storage paths for which createSignedUrl fails (image_url_error path). */
  failSignPaths?: string[];
  /**
   * Makes the metadata UPDATE report PGRST116 (the row was concurrently
   * deleted between the ownership check and the update): 404, not 500.
   */
  failUpdateGone?: boolean;
  /**
   * Makes the post-mutation row refetch fail (fetchImageRow returns null).
   * The default select branch serves the refetch in PATCH/POST flows.
   */
  failRefetch?: boolean;
  /** Makes the storage remove() call fail (orphan-file logging path). */
  storageRemoveError?: { message: string } | null;
  /**
   * Makes the personas ownership lookup fail with a PostgREST error.
   * code 'PGRST116' = zero rows (404); anything else = DB failure (500).
   */
  personaLookupError?: { code?: string; message: string } | null;
  /**
   * Makes the persona_images single-row lookup fail with a PostgREST error.
   * Same PGRST116-vs-DB-failure split as personaLookupError.
   */
  imageLookupError?: { code?: string; message: string } | null;
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
  const calls = { primarySwaps: [] as Array<Record<string, unknown>>, removedPaths: [] as string[] };
  const updateMock = vi.fn(() => {
    if (full.failUpdateGone === true) {
      return terminal({ data: null, error: { code: 'PGRST116', message: 'row gone' } });
    }
    return full.failUpdate === true
      ? terminal({ data: null, error: { message: 'update failed' } })
      : terminal({ data: full.updatedRow, error: null });
  });
  const client = {
    rpc: vi.fn((fn: string, args: Record<string, unknown>) => {
      if (fn === 'set_primary_persona_image') {
        calls.primarySwaps.push(args);
        if (full.failPrimarySwapGone === true) {
          return Promise.resolve({
            data: null,
            error: { message: 'image gone', code: 'P0002' },
          });
        }
        if (full.failPrimarySwap === true) {
          return Promise.resolve({ data: null, error: { message: 'swap failed' } });
        }
      }
      return Promise.resolve({ data: null, error: null });
    }),
    from: vi.fn((table: string) => {
      if (table === 'personas') {
        // Zero rows surface as PGRST116 through .single(); the route maps
        // that to 404 and any other DB error to 500.
        const error =
          full.personaLookupError ?? (full.persona ? null : { code: 'PGRST116', message: 'nf' });
        return terminal({ data: error ? null : full.persona, error });
      }
      return {
        select: vi.fn((columns: string) => {
          if (columns === 'id') {
            return terminal({ count: full.imageCount, error: null });
          }
          if (columns.includes('persona_id')) {
            const error =
              full.imageLookupError ?? (full.imageRow ? null : { code: 'PGRST116', message: 'nf' });
            return terminal({
              data: error ? null : full.imageRow,
              error,
            });
          }
          if (full.failRefetch === true) {
            return terminal({ data: null, error: { message: 'refetch failed' } });
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
          return { error: full.storageRemoveError ?? null };
        }),
        createSignedUrl: vi.fn(async (path: string) => {
          if (full.failSignPaths?.includes(path)) {
            return { data: null, error: { message: 'signing failed' } };
          }
          return {
            data: { signedUrl: `https://supabase.test/signed/${path}` },
            error: null,
          };
        }),
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
  // Real magic bytes matching the declared type: the server validates
  // content, not just the declared MIME type.
  const bytes = new Uint8Array(size);
  if (type === 'image/png') bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (type === 'image/jpeg') bytes.set([0xff, 0xd8, 0xff, 0xe0]);
  return new File([bytes], name, { type });
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
    const body = (await res.json()) as { code?: string; field?: string; error?: string };
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(body.field).toBe('personaId');
    expect(body.error).toBe('personaId is required.');
    expect(loggedWarnings()).toContain('[GET /api/persona/images] 400 personaId is required.');
  });

  it('rejects a scoped API key without access to the persona', async () => {
    mockAuth({ userId: USER_ID, isApiKey: true, personaIds: ['other-persona'] });
    mockClient();
    const res = await GET(
      new Request(`http://localhost/api/persona/images?personaId=${PERSONA_ID}`),
    );
    expect(res.status).toBe(403);
  });

  it('returns 404 when the persona lookup matches zero rows (PGRST116)', async () => {
    mockAuth({ userId: USER_ID });
    mockClient({ persona: null });
    const res = await GET(
      new Request(`http://localhost/api/persona/images?personaId=${PERSONA_ID}`),
    );
    expect(res.status).toBe(404);
  });

  it('returns 500 (not 404) when the persona lookup fails with a real DB error', async () => {
    // A Supabase outage must not masquerade as "not found": the client
    // would stop retrying and there would be no diagnostic trail.
    mockAuth({ userId: USER_ID });
    mockClient({ personaLookupError: { code: 'XX000', message: 'connection reset' } });
    const res = await GET(
      new Request(`http://localhost/api/persona/images?personaId=${PERSONA_ID}`),
    );
    expect(res.status).toBe(500);
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

  it('flags image_url_error when signing fails but keeps the other images signed', async () => {
    mockAuth({ userId: USER_ID });
    const badRow = { ...IMAGE_ROW, id: 'img-bad', image_path: 'bad/path.jpg' };
    mockClient({
      listRows: [badRow, IMAGE_ROW],
      failSignPaths: ['bad/path.jpg'],
    });
    const res = await GET(
      new Request(`http://localhost/api/persona/images?personaId=${PERSONA_ID}`),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      images: Array<{ id: string; image_url: string | null; image_url_error?: true }>;
    };
    expect(body.images).toHaveLength(2);
    expect(body.images[0]?.image_url).toBeNull();
    expect(body.images[0]?.image_url_error).toBe(true);
    expect(body.images[1]?.image_url).toBe(
      `https://supabase.test/signed/${IMAGE_ROW.image_path}`,
    );
    expect(body.images[1]?.image_url_error).toBeUndefined();
  });

  it('does not expose the internal storage path (image_path) in the response', async () => {
    mockAuth({ userId: USER_ID });
    mockClient({ listRows: [IMAGE_ROW] });
    const res = await GET(
      new Request(`http://localhost/api/persona/images?personaId=${PERSONA_ID}`),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      images: Array<Record<string, unknown>>;
    };
    expect(body.images[0]).not.toHaveProperty('image_path');
    // Only the UI-needed fields are projected.
    expect(Object.keys(body.images[0] ?? {}).sort()).toEqual(
      ['created_at', 'description', 'id', 'image_url', 'is_primary', 'tag'].sort(),
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
    const body = (await res.json()) as { error: string; code?: string; field?: string };
    expect(body.error).toContain('10');
    // A full library names no field: the image input is fine, the
    // library is full.
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(body.field).toBeUndefined();
    expect(loggedWarnings()).toContain(
      '[POST /api/persona/images] 400 Image library is full (10 images max).',
    );
  });

  it('returns 400 with an invalid multipart payload', async () => {
    mockAuth({ userId: USER_ID });
    mockClient();
    const res = await POST(
      new Request('http://localhost/api/persona/images', {
        method: 'POST',
        headers: { 'content-type': 'multipart/form-data' },
        body: 'not multipart at all',
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; code?: string };
    expect(body.error).toBe('Invalid multipart payload.');
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(loggedWarnings()).toContain('[POST /api/persona/images] 400 Invalid multipart payload.');
  });

  it('returns 400 without personaId', async () => {
    mockAuth({ userId: USER_ID });
    mockClient();
    const res = await POST(postForm({ image: imageFile() }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; code?: string; field?: string };
    expect(body.error).toBe('personaId is required.');
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(body.field).toBe('personaId');
    expect(loggedWarnings()).toContain('[POST /api/persona/images] 400 personaId is required.');
  });

  it('returns 400 without an image file', async () => {
    mockAuth({ userId: USER_ID });
    mockClient();
    const res = await POST(postForm({ personaId: PERSONA_ID }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; code?: string; field?: string };
    expect(body.error).toBe('An image file is required.');
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(body.field).toBe('file');
    expect(loggedWarnings()).toContain('[POST /api/persona/images] 400 An image file is required.');
  });

  it('returns 400 for a zero-size image file', async () => {
    mockAuth({ userId: USER_ID });
    mockClient();
    // imageFile() always writes magic bytes; a zero-size file needs an
    // empty File constructed directly.
    const empty = new File([], 'empty.png', { type: 'image/png' });
    const res = await POST(postForm({ personaId: PERSONA_ID, image: empty }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; code?: string; field?: string };
    expect(body.error).toBe('An image file is required.');
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(body.field).toBe('file');
  });

  it('rejects a non-string description with 400 instead of silently dropping it', async () => {
    mockAuth({ userId: USER_ID });
    mockClient();
    // A File under 'description' is a valid FormDataEntryValue; silently
    // coercing it to '' would lose the caller's metadata with a 201.
    const res = await POST(
      postForm({ personaId: PERSONA_ID, image: imageFile(), description: imageFile() }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; code?: string; field?: string };
    expect(body.error).toBe('description must be a string.');
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(body.field).toBe('description');
    expect(loggedWarnings()).toContain(
      '[POST /api/persona/images] 400 description must be a string.',
    );
  });

  it('rejects a non-string tag with 400 instead of silently dropping it', async () => {
    mockAuth({ userId: USER_ID });
    mockClient();
    // A File under 'tag' is a valid FormDataEntryValue; silently coercing it
    // to '' would lose the caller's metadata with a 201.
    const res = await POST(
      postForm({ personaId: PERSONA_ID, image: imageFile(), tag: imageFile() }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; code?: string; field?: string };
    expect(body.error).toBe('tag must be a string.');
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(body.field).toBe('tag');
    expect(loggedWarnings()).toContain('[POST /api/persona/images] 400 tag must be a string.');
  });

  it('rejects non-image files', async () => {
    mockAuth({ userId: USER_ID });
    mockClient();
    const res = await POST(
      postForm({ personaId: PERSONA_ID, image: imageFile('doc.pdf', 'application/pdf') }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code?: string; field?: string };
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(body.field).toBe('file');
  });

  it('rejects unsupported extensions', async () => {
    mockAuth({ userId: USER_ID });
    mockClient();
    const res = await POST(
      postForm({ personaId: PERSONA_ID, image: imageFile('photo.bmp', 'image/bmp') }),
    );
    expect(res.status).toBe(400);
  });

  it('rejects an over-length tag instead of truncating it', async () => {
    mockAuth({ userId: USER_ID });
    mockClient({ insertedRow: IMAGE_ROW });
    const res = await POST(
      postForm({ personaId: PERSONA_ID, image: imageFile(), tag: 'x'.repeat(101) }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; code?: string; field?: string };
    expect(body.error).toBe('tag must be at most 100 characters.');
    // The tag input failed, not the file: the UI highlights the tag input.
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(body.field).toBe('tag');
    expect(loggedWarnings()).toContain(
      '[POST /api/persona/images] 400 tag must be at most 100 characters.',
    );
  });

  it('rejects an over-length description instead of truncating it', async () => {
    mockAuth({ userId: USER_ID });
    mockClient({ insertedRow: IMAGE_ROW });
    const res = await POST(
      postForm({ personaId: PERSONA_ID, image: imageFile(), description: 'x'.repeat(501) }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; code?: string; field?: string };
    expect(body.error).toBe('description must be at most 500 characters.');
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(body.field).toBe('description');
    expect(loggedWarnings()).toContain(
      '[POST /api/persona/images] 400 description must be at most 500 characters.',
    );
  });

  it('still reports success when the primary flag fails after upload', async () => {
    // The image row and storage object are already committed: a primary-flag
    // failure must not become a 500 while the image exists. Best-effort:
    // 201 with the true is_primary state plus a warnings array so the
    // caller knows the image is NOT primary (mirrors the PATCH
    // partial-success contract).
    mockAuth({ userId: USER_ID });
    mockClient({ insertedRow: IMAGE_ROW, failPrimarySwap: true });
    const res = await POST(
      postForm({ personaId: PERSONA_ID, image: imageFile(), isPrimary: 'true' }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      success: boolean;
      image: { is_primary: boolean };
      warnings?: string[];
    };
    expect(body.success).toBe(true);
    expect(body.image.is_primary).toBe(false);
    expect(body.warnings).toEqual(['primary_swap_failed']);
  });

  it('omits warnings when the upload fully succeeds', async () => {
    mockAuth({ userId: USER_ID });
    mockClient({ insertedRow: IMAGE_ROW });
    const res = await POST(
      postForm({ personaId: PERSONA_ID, image: imageFile(), isPrimary: 'true' }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { success: boolean; warnings?: string[] };
    expect(body.success).toBe(true);
    expect(body.warnings ?? []).toHaveLength(0);
  });

  it('logs leftover storage paths when the upload rollback cannot clean up', async () => {
    // addLibraryImages surfaces leftoverPaths when its internal rollback
    // fails; the route must not discard them — they are the only record of
    // the orphaned storage objects.
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      mockAuth({ userId: USER_ID });
      mockClient({ insertedRow: null, storageRemoveError: { message: 'remove boom' } });
      const res = await POST(postForm({ personaId: PERSONA_ID, image: imageFile() }));
      expect(res.status).toBe(500);
      const leftoverLogged = errorSpy.mock.calls.some(
        (call) =>
          typeof call[0] === 'string' &&
          call[0].includes('orphaned upload storage paths could not be removed') &&
          typeof call[1] === 'object' &&
          call[1] !== null &&
          Array.isArray((call[1] as { orphanPaths?: unknown }).orphanPaths) &&
          ((call[1] as { orphanPaths: unknown[] }).orphanPaths.length > 0),
      );
      expect(leftoverLogged).toBe(true);
    } finally {
      errorSpy.mockRestore();
    }
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

  it('rejects a non-boolean isPrimary string instead of silently coercing to false', async () => {
    // formData.get('isPrimary') === 'true' used to treat '1'/'yes'/'True' as
    // not-primary: an API-key caller sending '1' got a 201 with a silently
    // unset primary. Only 'true'/'false' are accepted now.
    mockAuth({ userId: USER_ID });
    mockClient({ insertedRow: IMAGE_ROW });
    const res = await POST(
      postForm({ personaId: PERSONA_ID, image: imageFile(), isPrimary: '1' }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; code?: string; field?: string };
    expect(body.error).toBe("isPrimary must be 'true' or 'false'.");
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(body.field).toBe('isPrimary');
    expect(loggedWarnings()).toContain(
      "[POST /api/persona/images] 400 isPrimary must be 'true' or 'false'.",
    );
  });

  it('adds a library image with a single personas query (ownership only)', async () => {
    // The faceless guard is gone with the mode, so POST's only personas read
    // is the ownership check — one round-trip, no second fetch.
    mockAuth({ userId: USER_ID });
    const { client } = mockClient({ persona: { id: PERSONA_ID }, insertedRow: IMAGE_ROW });
    const res = await POST(
      postForm({ personaId: PERSONA_ID, image: imageFile() }),
    );
    expect(res.status).toBe(201);
    const personaQueries = client.from.mock.calls.filter(
      ([table]) => table === 'personas',
    );
    expect(personaQueries).toHaveLength(1);
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

  it('returns 500 (not 404) when the image lookup fails with a real DB error', async () => {
    mockAuth({ userId: USER_ID });
    mockClient({ imageLookupError: { code: 'XX000', message: 'connection reset' } });
    const res = await PATCH(patchRequest({ id: IMAGE_ROW.id, tag: 'x' }));
    expect(res.status).toBe(500);
  });

  it('returns 400 without an image id', async () => {
    mockAuth({ userId: USER_ID });
    mockClient({ imageRow: IMAGE_ROW });
    const res = await PATCH(patchRequest({ tag: 'x' }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; code?: string; field?: string };
    expect(body.error).toBe('id is required.');
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(body.field).toBe('id');
    expect(loggedWarnings()).toContain('[PATCH /api/persona/images] 400 id is required.');
  });

  it('rejects a non-string tag with 400', async () => {
    mockAuth({ userId: USER_ID });
    mockClient({ imageRow: IMAGE_ROW });
    const res = await PATCH(patchRequest({ id: IMAGE_ROW.id, tag: 42 }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; code?: string; field?: string };
    expect(body.error).toBe('tag must be a string.');
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(body.field).toBe('tag');
    expect(loggedWarnings()).toContain('[PATCH /api/persona/images] 400 tag must be a string.');
  });

  it('rejects a non-string description with 400', async () => {
    mockAuth({ userId: USER_ID });
    mockClient({ imageRow: IMAGE_ROW });
    const res = await PATCH(patchRequest({ id: IMAGE_ROW.id, description: 42 }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; code?: string; field?: string };
    expect(body.error).toBe('description must be a string.');
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(body.field).toBe('description');
    expect(loggedWarnings()).toContain(
      '[PATCH /api/persona/images] 400 description must be a string.',
    );
  });

  it('rejects a non-boolean isPrimary with 400', async () => {
    mockAuth({ userId: USER_ID });
    mockClient({ imageRow: IMAGE_ROW });
    const res = await PATCH(patchRequest({ id: IMAGE_ROW.id, isPrimary: 'yes' }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; code?: string; field?: string };
    expect(body.error).toBe('isPrimary must be a boolean.');
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(body.field).toBe('isPrimary');
    expect(loggedWarnings()).toContain(
      '[PATCH /api/persona/images] 400 isPrimary must be a boolean.',
    );
  });

  it('rejects an empty patch', async () => {
    mockAuth({ userId: USER_ID });
    mockClient({ imageRow: IMAGE_ROW });
    const res = await PATCH(patchRequest({ id: IMAGE_ROW.id }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; code?: string };
    expect(body.error).toBe('Nothing to update.');
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(loggedWarnings()).toContain('[PATCH /api/persona/images] 400 Nothing to update.');
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

  it('swaps the primary image atomically via the set_primary_persona_image RPC', async () => {
    mockAuth({ userId: USER_ID });
    const { calls } = mockClient({ imageRow: IMAGE_ROW, updatedRow: IMAGE_ROW });
    const res = await PATCH(patchRequest({ id: IMAGE_ROW.id, isPrimary: true }));
    expect(res.status).toBe(200);
    // One atomic swap: no separate demote/promote updates from the app.
    expect(calls.primarySwaps).toEqual([
      { p_persona_id: PERSONA_ID, p_image_id: IMAGE_ROW.id, p_user_id: USER_ID },
    ]);
  });

  it('returns 500 when the primary-swap RPC fails', async () => {
    mockAuth({ userId: USER_ID });
    mockClient({ imageRow: IMAGE_ROW, updatedRow: IMAGE_ROW, failPrimarySwap: true });
    const res = await PATCH(patchRequest({ id: IMAGE_ROW.id, isPrimary: true }));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { success: boolean; error: string };
    expect(body.success).toBe(false);
  });

  it('returns 404 when the swap RPC reports the image vanished (P0002)', async () => {
    // A concurrent delete can race the ownership pre-check: the SQL function
    // raises with errcode P0002, which the route maps to 404 instead of a
    // misleading 500.
    mockAuth({ userId: USER_ID });
    mockClient({ imageRow: IMAGE_ROW, updatedRow: IMAGE_ROW, failPrimarySwapGone: true });
    const res = await PATCH(patchRequest({ id: IMAGE_ROW.id, isPrimary: true }));
    expect(res.status).toBe(404);
    const body = (await res.json()) as { success: boolean; error: string };
    expect(body.error).toContain('not found');
  });

  it('returns a warning-style success when the metadata update fails after a swap', async () => {
    // The primary swap already committed atomically: a 500 would hide that
    // from the caller. Report the true row state with a warning instead,
    // mirroring the POST best-effort path.
    mockAuth({ userId: USER_ID });
    mockClient({ imageRow: IMAGE_ROW, updatedRow: IMAGE_ROW, failUpdate: true });
    const res = await PATCH(
      patchRequest({ id: IMAGE_ROW.id, isPrimary: true, tag: 'formal' }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; warnings?: string[] };
    expect(body.success).toBe(true);
    expect(body.warnings).toEqual(['metadata_save_failed']);
  });

  it('reports an honest partial success when the refetch fails after a committed swap', async () => {
    // The swap RPC committed, then the row refetch failed: a bare 500 would
    // tell the UI "nothing changed" and hide the committed primary change.
    // The mutation hook invalidates on success, so the library refetch
    // converges the UI to the true state.
    mockAuth({ userId: USER_ID });
    mockClient({ imageRow: IMAGE_ROW, updatedRow: IMAGE_ROW, failRefetch: true });
    const res = await PATCH(patchRequest({ id: IMAGE_ROW.id, isPrimary: true }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      image: unknown;
      warnings?: string[];
    };
    expect(body.success).toBe(true);
    expect(body.image).toBeNull();
    expect(body.warnings).toEqual(['row_refetch_failed']);
  });

  it('keeps the metadata warning when the refetch fails after a committed swap plus failed metadata', async () => {
    mockAuth({ userId: USER_ID });
    mockClient({
      imageRow: IMAGE_ROW,
      updatedRow: IMAGE_ROW,
      failUpdate: true,
      failRefetch: true,
    });
    const res = await PATCH(
      patchRequest({ id: IMAGE_ROW.id, isPrimary: true, tag: 'formal' }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      image: unknown;
      warnings?: string[];
    };
    expect(body.success).toBe(true);
    expect(body.image).toBeNull();
    expect(body.warnings).toEqual(['metadata_save_failed', 'row_refetch_failed']);
  });

  it('returns 500 when a metadata-only update fails — no swap committed to warn about', async () => {    // The warning-style success exists only because a primary swap already
    // committed atomically. With no swap in this PATCH, claiming "Primary
    // image was updated" would be a lie: keep the honest 500.
    mockAuth({ userId: USER_ID });
    mockClient({ imageRow: IMAGE_ROW, updatedRow: IMAGE_ROW, failUpdate: true });
    const res = await PATCH(patchRequest({ id: IMAGE_ROW.id, tag: 'formal' }));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { success: boolean; error: string; warnings?: string[] };
    expect(body.success).toBe(false);
    expect(body.warnings).toBeUndefined();
  });

  it('returns 404 when the row is concurrently deleted between the ownership check and the metadata update', async () => {
    // The TOCTOU window is real: getOwnedImage succeeded, then the row
    // vanished. PGRST116 on the update means "not found", not a DB failure.
    mockAuth({ userId: USER_ID });
    mockClient({ imageRow: IMAGE_ROW, updatedRow: IMAGE_ROW, failUpdateGone: true });
    const res = await PATCH(patchRequest({ id: IMAGE_ROW.id, tag: 'formal' }));
    expect(res.status).toBe(404);
  });

  it('rejects isPrimary:false — primary is swap-only, never demote-only', async () => {
    // A demote-only PATCH would leave the library with zero primary images
    // and push every consumer onto the deterministic fallback. To change the
    // primary, set isPrimary:true on the new image instead.
    mockAuth({ userId: USER_ID });
    mockClient({ imageRow: IMAGE_ROW, updatedRow: IMAGE_ROW });
    const res = await PATCH(patchRequest({ id: IMAGE_ROW.id, isPrimary: false }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { success: boolean; error: string; code?: string; field?: string };
    expect(body.success).toBe(false);
    expect(body.error).toBe('isPrimary cannot be set to false. Mark another image as primary instead.');
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(body.field).toBe('isPrimary');
    expect(loggedWarnings()).toContain(
      '[PATCH /api/persona/images] 400 isPrimary cannot be set to false. Mark another image as primary instead.',
    );
  });

  it('rejects an over-length tag instead of truncating it', async () => {
    mockAuth({ userId: USER_ID });
    mockClient({ imageRow: IMAGE_ROW, updatedRow: IMAGE_ROW });
    const res = await PATCH(patchRequest({ id: IMAGE_ROW.id, tag: 'x'.repeat(101) }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { success: boolean; error: string; code?: string; field?: string };
    expect(body.success).toBe(false);
    expect(body.error).toBe('tag must be at most 100 characters.');
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(body.field).toBe('tag');
    expect(loggedWarnings()).toContain(
      '[PATCH /api/persona/images] 400 tag must be at most 100 characters.',
    );
  });

  it('rejects an over-length description instead of truncating it', async () => {
    mockAuth({ userId: USER_ID });
    mockClient({ imageRow: IMAGE_ROW, updatedRow: IMAGE_ROW });
    const res = await PATCH(patchRequest({ id: IMAGE_ROW.id, description: 'y'.repeat(501) }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; code?: string; field?: string };
    expect(body.error).toBe('description must be at most 500 characters.');
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(body.field).toBe('description');
    expect(loggedWarnings()).toContain(
      '[PATCH /api/persona/images] 400 description must be at most 500 characters.',
    );
  });
});

describe('DELETE /api/persona/images', () => {
  it('returns 400 without an image id', async () => {
    mockAuth({ userId: USER_ID });
    mockClient({ imageRow: IMAGE_ROW });
    const res = await DELETE(new Request('http://localhost/api/persona/images'));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; code?: string; field?: string };
    expect(body.error).toBe('id is required.');
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(body.field).toBe('id');
    expect(loggedWarnings()).toContain('[DELETE /api/persona/images] 400 id is required.');
  });

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

  it('still succeeds when the storage cleanup fails, but logs it', async () => {
    mockAuth({ userId: USER_ID });
    mockClient({ imageRow: IMAGE_ROW, storageRemoveError: { message: 'bucket down' } });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const res = await DELETE(
        new Request(`http://localhost/api/persona/images?id=${IMAGE_ROW.id}`),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean };
      expect(body.success).toBe(true);
      expect(errorSpy).toHaveBeenCalledWith(
        '[api/persona/images] storage cleanup failed',
        expect.objectContaining({ imagePath: IMAGE_ROW.image_path }),
      );
    } finally {
      errorSpy.mockRestore();
    }
  });
});
