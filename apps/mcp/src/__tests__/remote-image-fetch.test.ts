import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MAX_SEGMENT_MEDIA_BYTES } from '../limits.js';
import type { HostLookup } from '../public-fetch.js';
import { fetchRemoteImage } from '../remote-image-fetch.js';

const { httpsRequestMock } = vi.hoisted(() => ({ httpsRequestMock: vi.fn() }));

vi.mock('node:https', () => ({ request: httpsRequestMock }));

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16)]);
const PUBLIC_LOOKUP: HostLookup = async () => [{ address: '93.184.216.34' }];

function arm(chunks: Buffer[], statusCode = 200): void {
  httpsRequestMock.mockImplementation((_url: unknown, _options: unknown, callback: (res: unknown) => void) => {
    const stream = (async function* () {
      for (const chunk of chunks) yield chunk;
    })();
    const response = Object.assign(stream, { statusCode, headers: { 'content-type': 'image/png' }, resume: vi.fn(), destroy: vi.fn() });
    const request = new EventEmitter() as EventEmitter & { end: () => void };
    request.end = () => callback(response);
    return request;
  });
}

beforeEach(() => {
  httpsRequestMock.mockReset();
});

describe('fetchRemoteImage', () => {
  it('downloads a public https PNG and names it from the url path', async () => {
    arm([PNG]);
    const image = await fetchRemoteImage('https://cdn.example.com/photos/Beach%20Day.png', { maxBytes: MAX_SEGMENT_MEDIA_BYTES, lookup: PUBLIC_LOOKUP });
    expect(image.mimeType).toBe('image/png');
    expect(image.filename).toBe('Beach_Day.png');
    expect(image.buffer.equals(PNG)).toBe(true);
  });

  it('keeps a stray percent sign in the url path from failing the download', async () => {
    arm([PNG]);
    const image = await fetchRemoteImage('https://cdn.example.com/photos/100%.png', { maxBytes: MAX_SEGMENT_MEDIA_BYTES, lookup: PUBLIC_LOOKUP });
    expect(image.filename).toBe('100_.png');
  });

  it('derives the extension from the bytes when the url has none', async () => {
    arm([JPEG]);
    const image = await fetchRemoteImage('https://cdn.example.com/download', { maxBytes: MAX_SEGMENT_MEDIA_BYTES, lookup: PUBLIC_LOOKUP });
    expect(image.mimeType).toBe('image/jpeg');
    expect(image.filename).toBe('image.jpg');
  });

  it('rejects http without connecting', async () => {
    await expect(fetchRemoteImage('http://cdn.example.com/a.png', { maxBytes: 1024, lookup: PUBLIC_LOOKUP })).rejects.toThrow('imageUrl must use https');
    expect(httpsRequestMock).not.toHaveBeenCalled();
  });

  it('rejects an unparseable url', async () => {
    await expect(fetchRemoteImage('not a url', { maxBytes: 1024, lookup: PUBLIC_LOOKUP })).rejects.toThrow('imageUrl must be a valid URL');
  });

  it('rejects a host that resolves to a private address without connecting', async () => {
    const lookup: HostLookup = async () => [{ address: '10.0.0.5' }];
    await expect(fetchRemoteImage('https://internal.example/a.png', { maxBytes: 1024, lookup })).rejects.toThrow('imageUrl must point to a public host');
    expect(httpsRequestMock).not.toHaveBeenCalled();
  });

  it('rejects a redirect instead of following it', async () => {
    arm([], 302);
    await expect(fetchRemoteImage('https://cdn.example.com/a.png', { maxBytes: 1024, lookup: PUBLIC_LOOKUP })).rejects.toThrow('Failed to download image: redirect not allowed');
  });

  it('rejects a non-2xx answer', async () => {
    arm([], 404);
    await expect(fetchRemoteImage('https://cdn.example.com/a.png', { maxBytes: 1024, lookup: PUBLIC_LOOKUP })).rejects.toThrow('Failed to download image: HTTP 404');
  });

  it('rejects a body over the cap', async () => {
    arm([Buffer.alloc(2048)]);
    await expect(fetchRemoteImage('https://cdn.example.com/a.png', { maxBytes: 1024, lookup: PUBLIC_LOOKUP })).rejects.toThrow(/Downloaded image exceeds/);
  });

  it('rejects an empty body', async () => {
    arm([]);
    await expect(fetchRemoteImage('https://cdn.example.com/a.png', { maxBytes: 1024, lookup: PUBLIC_LOOKUP })).rejects.toThrow('Downloaded image is empty');
  });

  it('rejects content that is not a JPG, PNG or WebP image whatever the extension says', async () => {
    arm([Buffer.from('<html>not an image at all</html>')]);
    await expect(fetchRemoteImage('https://cdn.example.com/a.png', { maxBytes: 1024, lookup: PUBLIC_LOOKUP })).rejects.toThrow(/JPG, PNG, or WebP/);
  });
});
