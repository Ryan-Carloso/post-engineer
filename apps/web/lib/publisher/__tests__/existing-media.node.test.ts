import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { logger } from '@/lib/logger';
import {
  claimedUploadCleanup,
  cleanupExistingMedia,
  expiredSlotCleanup,
  imageCleanup,
  resolveExistingMedia,
} from '@/lib/publisher/existing-media';
import { StorageNotFoundError } from '@/lib/publisher/store-types';
import { NOW, SLOT_ID, UPLOAD_ID, USER_ID, makeSlot, makeStore, readyUpload } from './helpers';

const IMAGE_REF = `scheduled-media/${USER_ID}/photo.png`;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('imageCleanup', () => {
  it('accepts only the slot own scheduled-media prefix', () => {
    expect(imageCleanup(makeSlot({ mediaKind: 'image', mediaRef: IMAGE_REF }))).toEqual({ bucket: 'uploads', path: IMAGE_REF });
    expect(imageCleanup(makeSlot({ mediaKind: 'image', mediaRef: 'scheduled-media/other/photo.png' }))).toBeNull();
    expect(imageCleanup(makeSlot({ mediaKind: 'image', mediaRef: `scheduled-media/${USER_ID}/../x.png` }))).toBeNull();
    expect(imageCleanup(makeSlot({ mediaKind: 'image', mediaRef: `scheduled-media/${USER_ID}//x.png` }))).toBeNull();
    expect(imageCleanup(makeSlot({ mediaKind: 'image', mediaRef: null }))).toBeNull();
    expect(imageCleanup(makeSlot({ mediaKind: 'image', mediaRef: IMAGE_REF, userId: null }))).toBeNull();
    expect(imageCleanup(makeSlot({ mediaKind: 'upload', mediaRef: IMAGE_REF }))).toBeNull();
  });
});

describe('claimedUploadCleanup', () => {
  const claimedAt = '2026-11-27T11:00:00+00:00';

  it('returns the bytes the slot own claim holds, comparing instants', async () => {
    const store = makeStore({
      getVideoUpload: vi.fn(async () => readyUpload({ status: 'consumed', consumed_at: '2026-11-27T11:00:00.000Z' })),
    });
    const slot = makeSlot({ mediaClaimedAt: claimedAt });
    expect(await claimedUploadCleanup(store, slot, true)).toEqual({ bucket: 'videos', path: `${USER_ID}/${UPLOAD_ID}.mp4` });
  });

  it('returns null on a first attempt, for an unclaimed row, a foreign claim or a missing path', async () => {
    const consumed = readyUpload({ status: 'consumed', consumed_at: '2026-11-27T11:00:00.000Z' });
    const slot = makeSlot({ mediaClaimedAt: claimedAt });
    expect(await claimedUploadCleanup(makeStore(), slot, false)).toBeNull();
    expect(await claimedUploadCleanup(makeStore({ getVideoUpload: vi.fn(async () => readyUpload()) }), slot, true)).toBeNull();
    expect(
      await claimedUploadCleanup(makeStore({ getVideoUpload: vi.fn(async () => ({ ...consumed, consumed_at: '2026-11-27T10:00:00.000Z' })) }), slot, true),
    ).toBeNull();
    expect(await claimedUploadCleanup(makeStore({ getVideoUpload: vi.fn(async () => ({ ...consumed, storage_path: null })) }), slot, true)).toBeNull();
    expect(await claimedUploadCleanup(makeStore({ getVideoUpload: vi.fn(async () => null) }), slot, true)).toBeNull();
    expect(await claimedUploadCleanup(makeStore({ getVideoUpload: vi.fn(async () => consumed) }), makeSlot({ mediaClaimedAt: null }), true)).toBeNull();
  });

  it('returns null and logs when the store read fails', async () => {
    const store = makeStore({
      getVideoUpload: vi.fn(async () => {
        throw new Error('db down');
      }),
    });
    expect(await claimedUploadCleanup(store, makeSlot(), true)).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith('[publisher] claimed-upload lookup failed, leaving the bytes in place', {
      slotId: SLOT_ID,
      reason: 'db down',
    });
  });
});

describe('expiredSlotCleanup', () => {
  const expired = { id: SLOT_ID, userId: USER_ID, mediaKind: 'upload', mediaRef: UPLOAD_ID };

  it('cleans an image from the uploads bucket', async () => {
    expect(await expiredSlotCleanup(makeStore(), { ...expired, mediaKind: 'image', mediaRef: IMAGE_REF })).toEqual({
      bucket: 'uploads',
      path: IMAGE_REF,
    });
  });

  it('cleans the upload owned by the slot owner', async () => {
    expect(await expiredSlotCleanup(makeStore(), expired)).toEqual({ bucket: 'videos', path: `${USER_ID}/${UPLOAD_ID}.mp4` });
  });

  it('keeps an upload owned by another user, one without a path or without a media ref', async () => {
    expect(await expiredSlotCleanup(makeStore({ getVideoUpload: vi.fn(async () => readyUpload({ user_id: 'other' })) }), expired)).toBeNull();
    expect(await expiredSlotCleanup(makeStore({ getVideoUpload: vi.fn(async () => readyUpload({ storage_path: null })) }), expired)).toBeNull();
    expect(await expiredSlotCleanup(makeStore({ getVideoUpload: vi.fn(async () => null) }), expired)).toBeNull();
    expect(await expiredSlotCleanup(makeStore(), { ...expired, mediaRef: null })).toBeNull();
    expect(await expiredSlotCleanup(makeStore(), { ...expired, mediaKind: null })).toBeNull();
  });

  it('survives an upload lookup failure without cleanup', async () => {
    const store = makeStore({
      getVideoUpload: vi.fn(async () => {
        throw new Error('db down');
      }),
    });
    expect(await expiredSlotCleanup(store, expired)).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith('[publisher] expired slot upload lookup failed', { slotId: SLOT_ID, reason: 'db down' });
  });
});

describe('cleanupExistingMedia', () => {
  it('removes the object, does nothing without a cleanup and warns when removal fails', async () => {
    const store = makeStore();
    await cleanupExistingMedia(store, SLOT_ID, null);
    expect(store.removeStorageObject).not.toHaveBeenCalled();
    await cleanupExistingMedia(store, SLOT_ID, { bucket: 'videos', path: 'a/b.mp4' });
    expect(store.removeStorageObject).toHaveBeenCalledWith('videos', 'a/b.mp4');
    expect(logger.warn).not.toHaveBeenCalled();

    const failing = makeStore({ removeStorageObject: vi.fn(async () => false) });
    await cleanupExistingMedia(failing, SLOT_ID, { bucket: 'videos', path: 'a/b.mp4' });
    expect(logger.warn).toHaveBeenCalledWith('[publisher] stored media could not be removed', { slotId: SLOT_ID, bucket: 'videos' });
  });
});

describe('resolveExistingMedia', () => {
  const fail = vi.fn(async () => undefined);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('downloads the upload before claiming it, then names the file after the upload id and its type', async () => {
    const order: string[] = [];
    const store = makeStore({
      downloadStorageObject: vi.fn(async () => {
        order.push('download');
        return new Uint8Array([1]);
      }),
      claimVideoUpload: vi.fn(async (_id: string, now: Date) => {
        order.push('claim');
        return readyUpload({ status: 'consumed', consumed_at: now.toISOString() });
      }),
    });
    const resolved = await resolveExistingMedia(store, fail, makeSlot(), NOW, false);
    expect(order).toEqual(['download', 'claim']);
    expect(resolved?.media).toMatchObject({ name: `${UPLOAD_ID}.mp4`, contentType: 'video/mp4' });
    expect(resolved?.cleanup).toEqual({ bucket: 'videos', path: `${USER_ID}/${UPLOAD_ID}.mp4` });
    expect(store.downloadStorageObject).toHaveBeenCalledWith('videos', `${USER_ID}/${UPLOAD_ID}.mp4`);
    expect(store.updateSlot).toHaveBeenCalledWith(SLOT_ID, { media_claimed_at: NOW.toISOString() });
    expect(fail).not.toHaveBeenCalled();
  });

  it.each([
    ['video/quicktime', 'mov'],
    ['image/jpeg', 'jpg'],
    ['image/png', 'png'],
    ['application/octet-stream', 'mp4'],
  ])('maps the %s upload to the .%s extension', async (type, extension) => {
    const store = makeStore({ getVideoUpload: vi.fn(async () => readyUpload({ declared_content_type: type })) });
    const resolved = await resolveExistingMedia(store, fail, makeSlot(), NOW, false);
    expect(resolved?.media.name).toBe(`${UPLOAD_ID}.${extension}`);
  });

  it('falls back to the detected type and then to video/mp4', async () => {
    const detected = makeStore({
      getVideoUpload: vi.fn(async () => readyUpload({ declared_content_type: null, detected_content_type: 'video/quicktime' })),
    });
    expect((await resolveExistingMedia(detected, fail, makeSlot(), NOW, false))?.media.contentType).toBe('video/quicktime');
    const none = makeStore({
      getVideoUpload: vi.fn(async () => readyUpload({ declared_content_type: null, detected_content_type: null })),
    });
    expect((await resolveExistingMedia(none, fail, makeSlot(), NOW, false))?.media.contentType).toBe('video/mp4');
  });

  it('fails permanently without a download when the upload id is missing', async () => {
    const store = makeStore();
    expect(await resolveExistingMedia(store, fail, makeSlot({ mediaRef: null }), NOW, false)).toBeNull();
    expect(fail).toHaveBeenCalledWith('scheduled video upload id is missing');
    expect(store.getVideoUpload).not.toHaveBeenCalled();
  });

  it('fails permanently for a missing row and for a row of another user', async () => {
    expect(await resolveExistingMedia(makeStore({ getVideoUpload: vi.fn(async () => null) }), fail, makeSlot(), NOW, false)).toBeNull();
    expect(fail).toHaveBeenLastCalledWith('scheduled video upload not found');
    expect(
      await resolveExistingMedia(makeStore({ getVideoUpload: vi.fn(async () => readyUpload({ user_id: 'other' })) }), fail, makeSlot(), NOW, false),
    ).toBeNull();
    expect(fail).toHaveBeenLastCalledWith('scheduled video upload not found');
  });

  it('fails permanently for a consumed row on a first attempt and for a foreign claim on a resume', async () => {
    const consumed = readyUpload({ status: 'consumed', consumed_at: '2026-11-27T11:00:00.000Z' });
    const store = makeStore({ getVideoUpload: vi.fn(async () => consumed) });
    expect(await resolveExistingMedia(store, fail, makeSlot(), NOW, false)).toBeNull();
    expect(fail).toHaveBeenLastCalledWith('scheduled video upload is no longer ready');
    expect(await resolveExistingMedia(store, fail, makeSlot({ mediaClaimedAt: '2026-11-27T10:00:00.000Z' }), NOW, true)).toBeNull();
    expect(fail).toHaveBeenLastCalledWith('scheduled video upload is no longer ready');
    expect(await resolveExistingMedia(store, fail, makeSlot({ mediaClaimedAt: null }), NOW, true)).toBeNull();
    expect(store.downloadStorageObject).not.toHaveBeenCalled();
  });

  it('trusts a consumed row on a resume when the claim is the slot own, without claiming again', async () => {
    const consumed = readyUpload({ status: 'consumed', consumed_at: '2026-11-27T11:00:00.000Z' });
    const store = makeStore({ getVideoUpload: vi.fn(async () => consumed) });
    const resolved = await resolveExistingMedia(store, fail, makeSlot({ mediaClaimedAt: '2026-11-27T11:00:00+00:00' }), NOW, true);
    expect(resolved?.media.name).toBe(`${UPLOAD_ID}.mp4`);
    expect(store.claimVideoUpload).not.toHaveBeenCalled();
    expect(store.updateSlot).not.toHaveBeenCalled();
  });

  it('fails permanently when the row has no stored file', async () => {
    const store = makeStore({ getVideoUpload: vi.fn(async () => readyUpload({ storage_path: null })) });
    expect(await resolveExistingMedia(store, fail, makeSlot(), NOW, false)).toBeNull();
    expect(fail).toHaveBeenCalledWith('scheduled video upload has no stored file');
    expect(store.downloadStorageObject).not.toHaveBeenCalled();
  });

  it('fails permanently when the object is gone and defers on any other download error, never claiming', async () => {
    const gone = makeStore({
      downloadStorageObject: vi.fn(async () => {
        throw new StorageNotFoundError('videos');
      }),
    });
    expect(await resolveExistingMedia(gone, fail, makeSlot(), NOW, false)).toBeNull();
    expect(fail).toHaveBeenLastCalledWith('scheduled upload file is gone');
    expect(gone.claimVideoUpload).not.toHaveBeenCalled();

    fail.mockClear();
    const flaky = makeStore({
      downloadStorageObject: vi.fn(async () => {
        throw new Error('storage 503 token=abc');
      }),
    });
    expect(await resolveExistingMedia(flaky, fail, makeSlot(), NOW, false)).toBeNull();
    expect(fail).not.toHaveBeenCalled();
    expect(flaky.claimVideoUpload).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith('[publisher] scheduled upload download failed, retrying later', {
      slotId: SLOT_ID,
      reason: 'storage 503 token=[redacted]',
    });
  });

  it('fails permanently when the claim is lost', async () => {
    const store = makeStore({ claimVideoUpload: vi.fn(async () => null) });
    expect(await resolveExistingMedia(store, fail, makeSlot(), NOW, false)).toBeNull();
    expect(fail).toHaveBeenCalledWith('scheduled video upload was already used');
  });

  it('removes the claimed bytes and rethrows when stamping the claim fails', async () => {
    const getVideoUpload = vi
      .fn()
      .mockResolvedValueOnce(readyUpload())
      .mockResolvedValue(readyUpload({ status: 'consumed', consumed_at: NOW.toISOString() }));
    const store = makeStore({
      getVideoUpload,
      updateSlot: vi.fn(async (_slotId: string, fields: Record<string, unknown>) => {
        if ('media_claimed_at' in fields) throw new Error('db down');
      }),
    });
    await expect(resolveExistingMedia(store, fail, makeSlot(), NOW, false)).rejects.toThrow('db down');
    expect(store.getSlotMediaClaimedAt).toHaveBeenCalledWith(SLOT_ID);
    expect(store.removeStorageObject).toHaveBeenCalledWith('videos', `${USER_ID}/${UPLOAD_ID}.mp4`);
    expect(fail).not.toHaveBeenCalled();
  });

  it('keeps the bytes and rethrows when stamping the claim fails after the stamp committed', async () => {
    const getVideoUpload = vi
      .fn()
      .mockResolvedValueOnce(readyUpload())
      .mockResolvedValue(readyUpload({ status: 'consumed', consumed_at: NOW.toISOString() }));
    const store = makeStore({
      getVideoUpload,
      getSlotMediaClaimedAt: vi.fn(async () => NOW.toISOString()),
      updateSlot: vi.fn(async (_slotId: string, fields: Record<string, unknown>) => {
        if ('media_claimed_at' in fields) throw new Error('db down');
      }),
    });
    await expect(resolveExistingMedia(store, fail, makeSlot(), NOW, false)).rejects.toThrow('db down');
    expect(store.removeStorageObject).not.toHaveBeenCalled();
    expect(fail).not.toHaveBeenCalled();
  });

  it('keeps the bytes and reports the original error when the stamp lookup fails too', async () => {
    const store = makeStore({
      getSlotMediaClaimedAt: vi.fn(async () => {
        throw new Error('lookup down');
      }),
      updateSlot: vi.fn(async (_slotId: string, fields: Record<string, unknown>) => {
        if ('media_claimed_at' in fields) throw new Error('db down');
      }),
    });
    await expect(resolveExistingMedia(store, fail, makeSlot(), NOW, false)).rejects.toThrow('db down');
    expect(store.removeStorageObject).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith('[publisher] claim-stamp lookup failed after a stamp error, leaving the bytes in place', {
      slotId: SLOT_ID,
      reason: 'lookup down',
    });
  });

  it('removes the claimed bytes and rethrows when the claim itself fails after committing', async () => {
    const getVideoUpload = vi
      .fn()
      .mockResolvedValueOnce(readyUpload())
      .mockResolvedValue(readyUpload({ status: 'consumed', consumed_at: NOW.toISOString() }));
    const store = makeStore({
      getVideoUpload,
      claimVideoUpload: vi.fn(async () => {
        throw new Error('db down');
      }),
    });
    await expect(resolveExistingMedia(store, fail, makeSlot(), NOW, false)).rejects.toThrow('db down');
    expect(store.removeStorageObject).toHaveBeenCalledWith('videos', `${USER_ID}/${UPLOAD_ID}.mp4`);
    expect(fail).not.toHaveBeenCalled();
  });

  it('leaves the bytes alone when the claim fails before committing', async () => {
    const store = makeStore({
      claimVideoUpload: vi.fn(async () => {
        throw new Error('db down');
      }),
    });
    await expect(resolveExistingMedia(store, fail, makeSlot(), NOW, false)).rejects.toThrow('db down');
    expect(store.removeStorageObject).not.toHaveBeenCalled();
    expect(fail).not.toHaveBeenCalled();
  });

  it('leaves the bytes alone when the re-read shows a claim from another consumer', async () => {
    const getVideoUpload = vi
      .fn()
      .mockResolvedValueOnce(readyUpload())
      .mockResolvedValue(readyUpload({ status: 'consumed', consumed_at: '2026-11-27T11:00:00.000Z' }));
    const store = makeStore({
      getVideoUpload,
      claimVideoUpload: vi.fn(async () => {
        throw new Error('db down');
      }),
    });
    await expect(resolveExistingMedia(store, fail, makeSlot(), NOW, false)).rejects.toThrow('db down');
    expect(store.removeStorageObject).not.toHaveBeenCalled();
    expect(fail).not.toHaveBeenCalled();
  });

  it('leaves the bytes alone and reports the original error when the re-read after a claim failure fails too', async () => {
    const getVideoUpload = vi.fn().mockResolvedValueOnce(readyUpload()).mockRejectedValue(new Error('lookup down'));
    const store = makeStore({
      getVideoUpload,
      claimVideoUpload: vi.fn(async () => {
        throw new Error('db down');
      }),
    });
    await expect(resolveExistingMedia(store, fail, makeSlot(), NOW, false)).rejects.toThrow('db down');
    expect(store.removeStorageObject).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith('[publisher] claimed-upload lookup failed after a claim error, leaving the bytes in place', {
      slotId: SLOT_ID,
      reason: 'lookup down',
    });
  });

  it('still reports the original error when removing the claimed bytes fails too', async () => {
    const getVideoUpload = vi
      .fn()
      .mockResolvedValueOnce(readyUpload())
      .mockResolvedValue(readyUpload({ status: 'consumed', consumed_at: NOW.toISOString() }));
    const store = makeStore({
      getVideoUpload,
      updateSlot: vi.fn(async (_slotId: string, fields: Record<string, unknown>) => {
        if ('media_claimed_at' in fields) throw new Error('db down');
      }),
      removeStorageObject: vi.fn(async () => {
        throw new Error('bucket down');
      }),
    });
    await expect(resolveExistingMedia(store, fail, makeSlot(), NOW, false)).rejects.toThrow('db down');
    expect(logger.warn).toHaveBeenCalledWith('[publisher] claimed-upload cleanup failed after a claim error', {
      slotId: SLOT_ID,
      reason: 'bucket down',
    });
  });

  it('does not record a claim time when the claim returned none', async () => {
    const store = makeStore({ claimVideoUpload: vi.fn(async () => readyUpload({ status: 'consumed', consumed_at: null })) });
    await resolveExistingMedia(store, fail, makeSlot(), NOW, false);
    expect(store.updateSlot).not.toHaveBeenCalled();
  });

  it('resolves an image from the uploads bucket with its content type', async () => {
    const store = makeStore();
    const slot = makeSlot({ mediaKind: 'image', mediaRef: IMAGE_REF, mediaContentType: 'image/png' });
    const resolved = await resolveExistingMedia(store, fail, slot, NOW, false);
    expect(store.downloadStorageObject).toHaveBeenCalledWith('uploads', IMAGE_REF);
    expect(resolved).toMatchObject({ media: { name: 'image.png', contentType: 'image/png' }, cleanup: null });
  });

  it('defaults an image to jpeg', async () => {
    const slot = makeSlot({ mediaKind: 'image', mediaRef: IMAGE_REF, mediaContentType: null });
    const resolved = await resolveExistingMedia(makeStore(), fail, slot, NOW, false);
    expect(resolved?.media).toMatchObject({ name: 'image.jpg', contentType: 'image/jpeg' });
  });

  it('fails an image outside the slot prefix without downloading', async () => {
    const store = makeStore();
    const slot = makeSlot({ mediaKind: 'image', mediaRef: 'scheduled-media/other/x.png' });
    expect(await resolveExistingMedia(store, fail, slot, NOW, false)).toBeNull();
    expect(fail).toHaveBeenCalledWith('scheduled image path is invalid');
    expect(store.downloadStorageObject).not.toHaveBeenCalled();
  });

  it('fails an image whose object is gone permanently and defers on a transient download error', async () => {
    const slot = makeSlot({ mediaKind: 'image', mediaRef: IMAGE_REF });
    const gone = makeStore({
      downloadStorageObject: vi.fn(async () => {
        throw new StorageNotFoundError('uploads');
      }),
    });
    expect(await resolveExistingMedia(gone, fail, slot, NOW, false)).toBeNull();
    expect(fail).toHaveBeenLastCalledWith('scheduled image file is gone');
    fail.mockClear();
    const flaky = makeStore({
      downloadStorageObject: vi.fn(async () => {
        throw new Error('timeout');
      }),
    });
    expect(await resolveExistingMedia(flaky, fail, slot, NOW, false)).toBeNull();
    expect(fail).not.toHaveBeenCalled();
  });

  it('returns nothing for a slot without a media kind', async () => {
    expect(await resolveExistingMedia(makeStore(), fail, makeSlot({ mediaKind: null }), NOW, false)).toBeNull();
  });
});
