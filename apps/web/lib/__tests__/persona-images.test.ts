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
  historyError?: { message: string } | null;
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
    const result = await resolveVideoImage(client, 'persona-1', [], { topic: 'business' });
    expect(result).toEqual({ ok: true, image: null });
    expect(calls.rpcCalls).toHaveLength(0);
  });

  it('returns 404 for an image_id outside the library', async () => {
    const { client } = mockClient();
    const result = await resolveVideoImage(client, 'persona-1', [], { imageId: 'nope' });
    expect(result).toEqual({
      ok: false,
      error: "image_id not found in this persona's image library.",
      status: 404,
    });
  });

  it('honors an explicit image_id without touching the rotation history', async () => {
    const { calls, client } = mockClient();
    const result = await resolveVideoImage(
      client,
      'persona-1',
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
    const result = await resolveVideoImage(client, 'persona-1', [], { imageId: 'nope' });
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
      ['img-formal'],
      { topic: 'business meeting at the office', niche: 'finance' },
    );
    expect(result.ok).toBe(true);
    // img-formal would win on tags but was used recently: falls to img-casual.
    if (result.ok) expect(result.image?.id).toBe('img-casual');
  });

  it('returns 500 when the library cannot be loaded', async () => {
    const { client } = mockClient({ libraryError: { message: 'db down' } });
    const result = await resolveVideoImage(client, 'persona-1', [], {});
    expect(result).toEqual({
      ok: false,
      error: 'Failed to load persona image library.',
      status: 500,
    });
  });

  it('never touches the rotation history (the caller records after the gate)', async () => {
    const { calls, client } = mockClient();
    const result = await resolveVideoImage(client, 'persona-1', [], { topic: 'business' });
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
    expect(result).toEqual({ error: 'Failed to update image.' });
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
      error: expect.stringContaining('JPG, PNG, or WebP'),
    });
  });
});
