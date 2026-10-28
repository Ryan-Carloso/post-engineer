import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { handleUploadMedia, handleCheckMedia } from '../tools-user-media.js';
import { MAX_SEGMENT_MEDIA_BYTES } from '../limits.js';
import { MAX_LIBRARY_IMAGE_BYTES } from '../client.js';
import type { PostEngineerClient } from '../client.js';
import type { McpToolResponse } from '../tools-call.js';

function textOf(response: McpToolResponse): string {
  const block = response.content[0];
  if (block === undefined || block.type !== 'text') throw new Error('expected a text content block');
  return block.text;
}

const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPEG_HEADER = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);

let dir: string | undefined;
afterEach(() => {
  if (dir !== undefined) {
    rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  }
});

function tempFile(name: string, content: Buffer): string {
  dir = mkdtempSync(join(tmpdir(), 'pe-user-media-'));
  const path = join(dir, name);
  writeFileSync(path, content);
  return path;
}

function fakeClient(requestImpl: (path: string, init: RequestInit) => Promise<unknown>) {
  return {
    getHeaders: (includeContentType = true) => {
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (includeContentType) headers['Content-Type'] = 'application/json';
      return headers;
    },
    request: vi.fn().mockImplementation((path: string, init: RequestInit) => requestImpl(path, init)),
  } as unknown as PostEngineerClient;
}

describe('upload_media tool', () => {
  it('pins the segment media limit to the engine photo limit, not the library limit', () => {
    expect(MAX_SEGMENT_MEDIA_BYTES).toBe(8 * 1024 * 1024);
    expect(MAX_SEGMENT_MEDIA_BYTES).not.toBe(MAX_LIBRARY_IMAGE_BYTES);
  });

  it('uploads a real image and returns only the mediaId, never the local path', async () => {
    const path = tempFile('porto.png', PNG_HEADER);
    const client = fakeClient(async () => ({ success: true, mediaId: 'aabbccddeeff00112233445566778899.png' }));
    const response = await handleUploadMedia(client, { path });
    expect(response.isError).not.toBe(true);
    expect(textOf(response)).toContain('aabbccddeeff00112233445566778899.png');
    expect(textOf(response)).not.toContain(path);
    expect(textOf(response)).not.toContain(basename(path));
    const init = (client.request as unknown as { mock: { calls: Array<[string, RequestInit]> } }).mock.calls[0]?.[1];
    expect((client.request as unknown as { mock: { calls: Array<[string, RequestInit]> } }).mock.calls[0]?.[0]).toBe('/api/media/upload');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBeInstanceOf(FormData);
  });

  it('validates the real image type, not the extension', async () => {
    // JPEG bytes in a .png file: the content wins, the upload proceeds.
    const path = tempFile('porto.png', JPEG_HEADER);
    const client = fakeClient(async () => ({ success: true, mediaId: 'aabbccddeeff00112233445566778899.jpg' }));
    const response = await handleUploadMedia(client, { path });
    expect(response.isError).not.toBe(true);
    expect(textOf(response)).toContain('aabbccddeeff00112233445566778899.jpg');
  });

  it('rejects a non-image file before any request goes out', async () => {
    const path = tempFile('porto.png', Buffer.from('this is not an image at all'));
    const client = fakeClient(async () => ({ success: true, mediaId: 'x.jpg' }));
    const response = await handleUploadMedia(client, { path });
    expect(response.isError).toBe(true);
    expect(client.request).not.toHaveBeenCalled();
  });

  it('rejects an over-8MB file before and after the read', async () => {
    const padding = Buffer.alloc(8 * 1024 * 1024 + 1 - PNG_HEADER.length, 0);
    const path = tempFile('big.png', Buffer.concat([PNG_HEADER, padding]));
    const client = fakeClient(async () => ({ success: true, mediaId: 'x.jpg' }));
    const response = await handleUploadMedia(client, { path });
    expect(response.isError).toBe(true);
    expect(client.request).not.toHaveBeenCalled();
    expect(textOf(response)).not.toContain(path);
  });

  it('rejects a missing file without leaking the full path', async () => {
    const client = fakeClient(async () => ({ success: true, mediaId: 'x.jpg' }));
    const response = await handleUploadMedia(client, { path: '/tmp/does-not-exist-porto.png' });
    expect(response.isError).toBe(true);
    expect(textOf(response)).not.toContain('/tmp/does-not-exist-porto.png');
  });
});

describe('check_media tool', () => {
  it.each(['ok', 'blocked_403', 'not_image', 'too_small', 'too_large', 'timeout', 'face_detected'])(
    'passes the engine code %s through unchanged',
    async (code) => {
      const client = fakeClient(async (path, init) => {
        expect(path).toBe('/api/media/check');
        expect(init.method).toBe('POST');
        return { success: true, code };
      });
      const response = await handleCheckMedia(client, { url: 'https://e.com/porto.jpg' });
      expect(response.isError).not.toBe(true);
      expect(textOf(response)).toContain(code);
    },
  );

  it('rejects an unknown code instead of passing it through', async () => {
    const client = fakeClient(async () => ({ success: true, code: 'maybe' }));
    const response = await handleCheckMedia(client, { url: 'https://e.com/porto.jpg' });
    expect(response.isError).toBe(true);
  });

  it('rejects a non-http URL before any request goes out', async () => {
    const client = fakeClient(async () => ({ success: true, code: 'ok' }));
    const response = await handleCheckMedia(client, { url: 'ftp://e.com/porto.jpg' });
    expect(response.isError).toBe(true);
    expect(client.request).not.toHaveBeenCalled();
  });

  it('never puts the checked URL in its output', async () => {
    const url = 'https://e.com/porto.jpg?token=secret-value';
    const client = fakeClient(async () => ({ success: true, code: 'ok' }));
    const response = await handleCheckMedia(client, { url });
    expect(textOf(response)).not.toContain('secret-value');
    expect(textOf(response)).not.toContain(url);
  });
});
