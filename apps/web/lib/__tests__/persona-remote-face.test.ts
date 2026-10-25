import { describe, expect, it, vi } from 'vitest';

import {
  downloadPublicImage,
  ingestRemotePersonaFaces,
  isKeptAvatarUrl,
  isRemoteAvatarUrl,
  resolvePersonaAvatar,
  REMOTE_FACE_ERROR,
} from '@/lib/persona-remote-face';

const PNG_BYTES = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);

function publicLookup() {
  return vi.fn(async () => [{ address: '1.2.3.4' }]);
}

function pngResponse(): Response {
  return new Response(PNG_BYTES, { status: 200, headers: { 'content-type': 'image/png' } });
}

function mockSupabase(opts: {
  rows?: Array<Record<string, unknown>>;
  updates?: Array<Record<string, unknown>>;
  uploaded?: Array<{ path: string }>;
}) {
  const updates = opts.updates ?? [];
  const uploaded = opts.uploaded ?? [];
  return {
    from: vi.fn(() => ({
      select: vi.fn(() => Promise.resolve({ data: opts.rows ?? [], error: null })),
      update: vi.fn((values: Record<string, unknown>) => {
        updates.push(values);
        return {
          eq: vi.fn(() => ({
            eq: vi.fn(async () => ({ error: null })),
          })),
        };
      }),
    })),
    storage: {
      from: vi.fn(() => ({
        upload: vi.fn(async (path: string) => {
          uploaded.push({ path });
          return { data: { path }, error: null };
        }),
      })),
    },
  };
}

describe('persona-remote-face classify', () => {
  it('keeps caracter-samples and data:image without downloading', () => {
    expect(isKeptAvatarUrl('/caracter-samples/file-3.png')).toBe(true);
    expect(isKeptAvatarUrl('https://post-engineer.com/caracter-samples/file-3.png')).toBe(true);
    expect(isKeptAvatarUrl('data:image/png;base64,IA')).toBe(true);
    expect(isRemoteAvatarUrl('https://cdn.example/face.png')).toBe(true);
    expect(isRemoteAvatarUrl('/caracter-samples/file-3.png')).toBe(false);
  });
});

describe('downloadPublicImage', () => {
  it('refuses a private IP without fetching', async () => {
    const fetchImpl = vi.fn();
    const result = await downloadPublicImage('http://127.0.0.1/secret.png', {
      fetchImpl: fetchImpl as never,
      lookupImpl: vi.fn(async () => [{ address: '127.0.0.1' }]),
    });
    expect(result).toEqual({ error: REMOTE_FACE_ERROR });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('refuses redirects', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('redirect');
    });
    const result = await downloadPublicImage('https://cdn.example/face.png', {
      fetchImpl: fetchImpl as never,
      lookupImpl: publicLookup(),
    });
    expect(result).toEqual({ error: REMOTE_FACE_ERROR });
  });

  it('refuses 404 text/plain without treating it as an image', async () => {
    const fetchImpl = vi.fn(
      async () => new Response('not found', { status: 404, headers: { 'content-type': 'text/plain' } }),
    );
    const result = await downloadPublicImage('https://cdn.example/missing.png', {
      fetchImpl: fetchImpl as never,
      lookupImpl: publicLookup(),
    });
    expect(result).toEqual({ error: REMOTE_FACE_ERROR });
  });

  it('refuses bad magic bytes', async () => {
    const fetchImpl = vi.fn(
      async () => new Response('GIF89a-not-allowed', { status: 200, headers: { 'content-type': 'image/gif' } }),
    );
    const result = await downloadPublicImage('https://cdn.example/face.gif', {
      fetchImpl: fetchImpl as never,
      lookupImpl: publicLookup(),
    });
    expect(result).toEqual({ error: REMOTE_FACE_ERROR });
  });
});

describe('resolvePersonaAvatar', () => {
  it('https PNG stores a path and returns avatar null', async () => {
    const uploaded: Array<{ path: string }> = [];
    const supabase = mockSupabase({ uploaded });
    const result = await resolvePersonaAvatar(
      supabase as never,
      'user-1',
      'persona-1',
      'https://cdn.example/face.png',
      { fetchImpl: vi.fn(async () => pngResponse()) as never, lookupImpl: publicLookup() },
    );
    expect(result).toEqual({
      ok: true,
      photoPath: 'user-1/persona-1/photo.png',
      avatarUrl: null,
    });
    expect(uploaded).toEqual([{ path: 'user-1/persona-1/photo.png' }]);
  });

  it('does not download caracter-samples or data:image', async () => {
    const fetchImpl = vi.fn();
    const supabase = mockSupabase({});
    await resolvePersonaAvatar(supabase as never, 'u', 'p', '/caracter-samples/file-3.png', {
      fetchImpl: fetchImpl as never,
    });
    await resolvePersonaAvatar(supabase as never, 'u', 'p', 'data:image/png;base64,IA', {
      fetchImpl: fetchImpl as never,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(supabase.storage.from).not.toHaveBeenCalled();
  });
});

describe('ingestRemotePersonaFaces', () => {
  it('migrates 200 images, leaves 404 rows, skips samples and existing photo_path', async () => {
    const updates: Array<Record<string, unknown>> = [];
    const uploaded: Array<{ path: string }> = [];
    const rows = [
      { id: 'ok', user_id: 'u1', avatar_url: 'https://cdn.example/ok.png', photo_path: null },
      { id: 'gone', user_id: 'u1', avatar_url: 'https://muse.ai/missing.jpg', photo_path: null },
      { id: 'sample', user_id: 'u1', avatar_url: '/caracter-samples/file-3.png', photo_path: null },
      { id: 'has-photo', user_id: 'u1', avatar_url: 'https://cdn.example/other.png', photo_path: 'u1/has-photo/photo.png' },
    ];
    const supabase = mockSupabase({ rows, updates, uploaded });
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).includes('missing')) {
        return new Response('gone', { status: 404, headers: { 'content-type': 'text/plain' } });
      }
      return pngResponse();
    });
    const result = await ingestRemotePersonaFaces(supabase as never, {
      fetchImpl: fetchImpl as never,
      lookupImpl: publicLookup(),
    });
    expect(result).toEqual({ migrated: 1, skipped: 2, failed: 1 });
    expect(updates).toEqual([{ photo_path: 'u1/ok/photo.png', avatar_url: null }]);
    expect(uploaded).toEqual([{ path: 'u1/ok/photo.png' }]);
  });
});
