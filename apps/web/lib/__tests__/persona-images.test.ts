// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from 'vitest';

import {
  recordRecentImageId,
  resolveVideoImage,
  setPrimaryLibraryImage,
  validateImageFile,
} from '../persona-images';

const LIBRARY = [
  {
    id: 'img-casual',
    image_path: 'user/a.png',
    tag: 'casual',
    description: 'woman in jeans at the park',
    is_primary: true,
  },
  {
    id: 'img-formal',
    image_path: 'user/b.png',
    tag: 'formal',
    description: 'business woman in a suit at the office',
    is_primary: false,
  },
];

function terminal(result: unknown): Record<string, unknown> {
  const chain: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'order', 'update']) {
    chain[method] = vi.fn(() => chain);
  }
  chain.then = (resolve: (value: unknown) => void): Promise<unknown> =>
    Promise.resolve(result).then(resolve);
  return chain;
}

function mockClient(options: {
  library?: typeof LIBRARY | null;
  libraryError?: { message: string } | null;
  historyError?: { message: string; code?: string } | null;
} = {}) {
  const calls = { rpcCalls: [] as Array<{ fn: string; args: unknown }> };
  const client = {
    from: vi.fn((table: string) => {
      if (table === 'persona_images') {
        return terminal({
          data: options.library === undefined ? LIBRARY : options.library,
          error: options.libraryError ?? null,
        });
      }
      throw new Error(`unexpected table: ${table}`);
    }),
    rpc: vi.fn(async (fn: string, args: unknown) => {
      calls.rpcCalls.push({ fn, args });
      return { data: null, error: options.historyError ?? null };
    }),
  };
  return { calls, client: client as never };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('resolveVideoImage', () => {
  it('resolves to null for an empty library (legacy fallback)', async () => {
    const { calls, client } = mockClient({ library: [] });
    const result = await resolveVideoImage(client, 'persona-1', 'user-1', [], { topic: 'business' });
    expect(result).toEqual({ ok: true, image: null });
    expect(calls.rpcCalls).toHaveLength(0);
  });

  it('returns 404 for an image_id outside the library', async () => {
    const { client } = mockClient();
    const result = await resolveVideoImage(client, 'persona-1', 'user-1', [], { imageId: 'nope' });
    expect(result).toEqual({
      ok: false,
      error: "image_id not found in this persona's image library.",
      status: 404,
    });
  });

  it('scopes the library query to the owning user', async () => {
    // Defense in depth: with the service-role client (API-key callers) the
    // route already verified ownership, but the query itself must not read
    // another user's rows if a future caller skips that check.
    const eqCalls: Array<[string, unknown]> = [];
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn((column: string, value: unknown) => {
      eqCalls.push([column, value]);
      return chain;
    });
    chain.order = vi.fn(() => chain);
    chain.then = (resolve: (value: unknown) => void): Promise<unknown> =>
      Promise.resolve({ data: [], error: null }).then(resolve);
    const client = { from: vi.fn(() => chain) };
    const { resolveVideoImage } = await import('../persona-images');
    await resolveVideoImage(client as never, 'persona-1', 'user-1', [], {
      topic: null,
      niche: null,
      script: null,
    });
    expect(eqCalls).toContainEqual(['persona_id', 'persona-1']);
    expect(eqCalls).toContainEqual(['user_id', 'user-1']);
  });

  it('honors an explicit image_id without touching the rotation history', async () => {
    const { calls, client } = mockClient();
    const result = await resolveVideoImage(
      client,
      'persona-1',
      'user-1',
      ['img-casual'],
      { topic: 'business', imageId: 'img-formal' },
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.image?.id).toBe('img-formal');
    // A pinned override is not a rotation pick: the anti-repeat history is
    // left alone.
    expect(calls.rpcCalls).toHaveLength(0);
  });

  it('returns 404 for an image_id when the library is empty', async () => {
    const { client } = mockClient({ library: [] });
    const result = await resolveVideoImage(client, 'persona-1', 'user-1', [], { imageId: 'nope' });
    expect(result).toEqual({
      ok: false,
      error: "image_id not found in this persona's image library.",
      status: 404,
    });
  });

  it('matches tags against the video topic and excludes recent images', async () => {
    const { client } = mockClient();
    const result = await resolveVideoImage(
      client,
      'persona-1',
      'user-1',
      ['img-formal'],
      { topic: 'business meeting at the office', niche: 'finance' },
    );
    expect(result.ok).toBe(true);
    // img-formal would win on tags but was used recently: falls to img-casual.
    if (result.ok) expect(result.image?.id).toBe('img-casual');
  });

  it('returns 500 when the library cannot be loaded', async () => {
    const { client } = mockClient({ libraryError: { message: 'db down' } });
    const result = await resolveVideoImage(client, 'persona-1', 'user-1', [], {});
    expect(result).toEqual({
      ok: false,
      error: 'Failed to load persona image library.',
      status: 500,
    });
  });

  it('never touches the rotation history (the caller records after the gate)', async () => {
    const { calls, client } = mockClient();
    const result = await resolveVideoImage(client, 'persona-1', 'user-1', [], { topic: 'business' });
    expect(result.ok).toBe(true);
    expect(calls.rpcCalls).toHaveLength(0);
  });
});

describe('recordRecentImageId', () => {
  it('calls the atomic history function with the persona and image ids', async () => {
    const { calls, client } = mockClient();
    await recordRecentImageId(client, 'persona-1', 'img-formal');
    expect(calls.rpcCalls).toEqual([
      {
        fn: 'record_persona_image_use',
        args: { p_persona_id: 'persona-1', p_image_id: 'img-formal' },
      },
    ]);
  });

  it('never throws when the history write fails (best-effort)', async () => {
    const { calls, client } = mockClient({ historyError: { message: 'db down' } });
    await expect(
      recordRecentImageId(client, 'persona-1', 'img-formal'),
    ).resolves.toBeUndefined();
    expect(calls.rpcCalls).toHaveLength(1);
  });
});

describe('setPrimaryLibraryImage', () => {
  it('swaps the primary image through the atomic SQL function', async () => {
    const { calls, client } = mockClient();
    const result = await setPrimaryLibraryImage(client, 'persona-1', 'img-2');
    expect(result).toBeNull();
    expect(calls.rpcCalls).toEqual([
      {
        fn: 'set_primary_persona_image',
        args: { p_persona_id: 'persona-1', p_image_id: 'img-2' },
      },
    ]);
  });

  it('returns an error when the swap RPC fails', async () => {
    const { client } = mockClient({ historyError: { message: 'db down' } });
    const result = await setPrimaryLibraryImage(client, 'persona-1', 'img-2');
    expect(result).toEqual({ error: 'Failed to update image.', status: 500 });
  });

  it('returns 404 when the swap RPC reports the image vanished (P0002)', async () => {
    const { client } = mockClient({
      historyError: { message: 'image gone', code: 'P0002' },
    });
    const result = await setPrimaryLibraryImage(client, 'persona-1', 'img-2');
    expect(result).toEqual({
      error: "Image not found in this persona's image library.",
      status: 404,
    });
  });
});

describe('validateImageFile', () => {
  const png = (name: string, type = 'image/png', size = 1024): File =>
    new File([new Uint8Array(size)], name, { type });

  it('accepts jpg, png, and webp', () => {
    for (const [name, type] of [
      ['a.jpg', 'image/jpeg'],
      ['b.png', 'image/png'],
      ['c.webp', 'image/webp'],
    ] as Array<[string, string]>) {
      const result = validateImageFile(png(name, type));
      expect('error' in result).toBe(false);
    }
  });

  it('accepts a structural file (undici File is a different constructor)', () => {
    const undiciLike = {
      name: 'server.png',
      type: 'image/png',
      size: 2048,
      arrayBuffer: async () => new ArrayBuffer(8),
    };
    const result = validateImageFile(undiciLike);
    expect('error' in result).toBe(false);
  });

  it('rejects non-images, oversized files, and unsupported extensions', () => {
    expect(validateImageFile(new File(['x'], 'd.pdf', { type: 'application/pdf' }))).toMatchObject({
      error: expect.any(String),
    });
    expect(validateImageFile(png('big.png', 'image/png', 11 * 1024 * 1024))).toMatchObject({
      error: expect.stringContaining('10MB'),
    });
    expect(validateImageFile(png('a.bmp', 'image/bmp'))).toMatchObject({
      error: expect.stringContaining('Only image files'),
    });
    expect(validateImageFile(png('photo.png', 'image/png'))).not.toHaveProperty('error');
  });

  it('rejects image/* payloads outside the allowlist even with a valid extension', () => {
    // image/gif renamed to .png: the MIME allowlist fires before the
    // extension check, so API-key callers can't bypass the type restriction.
    expect(validateImageFile(new File(['x'], 'photo.png', { type: 'image/gif' }))).toMatchObject({
      error: expect.stringContaining('Only image files'),
    });
    expect(validateImageFile(new File(['x'], 'photo.png', { type: 'image/svg+xml' }))).toMatchObject({
      error: expect.stringContaining('Only image files'),
    });
  });
});

describe('addLibraryImages', () => {
  const pngFile = (name: string, size = 1024): File => {
    // Real PNG magic bytes: addLibraryImages validates content, not just
    // the declared MIME type.
    const bytes = new Uint8Array(size);
    if (size >= 8) bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    return new File([bytes], name, { type: 'image/png' });
  };

  function rollbackClient(options: { failInsertOn?: number; failInsertWith?: string; failRemove?: boolean; failRowDelete?: boolean }) {
    let inserts = 0;
    const removedPaths: string[][] = [];
    const client = {
      from: vi.fn((table: string) => {
        if (table !== 'persona_images') throw new Error(`unexpected table: ${table}`);
        return {
          select: vi.fn(() => terminal({ count: 0, error: null })),
          insert: vi.fn(() => {
            inserts += 1;
            const id = `img-${inserts}`;
            if (options.failInsertWith !== undefined) {
              return {
                select: vi.fn(() => ({
                  single: vi.fn(async () => ({
                    data: null,
                    error: { message: options.failInsertWith },
                  })),
                })),
              };
            }
            if (options.failInsertOn === inserts) {
              return { select: vi.fn(() => ({ single: vi.fn(async () => ({ data: null, error: { message: 'insert boom' } })) })) };
            }
            const data = { id, image_path: `user/img-${inserts}.png`, tag: '', description: '', is_primary: false, created_at: '' };
            return { select: vi.fn(() => ({ single: vi.fn(async () => ({ data, error: null })) })) };
          }),
          delete: vi.fn(() => ({ in: vi.fn(() => terminal({ error: options.failRowDelete ? { message: 'delete boom' } : null })) })),
        };
      }),
      storage: {
        from: vi.fn(() => ({
          upload: vi.fn(async () => ({ error: null })),
          remove: vi.fn(async (paths: string[]) => {
            removedPaths.push(paths);
            return { error: options.failRemove ? { message: 'remove boom' } : null };
          }),
        })),
      },
    };
    return { client: client as never, removedPaths };
  }

  it('surfaces leftover storage paths when the rollback remove fails', async () => {
    const { addLibraryImages } = await import('../persona-images');
    const { client } = rollbackClient({ failInsertOn: 2, failRemove: true });
    const result = await addLibraryImages(client, 'user-1', 'persona-1', [
      { file: pngFile('a.png') },
      { file: pngFile('b.png') },
    ]);
    // Rollback removes the STORED upload paths (both uploads happened before
    // the insert failed), and both failed removes are surfaced.
    const leftover = (result as { leftoverPaths: string[] }).leftoverPaths;
    expect(leftover).toHaveLength(2);
    expect(leftover.every((p) => p.startsWith('user-1/'))).toBe(true);
  });

  it('returns added image paths when the rollback row delete fails', async () => {
    const { addLibraryImages } = await import('../persona-images');
    const { client, removedPaths } = rollbackClient({ failInsertOn: 2, failRowDelete: true });
    const result = await addLibraryImages(client, 'user-1', 'persona-1', [
      { file: pngFile('a.png') },
      { file: pngFile('b.png') },
    ]);
    // The first image's row survives the rollback, so its storage path is
    // surfaced for the caller to retry before any cascade cleanup — and the
    // storage files are NOT removed while rows still reference them.
    expect(result).toMatchObject({ status: 500 });
    const leftover = (result as { leftoverPaths: string[] }).leftoverPaths;
    expect(leftover).toEqual(['user/img-1.png']);
    expect(removedPaths).toHaveLength(0);
  });

  it('returns 400 when the file bytes cannot be read', async () => {
    // A truncated multipart body makes arrayBuffer() reject: unlike the
    // client-side validateImageContent path, the server read had no
    // try/catch and the failure surfaced as an unstructured 500.
    const { addLibraryImages } = await import('../persona-images');
    const { client } = rollbackClient({});
    const unreadable = {
      name: 'a.png',
      type: 'image/png',
      size: 1024,
      arrayBuffer: () => Promise.reject(new Error('truncated body')),
    };
    const result = await addLibraryImages(client, 'user-1', 'persona-1', [
      { file: unreadable as unknown as File, tag: '', description: '' },
    ]);
    expect(result).toEqual({
      error: 'Could not read the image file.',
      status: 400,
      leftoverPaths: [],
    });
  });

  it('maps the DB limit-trigger violation to a 400 under concurrency', async () => {
    // Two concurrent requests can both pass the app-level count check; the
    // loser hits the enforce_persona_image_limit trigger. A full library is
    // a client-input problem (the app 400s it in the non-racing case), so
    // the trigger violation is recognized and mapped to 400, not a generic
    // 500.
    const { addLibraryImages } = await import('../persona-images');
    const { client } = rollbackClient({
      failInsertWith: 'persona image library is limited to 10 images',
    });
    const result = await addLibraryImages(client, 'user-1', 'persona-1', [
      { file: pngFile('a.png'), tag: '', description: '' },
    ]);
    expect(result).toMatchObject({ status: 400 });
    const body = result as { error: string };
    expect(body.error).toMatch(/full/i);
  });

  it('derives the storage extension from the detected content, not the file name', async () => {
    const { addLibraryImages } = await import('../persona-images');
    const uploadedPaths: string[] = [];
    const client = {
      from: vi.fn(() => ({
        select: vi.fn(() => terminal({ count: 0, error: null })),
        insert: vi.fn(() => ({
          select: vi.fn(() => ({
            single: vi.fn(async () => ({
              data: { id: 'img-1', image_path: '', tag: '', description: '', is_primary: false, created_at: '' },
              error: null,
            })),
          })),
        })),
      })),
      storage: {
        from: vi.fn(() => ({
          upload: vi.fn(async (path: string) => {
            uploadedPaths.push(path);
            return { error: null };
          }),
          remove: vi.fn(async () => ({ error: null })),
        })),
      },
    };
    // WebP bytes named photo.png with a truthful declared type: the stored
    // object must use the detected .webp extension, not the .png file name.
    const bytes = new Uint8Array(1024);
    bytes.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]); // RIFF....WEBP
    const file = new File([bytes], 'photo.png', { type: 'image/webp' });
    const result = await addLibraryImages(client as never, 'user-1', 'persona-1', [{ file }]);
    expect(result).toMatchObject({ images: expect.any(Array) });
    expect(uploadedPaths).toHaveLength(1);
    expect(uploadedPaths[0]).toMatch(/^user-1\/.+\.webp$/);
  });

  it('keeps a zero-byte file so validation emits the right error and tags stay index-aligned', async () => {
    const { addLibraryImages } = await import('../persona-images');
    const { client } = rollbackClient({});
    const result = await addLibraryImages(client, 'user-1', 'persona-1', [
      { file: pngFile('a.png'), tag: 'first' },
      { file: pngFile('empty.png', 0), tag: 'second' },
      { file: pngFile('c.png'), tag: 'third' },
    ]);
    // The zero-byte file must not be silently dropped (which would shift
    // 'third' onto the second image): it fails validation with a clear error.
    expect(result).toMatchObject({ status: 400 });
    expect((result as { error: string }).error).toContain('required');
  });
});

describe('validateImageBuffer', () => {
  const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const GIF_MAGIC = Buffer.from('GIF89a........', 'ascii');
  const ZEROS = Buffer.alloc(12);

  it('returns the detected mime when magic matches the declared type', async () => {
    const { validateImageBuffer } = await import('../persona-images');
    expect(validateImageBuffer(PNG_MAGIC, 'image/png')).toEqual({ mime: 'image/png' });
  });

  it('rejects content whose magic does not match the declared type', async () => {
    // JPEG bytes with a spoofed image/png type: the magic is allowed, but
    // the declared type lies.
    const { validateImageBuffer } = await import('../persona-images');
    const jpegMagic = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(validateImageBuffer(jpegMagic, 'image/png')).toMatchObject({
      error: expect.stringContaining('does not match'),
    });
  });

  it('rejects recognized-but-not-allowed content (GIF)', async () => {
    const { validateImageBuffer } = await import('../persona-images');
    expect(validateImageBuffer(GIF_MAGIC, 'image/gif')).toMatchObject({
      error: expect.stringContaining('Only JPG, PNG, or WebP'),
    });
  });

  it('rejects unrecognized content', async () => {
    const { validateImageBuffer } = await import('../persona-images');
    expect(validateImageBuffer(ZEROS, 'image/png')).toMatchObject({
      error: expect.stringContaining('not a recognized image'),
    });
  });
});
