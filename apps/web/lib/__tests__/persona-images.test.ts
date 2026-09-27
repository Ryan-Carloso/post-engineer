// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from 'vitest';

import {
  resolveVideoImage,
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
  const calls = { historyUpdates: [] as Array<{ id: string; recent: string[] }> };
  const client = {
    from: vi.fn((table: string) => {
      if (table === 'persona_images') {
        return terminal({
          data: options.library === undefined ? LIBRARY : options.library,
          error: options.libraryError ?? null,
        });
      }
      return {
        update: vi.fn((values: { recent_image_ids: string[] }) => ({
          eq: vi.fn((_column: string, id: string) => {
            calls.historyUpdates.push({ id, recent: values.recent_image_ids });
            return terminal({ error: options.historyError ?? null });
          }),
        })),
      };
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
    expect(calls.historyUpdates).toHaveLength(0);
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

  it('honors an explicit image_id and records it in the history', async () => {
    const { calls, client } = mockClient();
    const result = await resolveVideoImage(
      client,
      'persona-1',
      ['img-casual'],
      { topic: 'business', imageId: 'img-formal' },
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.image?.id).toBe('img-formal');
    expect(calls.historyUpdates).toEqual([{ id: 'persona-1', recent: ['img-formal', 'img-casual'] }]);
  });

  it('matches tags against the video topic and excludes recent images', async () => {
    const { calls, client } = mockClient();
    const result = await resolveVideoImage(
      client,
      'persona-1',
      ['img-formal'],
      { topic: 'business meeting at the office', niche: 'finance' },
    );
    expect(result.ok).toBe(true);
    // img-formal would win on tags but was used recently: falls to img-casual.
    if (result.ok) expect(result.image?.id).toBe('img-casual');
    expect(calls.historyUpdates[0].recent[0]).toBe('img-casual');
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

  it('still resolves when the history write fails (best-effort)', async () => {
    const { client } = mockClient({ historyError: { message: 'db down' } });
    const result = await resolveVideoImage(client, 'persona-1', [], { topic: 'business' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.image?.id).toBe('img-formal');
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
