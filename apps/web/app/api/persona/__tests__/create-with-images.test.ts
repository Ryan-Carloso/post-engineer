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

function mockClient(options: { failPrimarySwap?: boolean } = {}) {
  const calls = {
    personaInserts: 0,
    personaInsertValues: null as Record<string, unknown> | null,
    personaDeletes: 0,
    imageInserts: [] as Array<Record<string, unknown>>,
    primaryUpdates: [] as Array<{ id: string; isPrimary: boolean }>,
    primarySwaps: [] as Array<Record<string, unknown>>,
  };
  let imageSeq = 0;
  const client = {
    rpc: vi.fn((fn: string, args: Record<string, unknown>) => {
      if (fn === 'set_primary_persona_image') {
        calls.primarySwaps.push(args);
        if (options.failPrimarySwap) {
          return Promise.resolve({ data: null, error: { message: 'swap boom' } });
        }
      }
      return Promise.resolve({ data: null, error: null });
    }),
    from: vi.fn((table: string) => {
      if (table === 'personas') {
        return {
          insert: vi.fn((values: Record<string, unknown>) => {
            calls.personaInserts += 1;
            calls.personaInsertValues = values;
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

const png = (name: string, size = 1024): File => {
  // Real PNG magic bytes: the server validates content, not just the
  // declared MIME type.
  const bytes = new Uint8Array(size);
  if (size >= 8) bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return new File([bytes], name, { type: 'image/png' });
};

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

  //---------------
  // Storage layout pin (creation writer): {userId}/{personaId}/images/{uuid}.{ext}.
  // The persona id is minted by the route BEFORE the upload so the folder can
  // be per persona; the insert must carry that same id, otherwise the folder
  // and the row disagree.
  //---------------
  it('stores library images under {userId}/{personaId}/images/', async () => {
    const calls = mockClient();
    const res = await POST(createRequest(BASE_FIELDS, [png('a.png'), png('b.png')]));
    expect(res.status).toBe(200);

    const mintedId = calls.personaInsertValues?.id;
    expect(typeof mintedId).toBe('string');
    for (const values of calls.imageInserts) {
      const stored = values.image_path as string;
      expect(stored.startsWith(`${USER_ID}/${mintedId}/images/`)).toBe(true);
      expect(stored.endsWith('.png')).toBe(true);
    }
  });

  it('marks the chosen primary index via the atomic primary-swap RPC', async () => {
    const calls = mockClient();
    const res = await POST(
      createRequest({ ...BASE_FIELDS, imagePrimaryIndex: '1' }, [png('a.png'), png('b.png')]),
    );
    expect(res.status).toBe(200);
    expect(calls.primarySwaps).toEqual([
      { p_persona_id: PERSONA_ID, p_image_id: 'img-2', p_user_id: USER_ID },
    ]);
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

  it('identifies the failing file by index and name in batch validation errors', async () => {
    mockClient();
    const bad = new File(['x'], 'doc.pdf', { type: 'application/pdf' });
    const res = await POST(createRequest(BASE_FIELDS, [png('a.png'), bad]));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    // The second file (index 1) is the bad one; the error names it.
    expect(body.error).toContain('(image 2: doc.pdf)');
  });

  it('reads each library file once at creation (validated bytes are reused)', async () => {
    // The creation route validates upfront (fail-fast) and passes the
    // bytes to addLibraryImages via validatedContent; addLibraryImages
    // must not re-read the file. We verify by spying on the file's
    // arrayBuffer through the FormData round-trip.
    const calls = mockClient();
    // The route reads via request.formData(); spy on the File prototype
    // so the spy survives any cloning.
    let readCount = 0;
    const originalArrayBuffer = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = async function (this: File) {
      if (this.name === 'a.png') readCount += 1;
      return originalArrayBuffer.call(this);
    };
    try {
      const res = await POST(
        createRequest({ ...BASE_FIELDS, personaMode: 'persona' }, [png('a.png')]),
      );
      expect(res.status).toBe(200);
      expect(calls.personaInserts).toBe(1);
      expect(readCount).toBe(1);
    } finally {
      File.prototype.arrayBuffer = originalArrayBuffer;
    }
  });

  it('rejects library images in faceless mode', async () => {
    mockClient();
    const res = await POST(
      createRequest({ ...BASE_FIELDS, personaMode: 'faceless' }, [png('a.png')]),
    );
    expect(res.status).toBe(400);
  });

  it('coerces a faceless creation to face_mix_percent 0 so the library guard holds', async () => {
    // A persona created with personaMode 'faceless' and no explicit
    // faceMixPercent would be stored with face_mix_percent NULL, passing
    // the POST /api/persona/images `=== 0` faceless check — a backdoor for
    // library images on faceless personas. Coercing to 0 on insert keeps
    // the stored state consistent with the creation-time rule.
    const calls = mockClient();
    const form = new FormData();
    form.append('name', 'Ana');
    form.append('voiceId', 'voice-1');
    form.append('personaMode', 'faceless');
    const res = await POST(new Request('http://localhost/api/persona', { method: 'POST', body: form }));
    expect(res.status).toBe(200);
    expect(calls.personaInsertValues?.face_mix_percent).toBe(0);
  });

  it('coerces an explicit faceMixPercent to 0 for faceless creations (backdoor closed)', async () => {
    // A direct API caller can send personaMode=faceless with an explicit
    // faceMixPercent=80. Without coercion, 80 is stored and the images
    // route (which treats stored mix as the facelessness source) would
    // accept library uploads — re-opening the backdoor. The faceless
    // branch is unconditional at the write boundary.
    const calls = mockClient();
    const form = new FormData();
    form.append('name', 'Ana');
    form.append('voiceId', 'voice-1');
    form.append('personaMode', 'faceless');
    form.append('faceMixPercent', '80');
    const res = await POST(new Request('http://localhost/api/persona', { method: 'POST', body: form }));
    expect(res.status).toBe(200);
    expect(calls.personaInsertValues?.face_mix_percent).toBe(0);
  });

  it('does not coerce face_mix_percent for persona-mode creations', async () => {
    const calls = mockClient();
    const res = await POST(
      createRequest({ ...BASE_FIELDS, personaMode: 'persona', faceMixPercent: '50' }),
    );
    expect(res.status).toBe(200);
    expect(calls.personaInsertValues?.face_mix_percent).toBe(50);
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

  it('rejects a non-numeric imagePrimaryIndex instead of silently dropping it', async () => {
    // parsePrimaryIndex used to treat 'abc' as unset: a caller's pinned
    // primary selection was silently lost. Like the sibling
    // imageTags/imageDescriptions parser, malformed input is a 400.
    const calls = mockClient();
    const res = await POST(
      createRequest({ ...BASE_FIELDS, imagePrimaryIndex: 'abc' }, [png('a.png'), png('b.png')]),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toContain('imagePrimaryIndex');
    expect(calls.personaInserts).toBe(0);
  });

  it('reports the malformed imagePrimaryIndex before reading image bytes', async () => {
    // Cheap param validation must precede the expensive per-file content
    // checks: an invalid index plus an invalid image must surface the index
    // error without reading the file bytes at all. The request round-trips
    // through multipart, so the spy goes on the shared File prototype.
    const calls = mockClient();
    // .png name passes the extension check so validation would reach the
    // magic-byte read; the spy proves that read never happens.
    const badImage = new File(['not an image'], 'a.png', { type: 'image/png' });
    const readSpy = vi.spyOn(File.prototype, 'arrayBuffer');
    try {
      const res = await POST(
        createRequest({ ...BASE_FIELDS, imagePrimaryIndex: 'abc' }, [badImage]),
      );
      expect(res.status).toBe(400);
      const body = (await res.json()) as { success: boolean; error: string };
      expect(body.success).toBe(false);
      expect(body.error).toContain('imagePrimaryIndex');
      expect(readSpy).not.toHaveBeenCalled();
      expect(calls.personaInserts).toBe(0);
    } finally {
      readSpy.mockRestore();
    }
  });

  it('rejects an out-of-range imagePrimaryIndex before creating anything', async () => {
    const calls = mockClient();
    const res = await POST(
      createRequest({ ...BASE_FIELDS, imagePrimaryIndex: '5' }, [png('a.png'), png('b.png')]),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toContain('imagePrimaryIndex');
    expect(calls.personaInserts).toBe(0);
  });

  it('accepts library images that are not built by the global File constructor', async () => {
    // The server runtime (undici) File can be a different constructor than
    // the global File. The route must use a structural check: a file-like
    // object that is NOT `instanceof File` must still be accepted as a
    // library image instead of being silently dropped.
    const calls = mockClient();
    const structuralFile = {
      name: 'a.png',
      type: 'image/png',
      size: 1024,
      arrayBuffer: async () => {
        // Real PNG magic bytes: the server validates content, not just the
        // declared MIME type.
        const bytes = new Uint8Array(1024);
        bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
        return bytes.buffer;
      },
    };
    expect(structuralFile).not.toBeInstanceOf(File);
    class StubFormData extends FormData {
      override getAll(name: string): FormDataEntryValue[] {
        if (name === 'images') return [structuralFile as unknown as FormDataEntryValue];
        return super.getAll(name);
      }
    }
    const form = new StubFormData();
    form.append('name', 'Ana');
    form.append('voiceId', 'voice-1');
    form.append('photo', png('main.png'));
    const request = { formData: async () => form } as unknown as Request;

    const res = await POST(request);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; imageIds: string[] };
    expect(body.success).toBe(true);
    expect(body.imageIds).toHaveLength(1);
    expect(calls.imageInserts).toHaveLength(1);
  });

  it('rejects malformed imageTags JSON with a 400 instead of silently defaulting to []', async () => {
    const calls = mockClient();
    const res = await POST(
      createRequest({ ...BASE_FIELDS, imageTags: 'not-json[' }, [png('a.png')]),
    );
    expect(res.status).toBe(400);
    expect(calls.personaInserts).toBe(0);
  });

  it('rejects non-string entries in imageTags/imageDescriptions with a 400', async () => {
    const calls = mockClient();
    const res = await POST(
      createRequest(
        { ...BASE_FIELDS, imageTags: JSON.stringify(['casual', 42]) },
        [png('a.png'), png('b.png')],
      ),
    );
    expect(res.status).toBe(400);
    expect(calls.personaInserts).toBe(0);
  });

  it('returns a warnings field when the primary swap fails after creation', async () => {
    mockClient({ failPrimarySwap: true });
    const res = await POST(
      createRequest({ ...BASE_FIELDS, imagePrimaryIndex: '0' }, [png('a.png')]),
    );
    // The persona and images are already committed: the response stays 200
    // and the failed primary intent is surfaced as a warning, not a 500.
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; warnings?: string[] };
    expect(body.success).toBe(true);
    expect(body.warnings).toHaveLength(1);
    // Stable code, not English copy: the UI maps it through i18n.
    expect(body.warnings?.[0]).toBe('primary_swap_failed');
  });

  it('rejects a zero-byte library image with a clear error instead of shifting tags', async () => {
    const calls = mockClient();
    const res = await POST(
      createRequest(
        {
          ...BASE_FIELDS,
          imageTags: JSON.stringify(['first', 'second']),
        },
        [png('a.png'), png('empty.png', 0)],
      ),
    );
    expect(res.status).toBe(400);
    expect(calls.personaInserts).toBe(0);
  });

  it('rejects a non-file images entry instead of silently dropping it and shifting tags', async () => {
    // A stray string in the `images` field must not be filtered out: the
    // index-aligned imageTags would silently shift onto the wrong image.
    const calls = mockClient();
    const form = new FormData();
    for (const [key, value] of Object.entries(BASE_FIELDS)) form.append(key, value);
    form.append('photo', png('main.png'));
    form.append('images', 'not-a-file');
    form.append('images', png('a.png'));
    form.append('imageTags', JSON.stringify(['stray', 'first']));
    const res = await POST(new Request('http://localhost/api/persona', { method: 'POST', body: form }));
    expect(res.status).toBe(400);
    expect(calls.personaInserts).toBe(0);
  });

  it('rejects spoofed content: GIF bytes declared as image/png', async () => {
    // The declared MIME type and extension pass the allowlist, but the
    // magic bytes say GIF. The server must read the real bytes.
    const calls = mockClient();
    const gifBytes = new Uint8Array(1024);
    gifBytes.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]); // GIF89a
    const spoofed = new File([gifBytes], 'a.png', { type: 'image/png' });
    const res = await POST(createRequest(BASE_FIELDS, [spoofed]));
    expect(res.status).toBe(400);
    expect(calls.personaInserts).toBe(0);
  });

  it('retries leftover library storage paths BEFORE the persona cascade delete', async () => {
    // addLibraryImages fails on the second insert; its rollback delete of
    // rows succeeds but the storage remove fails, so leftover paths are
    // surfaced. The creation rollback must retry the storage remove BEFORE
    // deleting the persona row — the cascade erases the image rows, making
    // a later retry unrecoverable.
    const events: string[] = [];
    let imageSeq = 0;
    let removeCalls = 0;
    const client = {
      rpc: vi.fn(async () => ({ data: null, error: null })),
      from: vi.fn((table: string) => {
        if (table === 'personas') {
          return {
            insert: vi.fn(() => terminal({ data: { id: PERSONA_ID }, error: null })),
            delete: vi.fn(() => {
              events.push('persona-delete');
              return terminal({ error: null });
            }),
          };
        }
        return {
          select: vi.fn(() => terminal({ count: 0, error: null })),
          insert: vi.fn(() => {
            imageSeq += 1;
            if (imageSeq === 2) return terminal({ data: null, error: { message: 'insert boom' } });
            return terminal({
              data: { id: `img-${imageSeq}`, image_path: `user/img-${imageSeq}.png` },
              error: null,
            });
          }),
          delete: vi.fn(() => ({ in: vi.fn(() => terminal({ error: null })) })),
        };
      }),
      storage: {
        from: vi.fn(() => ({
          upload: vi.fn(async () => ({ error: null })),
          remove: vi.fn(async (paths: string[]) => {
            removeCalls += 1;
            events.push(`remove#${removeCalls}:${paths.length}`);
            return { error: removeCalls === 1 ? { message: 'remove boom' } : null };
          }),
        })),
      },
    };
    vi.mocked(createSupabaseServerClient).mockResolvedValue(client as never);
    vi.mocked(requireSupabaseSession).mockResolvedValue({
      auth: { userId: USER_ID, accessToken: 'cookie-token' },
      error: null,
    } as never);

    const res = await POST(
      createRequest(BASE_FIELDS, [png('a.png'), png('b.png')]),
    );
    expect(res.status).toBe(500);
    // The retry (remove#2, all stored paths) runs before the cascade delete.
    // (remove#3 is the main photo rollback, which runs after the persona row
    // is gone — existing behavior, unrelated to the library paths.)
    expect(events).toEqual([
      'remove#1:2',
      'remove#2:2',
      'persona-delete',
      'remove#3:1',
    ]);
    // The ordering that matters: retry before cascade.
    expect(events.indexOf('remove#2:2')).toBeLessThan(events.indexOf('persona-delete'));
  });

  it('removes row-backed library storage paths AFTER a successful persona cascade delete', async () => {
    // addLibraryImages fails on the second insert and its rollback row
    // delete fails on both attempts, so the first image's row survives
    // with a live storage reference (rowBackedPaths). The cascade delete
    // erases the row but NOT the storage object — the route must remove
    // the file after the delete succeeds, or a private photo orphans in
    // storage forever.
    const events: string[] = [];
    const uploadedPaths: string[] = [];
    let imageSeq = 0;
    const client = {
      rpc: vi.fn(async () => ({ data: null, error: null })),
      from: vi.fn((table: string) => {
        if (table === 'personas') {
          return {
            insert: vi.fn(() => terminal({ data: { id: PERSONA_ID }, error: null })),
            delete: vi.fn(() => {
              events.push('persona-delete');
              return terminal({ error: null });
            }),
          };
        }
        return {
          select: vi.fn(() => terminal({ count: 0, error: null })),
          // Echo the insert payload's image_path: production stores
          // `path`, so the mock must echo it — a hardcoded path makes
          // every stored path look "rowless" (round-7 lesson).
          insert: vi.fn((values: Record<string, unknown>) => {
            imageSeq += 1;
            if (imageSeq === 2) return terminal({ data: null, error: { message: 'insert boom' } });
            return terminal({
              data: { id: `img-${imageSeq}`, image_path: values.image_path },
              error: null,
            });
          }),
          delete: vi.fn(() => ({
            in: vi.fn(() => terminal({ error: { message: 'delete boom' } })),
          })),
        };
      }),
      storage: {
        from: vi.fn((bucket: string) => ({
          upload: vi.fn(async (path: string) => {
            uploadedPaths.push(path);
            return { error: null };
          }),
          remove: vi.fn(async (paths: string[]) => {
            events.push(`remove:${bucket}:${paths.join('|')}`);
            return { error: null };
          }),
        })),
      },
    };
    vi.mocked(createSupabaseServerClient).mockResolvedValue(client as never);
    vi.mocked(requireSupabaseSession).mockResolvedValue({
      auth: { userId: USER_ID, accessToken: 'cookie-token' },
      error: null,
    } as never);

    const res = await POST(
      createRequest(BASE_FIELDS, [png('a.png'), png('b.png')]),
    );
    expect(res.status).toBe(500);
    // uploadedPaths: [photo, image1, image2]. Image 2 has no row (insert
    // failed), so its path is a true orphan removed inside the helper's
    // rollback; image 1's path is row-backed until the cascade delete.
    const [, image1Path, image2Path] = uploadedPaths;
    expect(events).toEqual([
      `remove:personas:${image2Path}`,
      'persona-delete',
      `remove:personas:${image1Path}`,
      `remove:personas:${uploadedPaths[0]}`,
    ]);
    // The row-backed remove runs only after the cascade delete.
    expect(events.indexOf(`remove:personas:${image1Path}`)).toBeGreaterThan(
      events.indexOf('persona-delete'),
    );
  });

  it('never removes row-backed storage when the persona cascade delete fails', async () => {
    // The persona delete fails: the cascade never ran, so the image rows
    // still reference their storage files. Removing them would leave
    // surviving rows pointing at deleted objects.
    const events: string[] = [];
    const uploadedPaths: string[] = [];
    let imageSeq = 0;
    const client = {
      rpc: vi.fn(async () => ({ data: null, error: null })),
      from: vi.fn((table: string) => {
        if (table === 'personas') {
          return {
            insert: vi.fn(() => terminal({ data: { id: PERSONA_ID }, error: null })),
            delete: vi.fn(() => {
              events.push('persona-delete');
              return terminal({ error: { message: 'cascade boom' } });
            }),
          };
        }
        return {
          select: vi.fn(() => terminal({ count: 0, error: null })),
          insert: vi.fn((values: Record<string, unknown>) => {
            imageSeq += 1;
            if (imageSeq === 2) return terminal({ data: null, error: { message: 'insert boom' } });
            return terminal({
              data: { id: `img-${imageSeq}`, image_path: values.image_path },
              error: null,
            });
          }),
          delete: vi.fn(() => ({
            in: vi.fn(() => terminal({ error: { message: 'delete boom' } })),
          })),
        };
      }),
      storage: {
        from: vi.fn((bucket: string) => ({
          upload: vi.fn(async (path: string) => {
            uploadedPaths.push(path);
            return { error: null };
          }),
          remove: vi.fn(async (paths: string[]) => {
            events.push(`remove:${bucket}:${paths.join('|')}`);
            return { error: null };
          }),
        })),
      },
    };
    vi.mocked(createSupabaseServerClient).mockResolvedValue(client as never);
    vi.mocked(requireSupabaseSession).mockResolvedValue({
      auth: { userId: USER_ID, accessToken: 'cookie-token' },
      error: null,
    } as never);

    const res = await POST(
      createRequest(BASE_FIELDS, [png('a.png'), png('b.png')]),
    );
    expect(res.status).toBe(500);
    const image1Path = uploadedPaths[1];
    // The rowless orphan is still removed; the row-backed path is never
    // touched while its row survives.
    expect(events).not.toContain(`remove:personas:${image1Path}`);
    expect(events).toContain('persona-delete');
  });
});
