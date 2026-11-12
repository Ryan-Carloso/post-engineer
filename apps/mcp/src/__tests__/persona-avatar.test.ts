import { mkdtempSync, rmSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PostEngineerClient } from '../client.js';
import { appendPersonaAvatar } from '../persona-avatar.js';
import { CreatePersonaSchema, UpdatePersonaSchema } from '../tools.js';

const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

type FetchMock = ReturnType<typeof vi.fn<typeof fetch>>;

// A real Response, as production receives; each test makes one request.
function okFetch(): FetchMock {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
    new Response(JSON.stringify({ success: true }), { status: 200 }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function sentForm(fetchMock: FetchMock): FormData {
  const init: unknown = fetchMock.mock.calls[0]?.[1];
  if (typeof init !== 'object' || init === null || !('body' in init) || !(init.body instanceof FormData)) {
    throw new Error('expected a multipart request');
  }
  return init.body;
}

describe('persona avatar from a local file (avatarPath)', () => {
  let dir: string;
  let photoPath: string;
  let client: PostEngineerClient;

  beforeEach(async () => {
    vi.restoreAllMocks();
    dir = mkdtempSync(join(tmpdir(), 'pe-mcp-avatar-'));
    photoPath = join(dir, 'beige-sweater.jpg');
    await writeFile(photoPath, JPEG_BYTES);
    client = new PostEngineerClient({ apiKey: 'test-token-123' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    rmSync(dir, { recursive: true, force: true });
  });

  it('createPersona uploads avatarPath as the photo file and sends no avatarUrl', async () => {
    const fetchMock = okFetch();
    await client.createPersona({ accounts: { youtube: ['acct-1'] }, name: 'Ryan', voiceId: 'voice-1', avatarPath: photoPath });

    const form = sentForm(fetchMock);
    const photo = form.get('photo');
    expect(photo).toBeInstanceOf(File);
    if (!(photo instanceof File)) throw new Error('photo missing');
    expect(photo.name).toBe('beige-sweater.jpg');
    expect(photo.type).toBe('image/jpeg');
    expect(Buffer.from(await photo.arrayBuffer())).toEqual(JPEG_BYTES);
    expect(form.has('avatarUrl')).toBe(false);
  });

  it('updatePersona uploads avatarPath as the photo file', async () => {
    const fetchMock = okFetch();
    await client.updatePersona({ personaId: 'p-1', avatarPath: photoPath });

    const form = sentForm(fetchMock);
    expect(form.get('photo')).toBeInstanceOf(File);
    expect(form.has('avatarUrl')).toBe(false);
  });

  it('updatePersona sends no face field when neither source is given', async () => {
    const fetchMock = okFetch();
    await client.updatePersona({ personaId: 'p-1', name: 'Renamed' });

    const form = sentForm(fetchMock);
    expect(form.has('photo')).toBe(false);
    expect(form.has('avatarUrl')).toBe(false);
  });

  it.each(['create', 'update'] as const)(
    '%s rejects avatarUrl and avatarPath together before any fetch',
    async (mode) => {
      const fetchMock = okFetch();
        const both = { avatarUrl: 'https://example.com/face.png', avatarPath: photoPath };
      const call =
        mode === 'create'
          ? client.createPersona({ accounts: { youtube: ['acct-1'] }, name: 'Ryan', voiceId: 'voice-1', ...both })
          : client.updatePersona({ personaId: 'p-1', ...both });
      await expect(call).rejects.toThrow('Give either avatarUrl or avatarPath, not both.');
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('createPersona fails with the file path when avatarPath does not exist', async () => {
    const fetchMock = okFetch();
    const missing = join(dir, 'missing.jpg');
    await expect(
      client.createPersona({ accounts: { youtube: ['acct-1'] }, name: 'Ryan', voiceId: 'voice-1', avatarPath: missing }),
    ).rejects.toThrow(`Failed to read image "${missing}"`);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('createPersona rejects an unsupported avatarPath extension before any fetch', async () => {
    const fetchMock = okFetch();
    await expect(
      client.createPersona({ accounts: { youtube: ['acct-1'] }, name: 'Ryan', voiceId: 'voice-1', avatarPath: join(dir, 'face.gif') }),
    ).rejects.toThrow('Unsupported image extension ".gif"');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('appendPersonaAvatar sets avatarUrl as text when only the URL is given', async () => {
    const form = new FormData();
    await appendPersonaAvatar(form, { avatarUrl: 'https://example.com/face.png' }, true);
    expect(form.get('avatarUrl')).toBe('https://example.com/face.png');
    expect(form.has('photo')).toBe(false);
  });
});

describe('persona avatar schema refine', () => {
  const base = { name: 'Ryan', voiceId: 'en-US-AriaNeural', accounts: { youtube: ['acct-1'] } };

  it('create accepts avatarPath alone', () => {
    expect(CreatePersonaSchema.safeParse({ ...base, avatarPath: '/tmp/face.jpg' }).success).toBe(true);
  });

  it('create rejects a persona with no face', () => {
    const parsed = CreatePersonaSchema.safeParse(base);
    expect(parsed.success).toBe(false);
    expect(JSON.stringify(parsed.error?.issues)).toContain('avatarUrl or avatarPath is required');
  });

  it('create rejects both face sources', () => {
    const parsed = CreatePersonaSchema.safeParse({
      accounts: { youtube: ['acct-1'] },
      ...base,
      avatarUrl: 'https://example.com/face.png',
      avatarPath: '/tmp/face.jpg',
    });
    expect(parsed.success).toBe(false);
    expect(JSON.stringify(parsed.error?.issues)).toContain('Give either avatarUrl or avatarPath, not both.');
  });

  it('update accepts no face source and rejects both', () => {
    expect(UpdatePersonaSchema.safeParse({ personaId: 'p-1' }).success).toBe(true);
    expect(
      UpdatePersonaSchema.safeParse({
        personaId: 'p-1',
        avatarUrl: 'https://example.com/face.png',
        avatarPath: '/tmp/face.jpg',
      }).success,
    ).toBe(false);
  });
});
