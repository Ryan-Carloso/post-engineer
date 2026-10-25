import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/generation/custom-audio', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/generation/custom-audio')>();
  return { ...actual, isPublicIp: () => true };
});

import { downloadPublicImage, REMOTE_FACE_ERROR } from '@/lib/persona-remote-face';
import { MAX_IMAGE_BYTES } from '@/lib/persona-images';

const PNG_BYTES = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);

function listen(
  handler: Parameters<typeof createServer>[0],
): Promise<{ server: Server; url: string }> {
  return new Promise((resolve) => {
    const server = createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, url: `http://127.0.0.1:${port}/face.png` });
    });
  });
}

describe('downloadPublicImage requestPinned', () => {
  let server: Server | undefined;

  afterEach(() => {
    server?.close();
    server = undefined;
  });

  it('downloads a public PNG through requestPinned when fetchImpl is omitted', async () => {
    const started = await listen((_req, res) => {
      res.writeHead(200, { 'content-type': 'image/png' });
      res.end(Buffer.from(PNG_BYTES));
    });
    server = started.server;
    const result = await downloadPublicImage(started.url, {
      lookupImpl: vi.fn(async () => [{ address: '127.0.0.1' }]),
    });
    expect(result).toMatchObject({ mime: 'image/png', extension: 'png' });
  });

  it('returns REMOTE_FACE_ERROR on 302 without following the redirect', async () => {
    const started = await listen((_req, res) => {
      res.writeHead(302, { Location: 'http://evil.example/steal' });
      res.end();
    });
    server = started.server;
    const result = await downloadPublicImage(started.url, {
      lookupImpl: vi.fn(async () => [{ address: '127.0.0.1' }]),
    });
    expect(result).toEqual({ error: REMOTE_FACE_ERROR });
  });

  it('returns REMOTE_FACE_ERROR when the pinned body exceeds the image cap', async () => {
    const started = await listen((_req, res) => {
      res.writeHead(200, { 'content-type': 'image/png' });
      res.end(Buffer.alloc(MAX_IMAGE_BYTES + 1, 1));
    });
    server = started.server;
    const result = await downloadPublicImage(started.url, {
      lookupImpl: vi.fn(async () => [{ address: '127.0.0.1' }]),
    });
    expect(result).toEqual({ error: REMOTE_FACE_ERROR });
  });
});
