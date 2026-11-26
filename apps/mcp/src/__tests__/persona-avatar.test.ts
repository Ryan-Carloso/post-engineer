import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PostEngineerClient } from '../client.js';
import { appendPersonaAvatar } from '../persona-avatar.js';
import { ImageTooLargeError } from '../errors.js';
import { MAX_PERSONA_PHOTO_BYTES } from '../limits.js';
import { CreatePersonaSchema, UpdatePersonaSchema } from '../tools.js';

const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

type FetchMock = ReturnType<typeof vi.fn<typeof fetch>>;

function okFetch(body: unknown = { success: true }): FetchMock {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
    new Response(JSON.stringify(body), { status: 200 }),
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

  it.skipIf(process.platform === 'win32')('createPersona rejects an avatarPath that is not a regular file before any fetch', async () => {
    const fetchMock = okFetch();
    const zero = join(dir, 'zero.jpg');
    symlinkSync('/dev/zero', zero);
    await expect(
      client.createPersona({ accounts: { youtube: ['acct-1'] }, name: 'Ryan', avatarPath: zero }),
    ).rejects.toThrow(`Image "${zero}" is not a regular file.`);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('appendPersonaAvatar rejects a photo over the size limit and an empty photo', async () => {
    const large = join(dir, 'large.jpg');
    await writeFile(large, Buffer.alloc(MAX_PERSONA_PHOTO_BYTES + 1, 0xff));
    await expect(appendPersonaAvatar(new FormData(), { avatarPath: large })).rejects.toBeInstanceOf(ImageTooLargeError);
    const empty = join(dir, 'empty.jpg');
    await writeFile(empty, Buffer.alloc(0));
    await expect(appendPersonaAvatar(new FormData(), { avatarPath: empty })).rejects.toThrow(`Image "${empty}" is empty.`);
  });

  it('appendPersonaAvatar leaves the form untouched without an avatarPath', async () => {
    const form = new FormData();
    await appendPersonaAvatar(form, { avatarPath: null });
    await appendPersonaAvatar(form, {});
    expect([...form.keys()]).toEqual([]);
  });
});

describe('persona avatar schema', () => {
  const base = { name: 'Ryan', accounts: { youtube: ['acct-1'] } };

  it('create accepts avatarPath alone', () => {
    expect(CreatePersonaSchema.safeParse({ ...base, avatarPath: '/tmp/face.jpg' }).success).toBe(true);
  });

  it('create accepts a persona with no photo: the photo is optional', () => {
    expect(CreatePersonaSchema.safeParse(base).success).toBe(true);
  });

  it('create drops a remote avatarUrl instead of forwarding it', () => {
    const parsed = CreatePersonaSchema.safeParse({ ...base, avatarUrl: 'https://example.com/face.png' });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect('avatarUrl' in parsed.data).toBe(false);
  });

  it('update accepts no photo and an avatarPath', () => {
    expect(UpdatePersonaSchema.safeParse({ personaId: 'p-1' }).success).toBe(true);
    expect(UpdatePersonaSchema.safeParse({ personaId: 'p-1', avatarPath: '/tmp/face.jpg' }).success).toBe(true);
  });
});
