import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveSlotMedia } from '../post-detail-media';

vi.mock('../logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

function fakeService(options: { upload?: unknown; signedUrl?: string | null; lookupError?: { message: string } | null }) {
  const createSignedUrl = vi.fn(async () =>
    options.signedUrl === null
      ? { data: null, error: { message: 'gone' } }
      : { data: { signedUrl: options.signedUrl ?? 'https://signed.test/video.mp4' }, error: null },
  );
  const maybeSingle = vi.fn(async () =>
    options.lookupError
      ? { data: null, error: options.lookupError }
      : { data: options.upload ?? null, error: null },
  );
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  const storageFrom = vi.fn(() => ({ createSignedUrl }));
  const service = { from, storage: { from: storageFrom } } as unknown as SupabaseClient;
  return { service, createSignedUrl, storageFrom, from };
}

const UPLOAD_ROW = { media_kind: 'upload', media_ref: 'upload-1', media_content_type: 'video/mp4', status: 'ready' };

describe('resolveSlotMedia', () => {
  it('signs the stored file of a ready upload slot for its owner', async () => {
    const { service, storageFrom } = fakeService({
      upload: { storage_path: 'user-1/direct-uploads/upload-1.mp4', user_id: 'user-1', status: 'ready' },
    });
    const media = await resolveSlotMedia(service, 'slot-1', 'user-1', UPLOAD_ROW);
    expect(media).toEqual({ kind: 'upload', url: 'https://signed.test/video.mp4', contentType: 'video/mp4' });
    expect(storageFrom).toHaveBeenCalledWith('videos');
  });

  it('signs an image published as an upload as an image', async () => {
    const { service, storageFrom } = fakeService({
      upload: { storage_path: 'user-1/direct-uploads/upload-1.jpg', user_id: 'user-1', status: 'ready' },
      signedUrl: 'https://signed.test/pic.jpg',
    });
    const media = await resolveSlotMedia(service, 'slot-1', 'user-1', {
      media_kind: 'upload', media_ref: 'upload-1', media_content_type: 'image/jpeg', status: 'ready',
    });
    expect(media).toEqual({ kind: 'image', url: 'https://signed.test/pic.jpg', contentType: 'image/jpeg' });
    expect(storageFrom).toHaveBeenCalledWith('videos');
  });

  it('never signs an upload owned by another user', async () => {
    const { service, createSignedUrl } = fakeService({
      upload: { storage_path: 'other/direct-uploads/upload-1.mp4', user_id: 'someone-else', status: 'ready' },
    });
    const media = await resolveSlotMedia(service, 'slot-1', 'user-1', UPLOAD_ROW);
    expect(media?.url).toBeNull();
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it('never signs a scheduled image that escapes the owner prefix', async () => {
    const { service, createSignedUrl } = fakeService({});
    const media = await resolveSlotMedia(service, 'slot-1', 'user-1', {
      media_kind: 'image', media_ref: 'scheduled-media/user-1/../user-2/x.jpg', media_content_type: 'image/jpeg', status: 'ready',
    });
    expect(media?.url).toBeNull();
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it('returns no preview url when signing fails', async () => {
    const { service } = fakeService({
      upload: { storage_path: 'user-1/direct-uploads/upload-1.mp4', user_id: 'user-1', status: 'ready' },
      signedUrl: null,
    });
    const media = await resolveSlotMedia(service, 'slot-1', 'user-1', UPLOAD_ROW);
    expect(media).toEqual({ kind: 'upload', url: null, contentType: 'video/mp4' });
  });

  it('returns no preview url when the upload lookup fails', async () => {
    const { service } = fakeService({ lookupError: { message: 'db down' } });
    const media = await resolveSlotMedia(service, 'slot-1', 'user-1', UPLOAD_ROW);
    expect(media).toEqual({ kind: 'upload', url: null, contentType: 'video/mp4' });
  });

  it('returns no preview url when the storage client throws', async () => {
    const throwing = {
      from: () => { throw new Error('boom'); },
      storage: { from: () => { throw new Error('boom'); } },
    } as unknown as SupabaseClient;
    const media = await resolveSlotMedia(throwing, 'slot-1', 'user-1', UPLOAD_ROW);
    expect(media).toEqual({ kind: 'upload', url: null, contentType: 'video/mp4' });
  });

  it('signs the stored file of an awaiting_approval upload slot', async () => {
    const { service, storageFrom } = fakeService({
      upload: { storage_path: 'user-1/direct-uploads/upload-1.mp4', user_id: 'user-1', status: 'ready' },
    });
    const media = await resolveSlotMedia(service, 'slot-1', 'user-1', { ...UPLOAD_ROW, status: 'awaiting_approval' });
    expect(media).toEqual({ kind: 'upload', url: 'https://signed.test/video.mp4', contentType: 'video/mp4' });
    expect(storageFrom).toHaveBeenCalledWith('videos');
  });

  it('signs a scheduled image of an awaiting_approval slot', async () => {
    const { service, storageFrom } = fakeService({});
    const media = await resolveSlotMedia(service, 'slot-1', 'user-1', {
      media_kind: 'image', media_ref: 'scheduled-media/user-1/pic.jpg', media_content_type: 'image/jpeg', status: 'awaiting_approval',
    });
    expect(media).toEqual({ kind: 'image', url: 'https://signed.test/video.mp4', contentType: 'image/jpeg' });
    expect(storageFrom).toHaveBeenCalledWith('uploads');
  });

  it('returns no preview url for a published upload slot whose bytes were cleaned up', async () => {
    const { service, from } = fakeService({});
    const media = await resolveSlotMedia(service, 'slot-1', 'user-1', { ...UPLOAD_ROW, status: 'published' });
    expect(media).toEqual({ kind: 'upload', url: null, contentType: 'video/mp4' });
    expect(from).not.toHaveBeenCalled();
  });

  it('signs a scheduled image under the owner prefix only', async () => {
    const { service, storageFrom } = fakeService({});
    const own = await resolveSlotMedia(service, 'slot-1', 'user-1', {
      media_kind: 'image', media_ref: 'scheduled-media/user-1/pic.jpg', media_content_type: 'image/jpeg', status: 'ready',
    });
    expect(own?.url).toBe('https://signed.test/video.mp4');
    expect(storageFrom).toHaveBeenCalledWith('uploads');
    const foreign = await resolveSlotMedia(service, 'slot-1', 'user-1', {
      media_kind: 'image', media_ref: 'scheduled-media/someone-else/pic.jpg', media_content_type: 'image/jpeg', status: 'ready',
    });
    expect(foreign?.url).toBeNull();
  });

  it('returns null for an engine-generated slot', async () => {
    const { service } = fakeService({});
    await expect(resolveSlotMedia(service, 'slot-1', 'user-1', {
      media_kind: null, media_ref: null, media_content_type: null, status: 'ready',
    })).resolves.toBeNull();
  });
});
