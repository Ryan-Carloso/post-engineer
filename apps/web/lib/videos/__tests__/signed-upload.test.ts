// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import {
  MAX_VIDEO_UPLOAD_BYTES,
  VideoUploadError,
  claimUploadForPublish,
  completeVideoUpload,
  mintVideoUpload,
  parseMintBody,
  type VideoUploadRow,
  type VideoUploadStorage,
  type VideoUploadStore,
} from '../signed-upload';

const NOW = new Date('2026-11-12T00:00:00.000Z');
const USER = 'user-uuid-1';
const OTHER = 'user-uuid-2';

// MP4: ftyp box at bytes 4-7, brand isom. MOV: brand 'qt  '.
const MP4 = Buffer.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 1, 2, 3, 4]);
const MOV = Buffer.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x71, 0x74, 0x20, 0x20, 1, 2, 3, 4]);

function makeStore(rows: VideoUploadRow[] = []): VideoUploadStore & { rows: Map<string, VideoUploadRow> } {
  const map = new Map(rows.map((r) => [r.id, { ...r }]));
  return {
    rows: map,
    async insertUpload(row) {
      map.set(row.id, { ...row });
      return { ...row };
    },
    async getUpload(id) {
      const row = map.get(id);
      return row === undefined ? null : { ...row };
    },
    async updateUpload(id, expectedStatus, patch) {
      const row = map.get(id);
      if (row === undefined || row.status !== expectedStatus) return false;
      map.set(id, { ...row, ...patch });
      return true;
    },
    async deleteUpload(id) {
      map.delete(id);
    },
  };
}

function makeStorage(bytes: Buffer | null = MP4): VideoUploadStorage & { removed: string[][] } {
  const removed: string[][] = [];
  return {
    removed,
    async createSignedUploadUrl(path) {
      return { data: { signedUrl: `https://storage.test/upload/${path}?token=t`, token: 'tok', path }, error: null };
    },
    async download() {
      return bytes === null
        ? { data: null, error: { message: 'Object not found' } }
        : { data: new Blob([new Uint8Array(bytes)]), error: null };
    },
    async remove(paths) {
      removed.push(paths);
      return { error: null };
    },
  };
}

function row(overrides: Partial<VideoUploadRow> = {}): VideoUploadRow {
  return {
    id: 'upload-1',
    user_id: USER,
    storage_path: `${USER}/direct-uploads/upload-1.mp4`,
    declared_content_type: 'video/mp4',
    detected_content_type: null,
    size_bytes: null,
    status: 'pending',
    expires_at: new Date(NOW.getTime() + 60_000).toISOString(),
    created_at: NOW.toISOString(),
    consumed_at: null,
    ...overrides,
  };
}

describe('parseMintBody', () => {
  it('accepts an mp4 within the size limit', () => {
    expect(parseMintBody({ contentType: 'video/mp4', sizeBytes: 1024 })).toEqual({
      contentType: 'video/mp4',
      sizeBytes: 1024,
    });
  });

  it('rejects a non-video content type', () => {
    expect(() => parseMintBody({ contentType: 'image/png', sizeBytes: 10 })).toThrow(VideoUploadError);
  });

  it('rejects a size over the 2GB limit', () => {
    expect(() => parseMintBody({ contentType: 'video/mp4', sizeBytes: MAX_VIDEO_UPLOAD_BYTES + 1 })).toThrow(
      /2GB|too large/i,
    );
  });

  it('rejects zero, fractional and non-object bodies', () => {
    expect(() => parseMintBody({ contentType: 'video/mp4', sizeBytes: 0 })).toThrow(VideoUploadError);
    expect(() => parseMintBody({ contentType: 'video/mp4', sizeBytes: 1.5 })).toThrow(VideoUploadError);
    expect(() => parseMintBody(null)).toThrow(VideoUploadError);
    expect(() => parseMintBody({ sizeBytes: 10 })).toThrow(VideoUploadError);
  });
});

describe('mintVideoUpload', () => {
  it('creates a pending row bound to the caller and returns the signed upload URL', async () => {
    const store = makeStore();
    const storage = makeStorage();
    const result = await mintVideoUpload(store, storage, USER, { contentType: 'video/quicktime', sizeBytes: 99 }, NOW);
    expect(result.uploadId).toBeTruthy();
    expect(result.signedUrl).toContain('token=');
    expect(result.token).toBe('tok');
    expect(result.expiresAt).toBe(new Date(NOW.getTime() + 15 * 60 * 1000).toISOString());
    const stored = [...store.rows.values()][0];
    expect(stored?.user_id).toBe(USER);
    expect(stored?.status).toBe('pending');
    expect(stored?.storage_path.startsWith(`${USER}/direct-uploads/`)).toBe(true);
    expect(stored?.storage_path.endsWith('.mov')).toBe(true);
  });

  it('deletes the row when signing fails', async () => {
    const store = makeStore();
    const storage = makeStorage();
    storage.createSignedUploadUrl = async () => ({ data: null, error: { message: 'no bucket' } });
    await expect(
      mintVideoUpload(store, storage, USER, { contentType: 'video/mp4', sizeBytes: 1 }, NOW),
    ).rejects.toMatchObject({ status: 502 });
    expect(store.rows.size).toBe(0);
  });

  it('deletes the row when signing returns no url and no error', async () => {
    const store = makeStore();
    const storage = makeStorage();
    storage.createSignedUploadUrl = async () => ({ data: null, error: null });
    await expect(
      mintVideoUpload(store, storage, USER, { contentType: 'video/mp4', sizeBytes: 1 }, NOW),
    ).rejects.toMatchObject({ status: 502 });
    expect(store.rows.size).toBe(0);
  });
});

describe('completeVideoUpload', () => {
  it('marks a verified mp4 ready with the detected type and real size', async () => {
    const store = makeStore([row()]);
    const result = await completeVideoUpload(store, makeStorage(MP4), USER, 'upload-1', NOW);
    expect(result).toMatchObject({ uploadId: 'upload-1', status: 'ready', contentType: 'video/mp4', sizeBytes: MP4.length });
    expect(store.rows.get('upload-1')?.status).toBe('ready');
  });

  it('is idempotent for an already-ready upload', async () => {
    const store = makeStore([row({ status: 'ready', detected_content_type: 'video/mp4', size_bytes: MP4.length })]);
    const result = await completeVideoUpload(store, makeStorage(), USER, 'upload-1', NOW);
    expect(result.status).toBe('ready');
  });

  it('falls back to the declared type, then mp4, when a ready upload has no detected type', async () => {
    const declared = await completeVideoUpload(
      makeStore([row({ status: 'ready', detected_content_type: null, declared_content_type: 'video/quicktime', size_bytes: null })]),
      makeStorage(),
      USER,
      'upload-1',
      NOW,
    );
    expect(declared).toMatchObject({ contentType: 'video/quicktime', sizeBytes: 0 });

    const fallback = await completeVideoUpload(
      makeStore([row({ status: 'ready', detected_content_type: null, declared_content_type: null, size_bytes: null })]),
      makeStorage(),
      USER,
      'upload-1',
      NOW,
    );
    expect(fallback.contentType).toBe('video/mp4');
  });

  it('returns 404 for unknown and foreign-owned uploads', async () => {
    const store = makeStore([row()]);
    await expect(completeVideoUpload(store, makeStorage(), USER, 'nope', NOW)).rejects.toMatchObject({ status: 404 });
    await expect(completeVideoUpload(store, makeStorage(), OTHER, 'upload-1', NOW)).rejects.toMatchObject({ status: 404 });
  });

  it('rejects expired, consumed, non-video and mismatched uploads', async () => {
    const expiredStorage = makeStorage();
    await expect(
      completeVideoUpload(makeStore([row({ expires_at: new Date(NOW.getTime() - 1).toISOString() })]), expiredStorage, USER, 'upload-1', NOW),
    ).rejects.toMatchObject({ status: 410 });
    expect(expiredStorage.removed).toEqual([[`${USER}/direct-uploads/upload-1.mp4`]]);
    const junk = makeStorage(Buffer.from('not a video at all......'));
    await expect(
      completeVideoUpload(makeStore([row()]), junk, USER, 'upload-1', NOW),
    ).rejects.toMatchObject({ status: 400 });
    expect(junk.removed).toEqual([[`${USER}/direct-uploads/upload-1.mp4`]]);
    await expect(
      completeVideoUpload(makeStore([row({ status: 'consumed' })]), makeStorage(), USER, 'upload-1', NOW),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      completeVideoUpload(makeStore([row()]), makeStorage(MOV), USER, 'upload-1', NOW),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('rejects a missing storage object as 400', async () => {
    await expect(completeVideoUpload(makeStore([row()]), makeStorage(null), USER, 'upload-1', NOW)).rejects.toMatchObject({
      status: 400,
    });
  });

  it('rejects an empty upload and deletes the object', async () => {
    const storage = makeStorage(Buffer.alloc(0));
    await expect(completeVideoUpload(makeStore([row()]), storage, USER, 'upload-1', NOW)).rejects.toMatchObject({
      status: 400,
      code: 'VIDEO_UPLOAD_FILE_EMPTY',
    });
    expect(storage.removed).toEqual([[`${USER}/direct-uploads/upload-1.mp4`]]);
  });

  it('rejects an upload over 2GB and deletes the object', async () => {
    // The guard compares buffer.length with 2GB. Patch the length on a
    // one-byte object so the branch runs without allocating 2GB.
    const storage = makeStorage(Buffer.from([0xab]));
    const realFrom = Buffer.from.bind(Buffer);
    const fromSpy = vi.spyOn(Buffer, 'from').mockImplementation(((input: unknown) => {
      const buf = realFrom(input as ArrayBuffer);
      if (buf.length === 1 && buf[0] === 0xab) {
        Object.defineProperty(buf, 'length', { value: MAX_VIDEO_UPLOAD_BYTES + 1 });
      }
      return buf;
    }) as typeof Buffer.from);
    try {
      await expect(completeVideoUpload(makeStore([row()]), storage, USER, 'upload-1', NOW)).rejects.toMatchObject({
        status: 413,
        code: 'VIDEO_UPLOAD_TOO_LARGE',
      });
      expect(storage.removed).toEqual([[`${USER}/direct-uploads/upload-1.mp4`]]);
    } finally {
      fromSpy.mockRestore();
    }
  });

  it('rejects a complete that lost the pending-to-ready race', async () => {
    const store = makeStore([row()]);
    store.updateUpload = async () => false;
    await expect(completeVideoUpload(store, makeStorage(MP4), USER, 'upload-1', NOW)).rejects.toMatchObject({
      status: 409,
      code: 'VIDEO_UPLOAD_CONFLICT',
    });
    expect(store.rows.get('upload-1')?.status).toBe('pending');
  });
});

describe('claimUploadForPublish', () => {
  it('claims a ready upload exactly once and returns its bytes', async () => {
    const store = makeStore([row({ status: 'ready', detected_content_type: 'video/mp4', size_bytes: MP4.length })]);
    const first = await claimUploadForPublish(store, makeStorage(MP4), USER, 'upload-1', NOW);
    expect(first.buffer.equals(MP4)).toBe(true);
    expect(first.contentType).toBe('video/mp4');
    expect(store.rows.get('upload-1')?.status).toBe('consumed');
    await expect(claimUploadForPublish(store, makeStorage(MP4), USER, 'upload-1', NOW)).rejects.toMatchObject({
      status: 409,
    });
  });

  it('rejects pending, expired and foreign uploads without consuming them', async () => {
    const pending = makeStore([row()]);
    await expect(claimUploadForPublish(pending, makeStorage(), USER, 'upload-1', NOW)).rejects.toMatchObject({ status: 409 });
    expect(pending.rows.get('upload-1')?.status).toBe('pending');

    const expired = makeStore([
      row({ status: 'ready', expires_at: new Date(NOW.getTime() - 1).toISOString(), detected_content_type: 'video/mp4' }),
    ]);
    const expiredStorage = makeStorage();
    await expect(claimUploadForPublish(expired, expiredStorage, USER, 'upload-1', NOW)).rejects.toMatchObject({ status: 410 });
    expect(expired.rows.get('upload-1')?.status).toBe('ready');
    expect(expiredStorage.removed).toEqual([[`${USER}/direct-uploads/upload-1.mp4`]]);

    const ready = makeStore([row({ status: 'ready', detected_content_type: 'video/mp4' })]);
    await expect(claimUploadForPublish(ready, makeStorage(), OTHER, 'upload-1', NOW)).rejects.toMatchObject({ status: 404 });
  });

  it('rejects a claim that lost the ready-to-consumed race', async () => {
    const store = makeStore([row({ status: 'ready', detected_content_type: 'video/mp4', size_bytes: MP4.length })]);
    store.updateUpload = async () => false;
    await expect(claimUploadForPublish(store, makeStorage(MP4), USER, 'upload-1', NOW)).rejects.toMatchObject({
      status: 409,
      code: 'VIDEO_UPLOAD_CONSUMED',
    });
    expect(store.rows.get('upload-1')?.status).toBe('ready');
  });
});
