import { describe, it, expect, vi } from 'vitest';
import { ensureEngineImageUrl, isEngineUsablePersonaImageUrl } from '../engine-image-url';

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

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [source, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(source).toBe('http://localhost:3434/caracter-samples/file-1.png');
    expect(init.redirect).toBe('error');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(storage.from).toHaveBeenCalledWith('personas');
    const [objectPath, , options] = upload.mock.calls[0] as [string, ArrayBuffer, { contentType: string }];
    expect(objectPath).toContain('u-1');
    expect(objectPath).toContain('caracter-samples');
    expect(options.contentType).toBe('image/png');
    expect(createSignedUrl).toHaveBeenCalledWith(objectPath, 24 * 3600);
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

  it.each([
    '//169.254.169.254/latest/meta-data/',
    '//10.0.0.5/admin',
    '/\\169.254.169.254/x',
    '/%2F%2Fhost/x',
    '/caracter-samples/%2F%2Fhost/x',
    '/caracter-samples/../x',
    '/api/persona/images',
  ])('refuses %s before any fetch or upload', async (value) => {
    const { storage, upload } = fakeStorage();
    const fetchImpl = vi.fn().mockResolvedValue(new Response(ORIGINAL_BLOB, { status: 200 }));

    await expect(
      ensureEngineImageUrl(value, {
        supabase: { storage } as never,
        userId: 'u-1',
        origin: 'https://post-engineer.com',
        fetchImpl: fetchImpl as never,
      }),
    ).rejects.toThrow(/not usable by the engine/);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });

  it('does not re-host an asset whose fetch hits a redirect', async () => {
    const { storage, upload } = fakeStorage();
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.redirect === 'error') throw new TypeError('fetch failed: redirect');
      return new Response(ORIGINAL_BLOB, { status: 200 });
    });

    await expect(
      ensureEngineImageUrl('/caracter-samples/file-1.png', {
        supabase: { storage } as never,
        userId: 'u-1',
        origin: 'https://post-engineer.com',
        fetchImpl: fetchImpl as never,
      }),
    ).rejects.toThrow(/redirect/);
    expect(upload).not.toHaveBeenCalled();
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

describe('isEngineUsablePersonaImageUrl', () => {
  it.each([
    '/caracter-samples/file-1.png',
    'data:image/png;base64,iVBORw0KGgo=',
    'https://cdn.example/avatar.png',
    'http://images.example.org/a.jpg?size=large',
    'https://8.8.8.8/avatar.png',
    'http://[2606:4700:4700::1111]/avatar.png',
  ])('accepts %s', (url) => {
    expect(isEngineUsablePersonaImageUrl(url)).toBe(true);
  });

  it.each([
    'characters/ana.png',
    'avatar.png',
    'ftp://cdn.example/avatar.png',
    'file:///etc/passwd',
    'data:image/png;base64',
    'http://127.0.0.1/avatar.png',
    'http://10.0.0.5/avatar.png',
    'https://192.168.1.10/avatar.png',
    'http://169.254.169.254/latest/meta-data',
    'http://[::1]/avatar.png',
    '//169.254.169.254/latest/meta-data/',
    '//10.0.0.5/admin',
    '/\\169.254.169.254/x',
    '/%2F%2Fhost/x',
    '/caracter-samples/../x',
    '/api/persona/images',
    'not-a-url',
    '',
  ])('rejects %s', (url) => {
    expect(isEngineUsablePersonaImageUrl(url)).toBe(false);
  });
});