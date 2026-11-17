// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/upload/publish-media', () => ({
  uploadPublishMedia: vi.fn(async () => 'https://s.example/stored'),
  presignPublishMedia: vi.fn(async () => 'https://s.example/archive.mp4'),
}));

import { presignPublishMedia, uploadPublishMedia } from '@/lib/upload/publish-media';
import { MAX_IMAGE_UPLOAD_BYTES, sniffPublishMedia, stagePublishMedia } from '@/lib/upload/publish-media-file';

const MP4 = Buffer.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);

function stage(rawFile: FormDataEntryValue | null, storagePathRaw: FormDataEntryValue | null = null) {
  return stagePublishMedia({
    provider: 'threads',
    label: 'Threads',
    rawFile,
    storagePathRaw,
    ownerUserId: 'user-1',
    maxVideoBytes: 1024,
    maxVideoLabel: '1KB',
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('sniffPublishMedia', () => {
  it('reads an MP4, keeps a declared MOV, and ignores the declared type for images', () => {
    expect(sniffPublishMedia(MP4, 'video/mp4')).toMatchObject({ kind: 'video', contentType: 'video/mp4', extension: 'mp4' });
    expect(sniffPublishMedia(MP4, 'video/quicktime')).toMatchObject({ kind: 'video', contentType: 'video/quicktime', extension: 'mov' });
    expect(sniffPublishMedia(JPEG, 'video/mp4')).toMatchObject({ kind: 'image', contentType: 'image/jpeg', extension: 'jpg' });
    expect(sniffPublishMedia(PNG, 'image/jpeg')).toMatchObject({ kind: 'image', contentType: 'image/png', extension: 'png' });
  });

  it('returns null for anything else, including truncated signatures', () => {
    expect(sniffPublishMedia(Buffer.from('not media at all'), 'video/mp4')).toBeNull();
    expect(sniffPublishMedia(Buffer.from([0xff, 0xd8]), 'image/jpeg')).toBeNull();
    expect(sniffPublishMedia(PNG.subarray(0, 7), 'image/png')).toBeNull();
    expect(sniffPublishMedia(Buffer.alloc(0), 'video/mp4')).toBeNull();
  });
});

describe('stagePublishMedia', () => {
  it('stores an image under the provider prefix with its sniffed type', async () => {
    const staged = await stage(new File([JPEG], 'x.bin'));
    expect(staged).toEqual({ ok: true, kind: 'image', url: 'https://s.example/stored', usedArchive: false });
    const [, key, type] = vi.mocked(uploadPublishMedia).mock.calls[0] ?? [];
    expect(String(key).startsWith('threads/')).toBe(true);
    expect(String(key).endsWith('.jpg')).toBe(true);
    expect(type).toBe('image/jpeg');
  });

  it('presigns the owner archive without storing a copy', async () => {
    const staged = await stage(null, 'user-1/faceless/t/final-1.mp4');
    expect(staged).toEqual({ ok: true, kind: 'video', url: 'https://s.example/archive.mp4', usedArchive: true });
    expect(presignPublishMedia).toHaveBeenCalledWith('user-1/faceless/t/final-1.mp4');
    expect(uploadPublishMedia).not.toHaveBeenCalled();
  });

  it.each([
    ['no file', null, null, 'A video or image file is required'],
    ['a blank archive key', null, '  ', 'videoStoragePath must be a string'],
    ['both a file and a key', new File([MP4], 'v.mp4'), 'user-1/a/b/final-1.mp4', 'either a file or videoStoragePath'],
    ['a foreign archive key', null, 'user-2/a/b/final-1.mp4', 'must belong to this user'],
    ['a video over the cap', new File([Buffer.alloc(2048)], 'v.mp4'), null, 'Video exceeds the Threads 1KB limit'],
    ['unknown bytes', new File([Buffer.from('hello world!')], 'v.mp4'), null, 'MP4 or MOV video, or a JPEG or PNG image'],
  ])('rejects %s without storing anything', async (_name, file, key, message) => {
    const staged = await stage(file, key);
    expect(staged.ok).toBe(false);
    if (!staged.ok) expect(staged.error).toContain(message);
    expect(uploadPublishMedia).not.toHaveBeenCalled();
    expect(presignPublishMedia).not.toHaveBeenCalled();
  });

  it('rejects an image over 8 MB even when the video cap is larger', async () => {
    const big = Buffer.alloc(MAX_IMAGE_UPLOAD_BYTES + 1);
    JPEG.copy(big);
    const staged = await stagePublishMedia({
      provider: 'facebook', label: 'Facebook', rawFile: new File([big], 'big.jpg'), storagePathRaw: null,
      ownerUserId: 'user-1', maxVideoBytes: 1024 * 1024 * 1024, maxVideoLabel: '1GB',
    });
    expect(staged).toEqual({ ok: false, error: 'Image exceeds the 8 MB limit' });
    expect(uploadPublishMedia).not.toHaveBeenCalled();
  });
});
