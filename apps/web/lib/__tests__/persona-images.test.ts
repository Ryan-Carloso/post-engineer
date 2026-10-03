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
    expect(result).toEqual({ ok: true, image: null });    expect(calls.rpcCalls).toHaveLength(0);
  });

  it('orders the library by created_at then id: same-transaction ties resolve deterministically', async () => {
    // The GET list documents "must match resolveVideoImage's order
    // exactly" with a created_at+id tie-break; without the id tie-break
    // here, rows sharing a created_at (fast sequential inserts share
    // now()) can disagree with the UI about which image is "first".
    const orderCalls: Array<{ column: string; ascending: boolean }> = [];
    const chain: Record<string, unknown> = {};
    chain.select = vi.fn(() => chain);
    chain.eq = vi.fn(() => chain);
    chain.order = vi.fn((column: string, options: { ascending: boolean }) => {
      orderCalls.push({ column, ascending: options.ascending });
      return chain;
    });
    chain.then = (resolve: (value: unknown) => void): Promise<unknown> =>
      Promise.resolve({ data: [], error: null }).then(resolve);
    const client = { from: vi.fn(() => chain) };

    await resolveVideoImage(client as never, 'persona-1', 'user-1', [], { topic: 'x' });

    expect(orderCalls).toEqual([
      { column: 'created_at', ascending: true },
      { column: 'id', ascending: true },
    ]);
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

  it('returns 404 for an empty-string image_id (explicit id takes the exact-match path)', async () => {
    // '' is falsy: a truthiness gate would skip the 404 check and fall
    // through to the legacy photo fallback. Every provided id — even
    // '' — must hit the exact-match check.
    const { client } = mockClient();
    const result = await resolveVideoImage(client, 'persona-1', 'user-1', [], { imageId: '' });
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
  it('calls the atomic history function with the persona, image, and verified user ids', async () => {
    const { calls, client } = mockClient();
    await recordRecentImageId(client, 'persona-1', 'img-formal', 'user-1');
    expect(calls.rpcCalls).toEqual([
      {
        fn: 'record_persona_image_use',
        args: { p_persona_id: 'persona-1', p_image_id: 'img-formal', p_user_id: 'user-1' },
      },
    ]);
  });

  it('never throws when the history write fails (best-effort)', async () => {
    const { calls, client } = mockClient({ historyError: { message: 'db down' } });
    await expect(
      recordRecentImageId(client, 'persona-1', 'img-formal', 'user-1'),
    ).resolves.toBeUndefined();
    expect(calls.rpcCalls).toHaveLength(1);
  });
});

describe('setPrimaryLibraryImage', () => {
  it('swaps the primary image through the atomic SQL function', async () => {
    const { calls, client } = mockClient();
    const result = await setPrimaryLibraryImage(client, 'persona-1', 'img-2', 'user-1');
    expect(result).toBeNull();
    expect(calls.rpcCalls).toEqual([
      {
        fn: 'set_primary_persona_image',
        args: { p_persona_id: 'persona-1', p_image_id: 'img-2', p_user_id: 'user-1' },
      },
    ]);
  });

  it('returns an error when the swap RPC fails', async () => {
    const { client } = mockClient({ historyError: { message: 'db down' } });
    const result = await setPrimaryLibraryImage(client, 'persona-1', 'img-2', 'user-1');
    expect(result).toEqual({ error: 'Failed to update image.', status: 500 });
  });

  it('returns 404 when the swap RPC reports the image vanished (P0002)', async () => {
    const { client } = mockClient({
      historyError: { message: 'image gone', code: 'P0002' },
    });
    const result = await setPrimaryLibraryImage(client, 'persona-1', 'img-2', 'user-1');
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

  it('reports the size error before the type error for oversized non-images', () => {
    // An 11MB PDF should tell the user it's too large (actionable), not
    // that it's the wrong type (confusing — the size is the real problem).
    const result = validateImageFile(
      new File([new Uint8Array(11 * 1024 * 1024)], 'big.pdf', { type: 'application/pdf' }),
    );
    expect(result).toMatchObject({ error: expect.stringContaining('10MB') });
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

  it('rejects bare-extension filenames like ".png" (no basename)', () => {
    // '.png'.split('.').pop() is 'png', so the extension allowlist alone
    // passes it. The MCP boundary rejects dotfiles; the web fail-fast
    // check must agree on the same input class.
    expect(validateImageFile(png('.png', 'image/png'))).toMatchObject({
      error: expect.stringContaining('JPG/JPEG, PNG, or WebP'),
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

  function rollbackClient(options: { failInsertOn?: number; failInsertWith?: { message: string; code?: string }; failRemove?: boolean; failRowDelete?: boolean }) {
    let inserts = 0;
    const removedPaths: string[][] = [];
    const uploadedPaths: string[] = [];
    const client = {
      from: vi.fn((table: string) => {
        if (table !== 'persona_images') throw new Error(`unexpected table: ${table}`);
        return {
          select: vi.fn(() => terminal({ count: 0, error: null })),
          insert: vi.fn((row: Record<string, unknown>) => {
            inserts += 1;
            const id = `img-${inserts}`;
            if (options.failInsertWith !== undefined) {
              const { message, code } = options.failInsertWith;
              return {
                select: vi.fn(() => ({
                  single: vi.fn(async () => ({
                    data: null,
                    error: { message, ...(code !== undefined ? { code } : {}) },
                  })),
                })),
              };
            }
            if (options.failInsertOn === inserts) {
              return { select: vi.fn(() => ({ single: vi.fn(async () => ({ data: null, error: { message: 'insert boom' } })) })) };
            }
            // Echo the real image_path from the insert payload: in production
            // the row stores the upload path, so added[].image_path always
            // matches a stored path. A hardcoded fake would make every stored
            // path look "rowless" and break the rollback assertions.
            const data = { id, image_path: row.image_path, tag: '', description: '', is_primary: false, created_at: '' };
            return { select: vi.fn(() => ({ single: vi.fn(async () => ({ data, error: null })) })) };
          }),
          delete: vi.fn(() => ({ in: vi.fn(() => terminal({ error: options.failRowDelete ? { message: 'delete boom' } : null })) })),
        };
      }),
      storage: {
        from: vi.fn(() => ({
          upload: vi.fn(async (path: string) => {
            uploadedPaths.push(path);
            return { error: null };
          }),
          remove: vi.fn(async (paths: string[]) => {
            removedPaths.push(paths);
            return { error: options.failRemove ? { message: 'remove boom' } : null };
          }),
        })),
      },
    };
    return { client: client as never, removedPaths, uploadedPaths };
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
    const leftover = (result as { leftoverPaths: { orphanPaths: string[] } }).leftoverPaths;
    expect(leftover.orphanPaths).toHaveLength(2);
    expect(leftover.orphanPaths.every((p) => p.startsWith('user-1/'))).toBe(true);
  });

  it('returns added image paths when the rollback row delete fails', async () => {
    const { addLibraryImages } = await import('../persona-images');
    const { client, removedPaths, uploadedPaths } = rollbackClient({ failInsertOn: 2, failRowDelete: true });
    const result = await addLibraryImages(client, 'user-1', 'persona-1', [
      { file: pngFile('a.png') },
      { file: pngFile('b.png') },
    ]);
    // The first image's row survives the rollback, so its storage path is
    // surfaced as row-backed for the caller to handle (never blindly
    // storage.remove()d) — and the row's file is NOT removed while the row
    // still references it. The second image uploaded but never got a row
    // (its insert failed): that path is a true orphan and is removed
    // immediately.
    expect(result).toMatchObject({ status: 500 });
    const leftover = (result as { leftoverPaths: { orphanPaths: string[]; rowBackedPaths: string[] } }).leftoverPaths;
    expect(leftover.rowBackedPaths).toEqual([uploadedPaths[0]]);
    expect(leftover.orphanPaths).toEqual([]);
    expect(removedPaths).toHaveLength(1);
    expect(removedPaths[0]).toEqual([uploadedPaths[1]]);
  });

  it('surfaces rowless paths when the rollback row delete and rowless remove both fail', async () => {
    const { addLibraryImages } = await import('../persona-images');
    const { client, uploadedPaths } = rollbackClient({ failInsertOn: 2, failRowDelete: true, failRemove: true });
    const result = await addLibraryImages(client, 'user-1', 'persona-1', [
      { file: pngFile('a.png') },
      { file: pngFile('b.png') },
    ]);
    // Neither the surviving row's path nor the rowless orphan's path could
    // be cleaned up: the row-backed path is split out (never blindly
    // removed), the failed orphan is surfaced — nothing silently dropped.
    expect(result).toMatchObject({ status: 500 });
    const leftover = (result as { leftoverPaths: { orphanPaths: string[]; rowBackedPaths: string[] } }).leftoverPaths;
    expect(leftover.rowBackedPaths).toEqual([uploadedPaths[0]]);
    expect(leftover.orphanPaths).toEqual([uploadedPaths[1]]);
  });

  it('returns 400 when the file bytes cannot be read', async () => {
    // A truncated multipart body makes arrayBuffer() reject: the server
    // read had no try/catch and the failure surfaced as an unstructured
    // 500.
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
      leftoverPaths: { orphanPaths: [], rowBackedPaths: [] },
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
      failInsertWith: { message: 'persona image library is limited to 10 images', code: 'PEL01' },
    });
    const result = await addLibraryImages(client, 'user-1', 'persona-1', [
      { file: pngFile('a.png'), tag: '', description: '' },
    ]);
    expect(result).toMatchObject({ status: 400 });
    const body = result as { error: string };
    expect(body.error).toMatch(/full/i);
  });

  it('maps the limit trigger by SQLSTATE, not by the English message', async () => {
    // The trigger message is human copy and may be reworded; the PEL01
    // SQLSTATE is the stable contract. A reworded message with the same
    // code must still map to 400.
    const { addLibraryImages } = await import('../persona-images');
    const { client } = rollbackClient({
      failInsertWith: { message: 'some reworded limit message', code: 'PEL01' },
    });
    const result = await addLibraryImages(client, 'user-1', 'persona-1', [
      { file: pngFile('a.png'), tag: '', description: '' },
    ]);
    expect(result).toMatchObject({ status: 400 });
    expect((result as { error: string }).error).toMatch(/full/i);
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
      error: expect.stringContaining('Only JPG/JPEG, PNG, or WebP'),
    });
  });

  it('rejects unrecognized content', async () => {
    const { validateImageBuffer } = await import('../persona-images');
    expect(validateImageBuffer(ZEROS, 'image/png')).toMatchObject({
      error: expect.stringContaining('not a recognized image'),
    });
  });
});

describe('supabase/migrations/002_persona-images.sql literals', () => {
  it('keeps the SQL literals in sync with the TypeScript constants', async () => {
    // The trigger/RPC literals have no import of the TS constants; a
    // one-sided change would silently desynchronize app-side 400s from the
    // database behavior. This test parses the SQL file and asserts the
    // literals match.
    const { readFileSync } = await import('node:fs');
    const { join, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const sqlPath = join(
      dirname(fileURLToPath(import.meta.url)),
      '..',
      '..',
      '..',
      '..',
      'supabase',
      'migrations',
      '002_persona-images.sql',
    );
    const sql = readFileSync(sqlPath, 'utf8');
    const { MAX_PERSONA_IMAGES, PERSONA_IMAGE_LIMIT_SQLSTATE } = await import('../persona-images');
    const { PERSONA_IMAGE_HISTORY_LIMIT } = await import('../persona-image-select');

    // Limit trigger: `> 10` must equal MAX_PERSONA_IMAGES.
    const limitMatch = sql.match(/count\(\*\) from public\.persona_images where persona_id = new\.persona_id\) > (\d+)/);
    expect(limitMatch?.[1]).toBe(String(MAX_PERSONA_IMAGES));

    // Limit trigger errcode must equal PERSONA_IMAGE_LIMIT_SQLSTATE.
    const errcodeMatch = sql.match(/raise exception '[^']+' using errcode = '([A-Z0-9]+)'/);
    expect(errcodeMatch?.[1]).toBe(PERSONA_IMAGE_LIMIT_SQLSTATE);

    // History window: `[1:3]` must equal PERSONA_IMAGE_HISTORY_LIMIT.
    const historyMatch = sql.match(/\[1:(\d+)\]/);
    expect(historyMatch?.[1]).toBe(String(PERSONA_IMAGE_HISTORY_LIMIT));

    // Ownership guard: both RPCs take p_user_id and enforce it explicitly
    // instead of relying on out-of-repo personas RLS. The app always passes
    // the verified caller id; direct PostgREST callers fall back to
    // auth.uid() via coalesce.
    for (const fn of ['record_persona_image_use', 'set_primary_persona_image']) {
      expect(sql).toContain(`function public.${fn}(`);
      expect(sql).toMatch(
        new RegExp(`function public\\.${fn}\\([^)]*p_user_id uuid`),
      );
    }
    const guardMatches = sql.match(/user_id = coalesce\(p_user_id, auth\.uid\(\)\)/g);
    expect(guardMatches).toHaveLength(2);

    // The guards must be enforcing, not advisory: set_primary_persona_image
    // must raise when the ownership-checked lock finds no row, otherwise a
    // service-role caller with a wrong/omitted p_user_id would fall through
    // to the persona_id-scoped UPDATEs and corrupt another tenant's rows.
    // record_persona_image_use must raise instead of silently writing
    // nothing when no row matches.
    const noRowRaises = sql.match(/if not found then\s+raise exception 'persona % not found for caller'/g);
    expect(noRowRaises).toHaveLength(2);

    // The persona_images -> personas FK must be declared EXPLICITLY in an
    // idempotent do-block, not only inline in `create table if not exists`.
    // 001_schema.sql's snapshot creates persona_images WITHOUT the FK, so
    // the inline reference never fires for self-hosters who run 001 before
    // 002 (create-if-not-exists is a no-op on an existing table) and the FK
    // would silently never exist on their DB.
    expect(sql).toMatch(/pg_constraint where conname = 'fk_persona_images_persona'/);
    expect(sql).toMatch(
      /add constraint fk_persona_images_persona\s+foreign key \(persona_id\) references public\.personas\(id\) on delete cascade/,
    );
  });
});
