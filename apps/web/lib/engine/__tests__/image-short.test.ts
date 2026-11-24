// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { UploadError, ValidationError } from '@/lib/errors';
import { logger } from '@/lib/logger';
import { IMAGE_SHORT_TIMEOUT_MS, isImageForShort, renderImageShort } from '@/lib/engine/image-short';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn() } }));

const image = new File([new Uint8Array([1, 2, 3])], 'image.jpg', { type: 'image/jpeg' });

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('isImageForShort', () => {
  it('accepts JPEG and PNG only', () => {
    expect(isImageForShort(new File([], 'a.jpg', { type: 'image/jpeg' }))).toBe(true);
    expect(isImageForShort(new File([], 'a.png', { type: 'image/png' }))).toBe(true);
    expect(isImageForShort(new File([], 'a.gif', { type: 'image/gif' }))).toBe(false);
    expect(isImageForShort(new File([], 'a.mp4', { type: 'video/mp4' }))).toBe(false);
  });
});

describe('renderImageShort', () => {
  beforeEach(() => {
    vi.stubEnv('MONEYPRINT_API_URL', 'http://engine.test/');
    vi.stubEnv('MONEYPRINT_API_SECRET', 'engine-secret');
    vi.mocked(logger.error).mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('posts the image to the engine with the server secret and returns the MP4', async () => {
    const fetchImpl = vi.fn(async () => new Response(new Uint8Array([9, 9]), { status: 200, headers: { 'content-type': 'video/mp4' } }));

    const video = await renderImageShort(image, 'user-1', fetchImpl);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://engine.test/api/v1/media/image-short');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ Authorization: 'Bearer engine-secret', 'x-user-id': 'user-1' });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const sent = (init.body as FormData).get('file');
    expect(sent).toBeInstanceOf(File);
    expect((sent as File).name).toBe('image.jpg');
    expect(video.type).toBe('video/mp4');
    expect(video.name).toBe('image-short.mp4');
    expect([...new Uint8Array(await video.arrayBuffer())]).toEqual([9, 9]);
    expect(IMAGE_SHORT_TIMEOUT_MS).toBe(180_000);
  });

  it('fails explicitly when the engine URL is not configured', async () => {
    vi.stubEnv('MONEYPRINT_API_URL', undefined);
    const fetchImpl = vi.fn();
    await expect(renderImageShort(image, 'user-1', fetchImpl)).rejects.toThrow('MONEYPRINT_API_URL is not defined');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('maps invalid_image to a ValidationError', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(400, { status: 400, body: { code: 'invalid_image' }, message: 'x' }));
    const failure = renderImageShort(image, 'user-1', fetchImpl);
    await expect(failure).rejects.toBeInstanceOf(ValidationError);
    await expect(renderImageShort(image, 'user-1', fetchImpl)).rejects.toThrow('The image could not be read. Use a JPEG or PNG.');
  });

  it('maps image_too_large to a ValidationError naming the limit', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(413, { status: 413, body: { code: 'image_too_large' } }));
    await expect(renderImageShort(image, 'user-1', fetchImpl)).rejects.toThrow('Image is too large. Maximum is 8 MB.');
  });

  it('maps a render failure to a logged UploadError', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(500, { status: 500, body: { code: 'render_failed' } }));
    await expect(renderImageShort(image, 'user-1', fetchImpl)).rejects.toBeInstanceOf(UploadError);
    expect(logger.error).toHaveBeenCalledWith('[image-short] engine render failed', expect.any(Error), {
      userId: 'user-1',
      metadata: { status: 500, code: 'render_failed' },
    });
  });

  it('maps a non-JSON error body to an UploadError', async () => {
    const fetchImpl = vi.fn(async () => new Response('<html>bad gateway</html>', { status: 502 }));
    await expect(renderImageShort(image, 'user-1', fetchImpl)).rejects.toBeInstanceOf(UploadError);
  });

  it('maps a transport failure to a logged UploadError', async () => {
    const cause = new TypeError('fetch failed');
    const fetchImpl = vi.fn(async () => {
      throw cause;
    });
    await expect(renderImageShort(image, 'user-1', fetchImpl)).rejects.toBeInstanceOf(UploadError);
    expect(logger.error).toHaveBeenCalledWith('[image-short] engine request failed', cause, { userId: 'user-1' });
  });

  it('rejects a 200 that is not a video', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { status: 200 }));
    await expect(renderImageShort(image, 'user-1', fetchImpl)).rejects.toBeInstanceOf(UploadError);
    expect(logger.error).toHaveBeenCalledWith('[image-short] engine answered a non-video body', expect.any(Error), { userId: 'user-1' });
  });
});
