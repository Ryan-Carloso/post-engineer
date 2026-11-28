import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { logger } from '@/lib/logger';
import {
  loadReadyVideoUpload,
  storeScheduledImage,
} from '../media-resolve';

const USER_ID = 'user-uuid-1';

describe('loadReadyVideoUpload', () => {
  const UPLOAD_ID = '22222222-2222-4222-8222-222222222222';
  const NOW = new Date('2026-11-14T12:00:00Z');

  function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id: UPLOAD_ID,
      user_id: USER_ID,
      storage_path: `${USER_ID}/direct-uploads/${UPLOAD_ID}.mp4`,
      declared_content_type: 'video/mp4',
      detected_content_type: 'video/mp4',
      size_bytes: 1234,
      status: 'ready',
      expires_at: '2026-11-15T12:00:00Z',
      created_at: '2026-11-14T11:00:00Z',
      consumed_at: null,
      ...overrides,
    };
  }

  it('returns a ready row owned by the caller', async () => {
    const store = { getUpload: vi.fn(async () => row()) };
    const loaded = await loadReadyVideoUpload(store as never, USER_ID, UPLOAD_ID, NOW);
    expect(loaded.id).toBe(UPLOAD_ID);
    expect(loaded.status).toBe('ready');
  });

  it('answers 404 for a missing row and for a foreign-owned row', async () => {
    const missing = { getUpload: vi.fn(async () => null) };
    await expect(loadReadyVideoUpload(missing as never, USER_ID, UPLOAD_ID, NOW)).rejects.toMatchObject({
      status: 404,
      code: 'VIDEO_UPLOAD_NOT_FOUND',
    });
    const foreign = { getUpload: vi.fn(async () => row({ user_id: 'someone-else' })) };
    await expect(loadReadyVideoUpload(foreign as never, USER_ID, UPLOAD_ID, NOW)).rejects.toMatchObject({
      status: 404,
      code: 'VIDEO_UPLOAD_NOT_FOUND',
    });
  });

  it('answers 409 for a consumed row and for a pending row', async () => {
    const consumed = { getUpload: vi.fn(async () => row({ status: 'consumed' })) };
    await expect(loadReadyVideoUpload(consumed as never, USER_ID, UPLOAD_ID, NOW)).rejects.toMatchObject({
      status: 409,
      code: 'VIDEO_UPLOAD_CONSUMED',
    });
    const pending = { getUpload: vi.fn(async () => row({ status: 'pending' })) };
    await expect(loadReadyVideoUpload(pending as never, USER_ID, UPLOAD_ID, NOW)).rejects.toMatchObject({
      status: 409,
      code: 'VIDEO_UPLOAD_NOT_READY',
    });
  });

  it('answers 410 for an expired row', async () => {
    const expired = { getUpload: vi.fn(async () => row({ expires_at: '2026-11-14T11:00:00Z' })) };
    await expect(loadReadyVideoUpload(expired as never, USER_ID, UPLOAD_ID, NOW)).rejects.toMatchObject({
      status: 410,
      code: 'VIDEO_UPLOAD_EXPIRED',
    });
  });
});

describe('storeScheduledImage', () => {
  it('stores the bytes under scheduled-media and returns the storage path', async () => {
    const upload = vi.fn(async () => ({ data: { path: 'scheduled-media/user-uuid-1/abc.jpg' }, error: null }));
    const supabase = { storage: { from: vi.fn(() => ({ upload })) } };
    const path = await storeScheduledImage(
      supabase as never,
      USER_ID,
      Buffer.from([0xff, 0xd8, 0xff]),
      'image/jpeg',
    );
    expect(path).toBe('scheduled-media/user-uuid-1/abc.jpg');
    expect(supabase.storage.from).toHaveBeenCalledWith('uploads');
    const [storedPath, buffer, options] = upload.mock.calls[0] as unknown as [string, Buffer, { contentType: string }];
    expect(storedPath.startsWith(`scheduled-media/${USER_ID}/`)).toBe(true);
    expect(storedPath.endsWith('.jpg')).toBe(true);
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(options.contentType).toBe('image/jpeg');
  });

  it('throws a generic 500 when storage refuses the upload, and logs the upstream error server-side', async () => {
    const upload = vi.fn(async () => ({ data: null, error: { message: 'bucket gone' } }));
    const supabase = { storage: { from: vi.fn(() => ({ upload })) } };
    await expect(
      storeScheduledImage(supabase as never, USER_ID, Buffer.from([0xff, 0xd8, 0xff]), 'image/jpeg'),
    ).rejects.toMatchObject({
      status: 500,
      code: 'MEDIA_STORE_FAILED',
      message: 'Something went wrong. Please try again later.',
    });
    expect(logger.error).toHaveBeenCalledWith(
      '[publish-existing] scheduled image storage failed',
      expect.objectContaining({ message: 'bucket gone' }),
      expect.objectContaining({ userId: USER_ID }),
    );
  });
});
