// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findRepoRoot } from '@/test/repo-root';
import {
  personaAssetPath,
  recordRecentImageId,
  resolveVideoImage,
  setPrimaryLibraryImage,
  validateImageFile,
} from '../persona-images';

const STORAGE_DOC_PATH = join(
  findRepoRoot(import.meta.url),
  'supabase',
  'README.md',
);

describe('supabase/README.md — personas storage layout', () => {
  const doc = readFileSync(STORAGE_DOC_PATH, 'utf8');

  it('documents the {userId}/{personaId}/ layout the helper builds', () => {
    expect(doc).toContain('personas/{userId}/{personaId}/photo.');
    expect(doc).toContain('personas/{userId}/{personaId}/images/{uuid}.{ext}');
    expect(doc).toContain('{userId}/{uuid}.{ext}');
  });

  it('states that the policy reads only the FIRST segment', () => {
    expect(doc).toContain('foldername(name))[1] = auth.uid()');
    expect(doc).toContain('Do not "harden" the policy to require two segments');
  });

  it('names personaAssetPath as the only path builder', () => {
    expect(doc).toContain('personaAssetPath');
  });
});

describe('personaAssetPath', () => {
  it('nests the file under the user and the persona', () => {
    expect(personaAssetPath('user-1', 'persona-1', 'photo.png')).toBe('user-1/persona-1/photo.png');
    expect(personaAssetPath('user-1', 'persona-1', 'images/abc.png')).toBe(
      'user-1/persona-1/images/abc.png',
    );
  });

  it('rejects an empty segment', () => {
    expect(() => personaAssetPath('', 'persona-1', 'photo.png')).toThrow(/non-empty/);
    expect(() => personaAssetPath('user-1', '', 'photo.png')).toThrow(/non-empty/);
  });

  it('rejects a segment that would escape the user folder', () => {
    expect(() => personaAssetPath('user-1', '../other-user/photo.png', 'photo.png')).toThrow(/non-empty/);
    expect(() => personaAssetPath('user-1', 'a/b', 'photo.png')).toThrow(/non-empty/);
    expect(() => personaAssetPath('user/1', 'persona-1', 'photo.png')).toThrow(/non-empty/);
  });

  it('rejects an empty or absolute file name', () => {
    expect(() => personaAssetPath('user-1', 'persona-1', '')).toThrow(/relative path/);
    expect(() => personaAssetPath('user-1', 'persona-1', '/photo.png')).toThrow(/relative path/);
  });
});

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
  it('resolves to null for an empty library (empty-library fallback)', async () => {
    const { calls, client } = mockClient({ library: [] });
    const result = await resolveVideoImage(client, 'persona-1', 'user-1', [], { title: 'business' });
    expect(result).toEqual({ ok: true, image: null });    expect(calls.rpcCalls).toHaveLength(0);
  });

  it('orders the library by created_at then id: same-transaction ties resolve deterministically', async () => {
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

    await resolveVideoImage(client as never, 'persona-1', 'user-1', [], { title: 'x' });

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
      title: null,
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
      { title: 'business', imageId: 'img-formal' },
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.image?.id).toBe('img-formal');
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
    const { client } = mockClient();
    const result = await resolveVideoImage(client, 'persona-1', 'user-1', [], { imageId: '' });
    expect(result).toEqual({
      ok: false,
      error: "image_id not found in this persona's image library.",
      status: 404,
    });
  });

  it('matches tags against the video title and excludes recent images', async () => {
    const { client } = mockClient();
    const result = await resolveVideoImage(
      client,
      'persona-1',
      'user-1',
      ['img-formal'],
      { title: 'business meeting at the office', niche: 'finance' },
    );
    expect(result.ok).toBe(true);
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
    const result = await resolveVideoImage(client, 'persona-1', 'user-1', [], { title: 'business' });
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
    expect(validateImageFile(new File(['x'], 'photo.png', { type: 'image/gif' }))).toMatchObject({
      error: expect.stringContaining('Only image files'),
    });
    expect(validateImageFile(new File(['x'], 'photo.png', { type: 'image/svg+xml' }))).toMatchObject({
      error: expect.stringContaining('Only image files'),
    });
  });

  it('rejects bare-extension filenames like ".png" (no basename)', () => {
    expect(validateImageFile(png('.png', 'image/png'))).toMatchObject({
      error: expect.stringContaining('JPG/JPEG, PNG, or WebP'),
    });
  });
});

describe('addLibraryImages', () => {
  const pngFile = (name: string, size = 1024): File => {
    const bytes = new Uint8Array(size);
    if (size >= 8) bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    return new File([bytes], name, { type: 'image/png' });
  };

  function rollbackClient(options: { failInsertOn?: number; failInsertWith?: { message: string; code?: string }; failRemove?: boolean; failRowDelete?: boolean }) {
    let inserts = 0;
    const removedPaths: string[][] = [];
    const uploadedPaths: string[] = [];
    const uploadedTypes: string[] = [];
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
            const data = { id, image_path: row.image_path, tag: '', description: '', is_primary: false, created_at: '' };
            return { select: vi.fn(() => ({ single: vi.fn(async () => ({ data, error: null })) })) };
          }),
          delete: vi.fn(() => ({ in: vi.fn(() => terminal({ error: options.failRowDelete ? { message: 'delete boom' } : null })) })),
        };
      }),
      storage: {
        from: vi.fn(() => ({
          upload: vi.fn(async (path: string, _bytes: Uint8Array, opts: { contentType: string }) => {
            uploadedPaths.push(path);
            uploadedTypes.push(opts.contentType);
            return { error: null };
          }),
          remove: vi.fn(async (paths: string[]) => {
            removedPaths.push(paths);
            return { error: options.failRemove ? { message: 'remove boom' } : null };
          }),
        })),
      },
    };
    return { client: client as never, removedPaths, uploadedPaths, uploadedTypes };
  }

  it('stores a JPEG uploaded with a .png name and image/png type as a JPEG', async () => {
    const { addLibraryImages } = await import('../persona-images');
    const { client, uploadedPaths, uploadedTypes } = rollbackClient({});
    const bytes = new Uint8Array(1024);
    bytes.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
    const result = await addLibraryImages(client, 'user-1', 'persona-1', [
      { file: new File([bytes], 'photo.png', { type: 'image/png' }) },
    ]);
    expect(result).toMatchObject({ images: [{ id: 'img-1' }] });
    expect(uploadedPaths).toHaveLength(1);
    expect(uploadedPaths[0]).toMatch(/^user-1\/persona-1\/images\/[0-9a-f-]+\.jpg$/);
    expect(uploadedTypes).toEqual(['image/jpeg']);
  });

  it('surfaces leftover storage paths when the rollback remove fails', async () => {
    const { addLibraryImages } = await import('../persona-images');
    const { client } = rollbackClient({ failInsertOn: 2, failRemove: true });
    const result = await addLibraryImages(client, 'user-1', 'persona-1', [
      { file: pngFile('a.png') },
      { file: pngFile('b.png') },
    ]);
    const leftover = (result as { leftoverPaths: { orphanPaths: string[] } }).leftoverPaths;
    expect(leftover.orphanPaths).toHaveLength(2);
    expect(leftover.orphanPaths.every((p) => p.startsWith('user-1/'))).toBe(true);
    expect(leftover.orphanPaths.every((p) => p.startsWith('user-1/persona-1/images/'))).toBe(true);
  });

  it('returns added image paths when the rollback row delete fails', async () => {
    const { addLibraryImages } = await import('../persona-images');
    const { client, removedPaths, uploadedPaths } = rollbackClient({ failInsertOn: 2, failRowDelete: true });
    const result = await addLibraryImages(client, 'user-1', 'persona-1', [
      { file: pngFile('a.png') },
      { file: pngFile('b.png') },
    ]);
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
    expect(result).toMatchObject({ status: 500 });
    const leftover = (result as { leftoverPaths: { orphanPaths: string[]; rowBackedPaths: string[] } }).leftoverPaths;
    expect(leftover.rowBackedPaths).toEqual([uploadedPaths[0]]);
    expect(leftover.orphanPaths).toEqual([uploadedPaths[1]]);
  });

  it('returns 400 when the file bytes cannot be read', async () => {
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
    const bytes = new Uint8Array(1024);
    bytes.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
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
    expect(result).toMatchObject({ status: 400 });
    expect((result as { error: string }).error).toContain('required');
  });
});

describe('validateImageBuffer', () => {
  const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const GIF_MAGIC = Buffer.from('GIF89a........', 'ascii');
  const ZEROS = Buffer.alloc(12);

  it('returns the mime detected from the magic bytes', async () => {
    const { validateImageBuffer } = await import('../persona-images');
    expect(validateImageBuffer(PNG_MAGIC)).toEqual({ mime: 'image/png' });
  });

  it('returns the detected JPEG mime for any byte content that is a JPEG', async () => {
    const { validateImageBuffer } = await import('../persona-images');
    const jpegMagic = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(validateImageBuffer(jpegMagic)).toEqual({ mime: 'image/jpeg' });
  });

  it('rejects recognized-but-not-allowed content (GIF)', async () => {
    const { validateImageBuffer } = await import('../persona-images');
    expect(validateImageBuffer(GIF_MAGIC)).toMatchObject({
      error: expect.stringContaining('Only JPG/JPEG, PNG, or WebP'),
    });
  });

  it('rejects unrecognized content', async () => {
    const { validateImageBuffer } = await import('../persona-images');
    expect(validateImageBuffer(ZEROS)).toMatchObject({
      error: expect.stringContaining('not a recognized image'),
    });
  });
});

describe('supabase/migrations/002_persona-images.sql literals', () => {
  it('keeps the SQL literals in sync with the TypeScript constants', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const sqlPath = join(
      findRepoRoot(import.meta.url),
      'supabase',
      'migrations',
      '002_persona-images.sql',
    );
    const sql = readFileSync(sqlPath, 'utf8');
    const { MAX_PERSONA_IMAGES, PERSONA_IMAGE_LIMIT_SQLSTATE } = await import('../persona-images');
    const { PERSONA_IMAGE_HISTORY_LIMIT } = await import('../persona-image-select');

    const limitMatch = sql.match(/count\(\*\) from public\.persona_images where persona_id = new\.persona_id\) > (\d+)/);
    expect(limitMatch?.[1]).toBe(String(MAX_PERSONA_IMAGES));

    const errcodeMatch = sql.match(/raise exception '[^']+' using errcode = '([A-Z0-9]+)'/);
    expect(errcodeMatch?.[1]).toBe(PERSONA_IMAGE_LIMIT_SQLSTATE);

    const historyMatch = sql.match(/\[1:(\d+)\]/);
    expect(historyMatch?.[1]).toBe(String(PERSONA_IMAGE_HISTORY_LIMIT));

    for (const fn of ['record_persona_image_use', 'set_primary_persona_image']) {
      expect(sql).toContain(`function public.${fn}(`);
      expect(sql).toMatch(
        new RegExp(`function public\\.${fn}\\([^)]*p_user_id uuid`),
      );
    }
    const guardMatches = sql.match(/user_id = coalesce\(p_user_id, auth\.uid\(\)\)/g);
    expect(guardMatches).toHaveLength(2);

    const noRowRaises = sql.match(/if not found then\s+raise exception 'persona % not found for caller'/g);
    expect(noRowRaises).toHaveLength(2);

    expect(sql).toMatch(/pg_constraint where conname = 'fk_persona_images_persona'/);
    expect(sql).toMatch(
      /add constraint fk_persona_images_persona\s+foreign key \(persona_id\) references public\.personas\(id\) on delete cascade/,
    );
  });
});
