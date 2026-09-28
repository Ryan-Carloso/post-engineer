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
  persona: { id: string; face_mix_percent?: number } | null;
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
  /** Makes the storage remove() call fail (orphan-file logging path). */
  storageRemoveError?: { message: string } | null;
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
  const updateMock = vi.fn(() =>
    full.failUpdate === true
      ? terminal({ data: null, error: { message: 'update failed' } })
      : terminal({ data: full.updatedRow, error: null }),
  );
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
          return { error: full.storageRemoveError ?? null };
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

  it('rejects an over-length tag instead of truncating it', async () => {
    mockAuth({ userId: USER_ID });
    mockClient({ insertedRow: IMAGE_ROW });
    const res = await POST(
      postForm({ personaId: PERSONA_ID, image: imageFile(), tag: 'x'.repeat(101) }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('100');
  });

  it('rejects an over-length description instead of truncating it', async () => {
    mockAuth({ userId: USER_ID });
    mockClient({ insertedRow: IMAGE_ROW });
    const res = await POST(
      postForm({ personaId: PERSONA_ID, image: imageFile(), description: 'x'.repeat(501) }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('500');
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
    expect(body.warnings).toHaveLength(1);
    expect(body.warnings?.[0]).toContain('primary');
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
          call[0].includes('left storage files behind') &&
          typeof call[1] === 'object' &&
          call[1] !== null &&
          Array.isArray((call[1] as { leftoverPaths?: unknown }).leftoverPaths) &&
          ((call[1] as { leftoverPaths: unknown[] }).leftoverPaths.length > 0),
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
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('isPrimary');
  });

  it('rejects library images for a faceless persona', async () => {
    mockAuth({ userId: USER_ID });
    const { client } = mockClient({ persona: { id: PERSONA_ID, face_mix_percent: 0 } });
    const res = await POST(
      postForm({ personaId: PERSONA_ID, image: imageFile() }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('Faceless');
    // Ownership and the faceless check share one personas query — the owned
    // row from assertPersonaOwned carries face_mix_percent, no second fetch.
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

  it('swaps the primary image atomically via the set_primary_persona_image RPC', async () => {
    mockAuth({ userId: USER_ID });
    const { calls } = mockClient({ imageRow: IMAGE_ROW, updatedRow: IMAGE_ROW });
    const res = await PATCH(patchRequest({ id: IMAGE_ROW.id, isPrimary: true }));
    expect(res.status).toBe(200);
    // One atomic swap: no separate demote/promote updates from the app.
    expect(calls.primarySwaps).toEqual([
      { p_persona_id: PERSONA_ID, p_image_id: IMAGE_ROW.id },
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
    expect(body.warnings?.[0]).toMatch(/tag\/description/);
  });

  it('returns 500 when a metadata-only update fails — no swap committed to warn about', async () => {
    // The warning-style success exists only because a primary swap already
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

  it('rejects isPrimary:false — primary is swap-only, never demote-only', async () => {
    // A demote-only PATCH would leave the library with zero primary images
    // and push every consumer onto the deterministic fallback. To change the
    // primary, set isPrimary:true on the new image instead.
    mockAuth({ userId: USER_ID });
    mockClient({ imageRow: IMAGE_ROW, updatedRow: IMAGE_ROW });
    const res = await PATCH(patchRequest({ id: IMAGE_ROW.id, isPrimary: false }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toContain('cannot be set to false');
  });

  it('rejects an over-length tag instead of truncating it', async () => {
    mockAuth({ userId: USER_ID });
    mockClient({ imageRow: IMAGE_ROW, updatedRow: IMAGE_ROW });
    const res = await PATCH(patchRequest({ id: IMAGE_ROW.id, tag: 'x'.repeat(101) }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toContain('at most');
  });

  it('rejects an over-length description instead of truncating it', async () => {
    mockAuth({ userId: USER_ID });
    mockClient({ imageRow: IMAGE_ROW, updatedRow: IMAGE_ROW });
    const res = await PATCH(patchRequest({ id: IMAGE_ROW.id, description: 'y'.repeat(501) }));
    expect(res.status).toBe(400);
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
