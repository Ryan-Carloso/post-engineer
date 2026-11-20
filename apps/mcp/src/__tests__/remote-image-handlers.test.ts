import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { handleAddPersonaImageFromUrl } from '../tools-persona-image-url.js';
import { handleUploadMediaFromUrl } from '../tools-user-media.js';
import type { PostEngineerClient } from '../client.js';

const { httpsRequestMock, lookupMock } = vi.hoisted(() => ({ httpsRequestMock: vi.fn(), lookupMock: vi.fn() }));

vi.mock('node:https', () => ({ request: httpsRequestMock }));
vi.mock('node:dns/promises', () => ({ lookup: lookupMock }));

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]);
const MEDIA_ID = `${'a'.repeat(32)}.png`;
const IMAGE_ROW = { id: 'img-1', tag: 'casual', description: 'smiling', is_primary: true, created_at: '2026-11-20T00:00:00Z' };
const PERSONA = '11111111-1111-4111-8111-111111111111';

function armDownload(): void {
  httpsRequestMock.mockImplementation((_url: unknown, _options: unknown, callback: (res: unknown) => void) => {
    const stream = (async function* () {
      yield PNG;
    })();
    const response = Object.assign(stream, { statusCode: 200, headers: { 'content-type': 'image/png' }, resume: vi.fn(), destroy: vi.fn() });
    const request = new EventEmitter() as EventEmitter & { end: () => void };
    request.end = () => callback(response);
    return request;
  });
}

function fakeClient(body: unknown): { client: PostEngineerClient; requests: Array<{ path: string; init: RequestInit }> } {
  const requests: Array<{ path: string; init: RequestInit }> = [];
  const client = {
    getHeaders: () => ({ Authorization: 'Bearer test' }),
    request: async (path: string, init: RequestInit) => {
      requests.push({ path, init });
      return body;
    },
  } as unknown as PostEngineerClient;
  return { client, requests };
}

beforeEach(() => {
  httpsRequestMock.mockReset();
  lookupMock.mockReset();
  lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
});

describe('handleUploadMediaFromUrl', () => {
  it('downloads the image and posts it to /api/media/upload as a multipart file', async () => {
    armDownload();
    const { client, requests } = fakeClient({ success: true, mediaId: MEDIA_ID, expiresInSeconds: 3600 });
    const result = await handleUploadMediaFromUrl(client, { imageUrl: 'https://cdn.example.com/photos/a.png' });
    expect(result.isError).not.toBe(true);
    expect(requests).toHaveLength(1);
    expect(requests[0].path).toBe('/api/media/upload');
    const form = requests[0].init.body;
    expect(form).toBeInstanceOf(FormData);
    const file = (form as FormData).get('file');
    expect(file).toBeInstanceOf(Blob);
    expect((file as File).name).toBe('a.png');
    expect((file as File).type).toBe('image/png');
    expect(JSON.stringify(result)).toContain(MEDIA_ID);
  });

  it('returns an error and posts nothing when the host resolves to a private address', async () => {
    lookupMock.mockResolvedValue([{ address: '10.0.0.5', family: 4 }]);
    const { client, requests } = fakeClient({});
    const result = await handleUploadMediaFromUrl(client, { imageUrl: 'https://internal.example/a.png' });
    expect(result.isError).toBe(true);
    expect(requests).toEqual([]);
    expect(httpsRequestMock).not.toHaveBeenCalled();
  });
});

describe('handleAddPersonaImageFromUrl', () => {
  it('downloads the image and posts it to /api/persona/images with trimmed metadata and the primary flag', async () => {
    armDownload();
    const { client, requests } = fakeClient({ success: true, image: IMAGE_ROW });
    const result = await handleAddPersonaImageFromUrl(client, {
      personaId: PERSONA,
      imageUrl: 'https://cdn.example.com/photos/a.png',
      tag: '  casual ',
      description: ' smiling ',
      isPrimary: true,
    });
    expect(requests).toHaveLength(1);
    expect(requests[0].path).toBe('/api/persona/images');
    const form = requests[0].init.body as FormData;
    expect(form.get('personaId')).toBe(PERSONA);
    expect(form.get('tag')).toBe('casual');
    expect(form.get('description')).toBe('smiling');
    expect(form.get('isPrimary')).toBe('true');
    expect((form.get('image') as File).name).toBe('a.png');
    expect(result.isError).not.toBe(true);
  });

  it('omits empty metadata and the primary flag', async () => {
    armDownload();
    const { client, requests } = fakeClient({ success: true, image: IMAGE_ROW });
    await handleAddPersonaImageFromUrl(client, { personaId: PERSONA, imageUrl: 'https://cdn.example.com/a.png', tag: '   ' });
    const form = requests[0].init.body as FormData;
    expect(form.has('tag')).toBe(false);
    expect(form.has('description')).toBe(false);
    expect(form.has('isPrimary')).toBe(false);
  });

  it('returns an error and posts nothing when the url is not https', async () => {
    const { client, requests } = fakeClient({});
    const result = await handleAddPersonaImageFromUrl(client, { personaId: PERSONA, imageUrl: 'http://cdn.example.com/a.png' });
    expect(result.isError).toBe(true);
    expect(requests).toEqual([]);
  });
});
