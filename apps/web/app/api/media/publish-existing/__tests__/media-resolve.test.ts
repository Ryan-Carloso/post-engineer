// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { logger } from '@/lib/logger';
import {
  downloadEngineTaskVideo,
  fetchEngineTaskRecord,
  loadReadyVideoUpload,
  storeScheduledImage,
} from '../media-resolve';

const TASK_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = 'user-uuid-1';
const BASE_URL = 'https://engine.example.com';

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

function taskBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    status: 'success',
    message: 'ok',
    body: {
      state: 1,
      videos: ['final-1.mp4'],
      final_video: `${BASE_URL}/api/v1/download/${TASK_ID}/final-1.mp4`,
      has_archive: true,
      ...overrides,
    },
  };
}

beforeEach(() => {
  vi.stubEnv('MONEYPRINT_API_URL', BASE_URL);
  vi.stubEnv('MONEYPRINT_API_SECRET', 'secret-1');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('fetchEngineTaskRecord', () => {
  it('returns the record for a complete task with an archive', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200, taskBody()));
    const record = await fetchEngineTaskRecord(TASK_ID, USER_ID, fetchFn);
    expect(record).not.toBe(null);
    expect(record?.state).toBe(1);
    expect(record?.videos).toEqual(['final-1.mp4']);
    expect(record?.hasArchive).toBe(true);
    expect(record?.finalVideo).toBe(`${BASE_URL}/api/v1/download/${TASK_ID}/final-1.mp4`);
    expect(fetchFn).toHaveBeenCalledWith(
      `${BASE_URL}/api/v1/tasks/${TASK_ID}`,
      expect.objectContaining({ headers: expect.objectContaining({ 'x-user-id': USER_ID }) }),
    );
  });

  it('returns null on a 404 (unknown task, or another user’s task)', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(404, { status: 'error', message: 'task not found' }));
    expect(await fetchEngineTaskRecord(TASK_ID, USER_ID, fetchFn)).toBe(null);
  });

  it('throws ExistingMediaError on a 500', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(500, { status: 'error' }));
    await expect(fetchEngineTaskRecord(TASK_ID, USER_ID, fetchFn)).rejects.toMatchObject({
      status: 502,
      code: 'ENGINE_UNAVAILABLE',
    });
  });

  it('throws a coded 400 on an unsafe task id without fetching', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200, taskBody()));
    await expect(fetchEngineTaskRecord('../escape', USER_ID, fetchFn)).rejects.toMatchObject({
      status: 400,
      code: 'VALIDATION_FAILED',
      message: 'taskId is invalid.',
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('throws when the engine URL is not configured', async () => {
    vi.stubEnv('MONEYPRINT_API_URL', undefined);
    const fetchFn = vi.fn(async () => jsonResponse(200, taskBody()));
    await expect(fetchEngineTaskRecord(TASK_ID, USER_ID, fetchFn)).rejects.toThrow('MONEYPRINT_API_URL is not defined');
  });
});

describe('downloadEngineTaskVideo', () => {
  it('downloads the bytes behind final_video', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const fetchFn = vi.fn(async () => new Response(bytes, { status: 200, headers: { 'content-type': 'video/mp4' } }));
    const record = { state: 1, videos: ['final-1.mp4'], finalVideo: `${BASE_URL}/api/v1/download/${TASK_ID}/final-1.mp4`, hasArchive: true };
    const downloaded = await downloadEngineTaskVideo(record, USER_ID, fetchFn);
    expect(Buffer.from(downloaded.buffer).equals(Buffer.from(bytes))).toBe(true);
    expect(downloaded.contentType).toBe('video/mp4');
  });

  it('follows the engine 302 to the signed R2 URL without auth headers', async () => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    const fetchFn = vi.fn(async (url: string, init?: { headers?: Record<string, string> }) => {
      calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
      if (url.startsWith(`${BASE_URL}/`)) {
        return new Response(null, { status: 302, headers: { location: 'https://r2.example.com/signed-video' } });
      }
      return new Response(new Uint8Array([9, 9]), { status: 200, headers: { 'content-type': 'video/mp4' } });
    }) as unknown as typeof fetch;
    const record = { state: 1, videos: ['final-1.mp4'], finalVideo: `${BASE_URL}/api/v1/download/${TASK_ID}/final-1.mp4`, hasArchive: true };
    const downloaded = await downloadEngineTaskVideo(record, USER_ID, fetchFn);
    expect(downloaded.buffer.length).toBe(2);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.headers.Authorization).toBeUndefined();
    expect(calls[1]?.headers['x-user-id']).toBeUndefined();
  });

  it('throws MEDIA_NOT_FOUND when there is no final video', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200, taskBody()));
    const record = { state: 1, videos: [], finalVideo: null, hasArchive: false };
    await expect(downloadEngineTaskVideo(record, USER_ID, fetchFn)).rejects.toMatchObject({
      status: 404,
      code: 'MEDIA_NOT_FOUND',
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('throws before buffering when content-length exceeds 2 GB', async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(new Uint8Array([1]), {
          status: 200,
          headers: { 'content-type': 'video/mp4', 'content-length': String(2 * 1024 * 1024 * 1024 + 1) },
        }),
    );
    const record = { state: 1, videos: ['final-1.mp4'], finalVideo: `${BASE_URL}/api/v1/download/${TASK_ID}/final-1.mp4`, hasArchive: true };
    await expect(downloadEngineTaskVideo(record, USER_ID, fetchFn)).rejects.toMatchObject({
      status: 413,
      code: 'MEDIA_TOO_LARGE',
    });
  });
});

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
