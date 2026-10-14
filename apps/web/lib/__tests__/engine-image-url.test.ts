import { describe, it, expect, vi } from 'vitest';
import { ensureEngineImageUrl } from '../engine-image-url';

//---------------
// The engine downloads the persona image over HTTP through an SSRF guard that
// rejects loopback and private addresses. Two shapes arrive from the web:
//
// * an absolute signed Supabase URL (uploaded photo) — passed straight through;
// * a RELATIVE path to our own static asset (`/caracter-samples/file-1.png`,
//   what picking a house character stores) — the engine cannot resolve that,
//   and it is not reachable either: in local dev the web is on 127.0.0.1,
//   which the SSRF guard blocks by design.
//
// The relative case is re-hosted in the personas bucket so the engine gets a
// real, publicly reachable URL in every environment.
//---------------

const ORIGINAL_BLOB = new Uint8Array([137, 80, 78, 71]);

function fakeStorage() {
  const upload = vi.fn().mockResolvedValue({ error: null });
  const createSignedUrl = vi.fn().mockResolvedValue({
    data: { signedUrl: 'https://project.supabase.co/storage/v1/object/sign/personas/x.png?token=T' },
    error: null,
  });
  return {
    storage: { from: vi.fn(() => ({ upload, createSignedUrl })) },
    upload,
    createSignedUrl,
  };
}

describe('ensureEngineImageUrl', () => {
  it('passes an absolute https url straight through, without re-hosting', async () => {
    const { storage, upload } = fakeStorage();
    const url = 'https://project.supabase.co/storage/v1/object/sign/personas/a.png?token=T';

    const result = await ensureEngineImageUrl(url, {
      supabase: { storage } as never,
      userId: 'u-1',
      origin: 'http://localhost:3434',
      fetchImpl: vi.fn(),
    });

    expect(result).toBe(url);
    expect(upload).not.toHaveBeenCalled();
  });

  it('passes a data uri straight through', async () => {
    const { storage, upload } = fakeStorage();
    const url = 'data:image/png;base64,AAAA';

    const result = await ensureEngineImageUrl(url, {
      supabase: { storage } as never,
      userId: 'u-1',
      origin: 'http://localhost:3434',
      fetchImpl: vi.fn(),
    });

    expect(result).toBe(url);
    expect(upload).not.toHaveBeenCalled();
  });

  it('re-hosts a relative static asset and returns a signed url', async () => {
    const { storage, upload, createSignedUrl } = fakeStorage();
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(ORIGINAL_BLOB, { status: 200 }),
    );

    const result = await ensureEngineImageUrl('/caracter-samples/file-1.png', {
      supabase: { storage } as never,
      userId: 'u-1',
      origin: 'http://localhost:3434',
      fetchImpl: fetchImpl as never,
    });

    // The asset is read from our own origin, never from the user.
    expect(fetchImpl).toHaveBeenCalledWith('http://localhost:3434/caracter-samples/file-1.png');
    expect(upload).toHaveBeenCalledTimes(1);
    expect(storage.from).toHaveBeenCalledWith('personas');
    const [objectPath, , options] = upload.mock.calls[0] as [string, ArrayBuffer, { contentType: string }];
    expect(objectPath).toContain('u-1');
    expect(objectPath).toContain('caracter-samples');
    expect(options.contentType).toBe('image/png');
    expect(createSignedUrl).toHaveBeenCalledWith(objectPath, 3600);
    expect(result).toBe('https://project.supabase.co/storage/v1/object/sign/personas/x.png?token=T');
  });

  it('fails loudly when the asset cannot be read', async () => {
    const { storage } = fakeStorage();
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 404 }));

    await expect(
      ensureEngineImageUrl('/caracter-samples/missing.png', {
        supabase: { storage } as never,
        userId: 'u-1',
        origin: 'http://localhost:3434',
        fetchImpl: fetchImpl as never,
      }),
    ).rejects.toThrow(/missing\.png/);
  });

  it('fails loudly when the bucket rejects the upload', async () => {
    const upload = vi.fn().mockResolvedValue({ error: { message: 'bucket full' } });
    const storage = { from: vi.fn(() => ({ upload, createSignedUrl: vi.fn() })) };
    const fetchImpl = vi.fn().mockResolvedValue(new Response(ORIGINAL_BLOB, { status: 200 }));

    await expect(
      ensureEngineImageUrl('/caracter-samples/file-1.png', {
        supabase: { storage } as never,
        userId: 'u-1',
        origin: 'http://localhost:3434',
        fetchImpl: fetchImpl as never,
      }),
    ).rejects.toThrow(/bucket full/);
  });

  it('returns undefined for an absent url without touching storage', async () => {
    const { storage } = fakeStorage();

    const result = await ensureEngineImageUrl(undefined, {
      supabase: { storage } as never,
      userId: 'u-1',
      origin: 'http://localhost:3434',
      fetchImpl: vi.fn(),
    });

    expect(result).toBeUndefined();
  });
});