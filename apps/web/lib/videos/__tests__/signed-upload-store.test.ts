// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/service', () => ({
  createSupabaseServiceClient: vi.fn(),
}));

import { createSupabaseServiceClient } from '@/lib/supabase/service';
import {
  VIDEO_UPLOAD_BUCKET,
  createSupabaseVideoUploadStorage,
  createSupabaseVideoUploadStore,
  type VideoUploadRow,
} from '../signed-upload';

const ROW: VideoUploadRow = {
  id: 'upload-1',
  user_id: 'user-1',
  storage_path: 'user-1/direct-uploads/upload-1.mp4',
  declared_content_type: 'video/mp4',
  detected_content_type: null,
  size_bytes: 10,
  status: 'pending',
  expires_at: '2026-11-12T00:15:00.000Z',
  created_at: '2026-11-12T00:00:00.000Z',
  consumed_at: null,
};

interface QueryError {
  message: string;
}

function installClient(options: {
  insertError?: QueryError | null;
  get?: { data: VideoUploadRow | null; error: QueryError | null };
  update?: { data: unknown[] | null; error: QueryError | null };
  deleteError?: QueryError | null;
  signed?: { data: { signedUrl: string; token: string; path: string } | null; error: QueryError | null };
  download?: { data: Blob | null; error: QueryError | null };
  removeError?: QueryError | null;
}) {
  const insert = vi.fn(async () => ({ error: options.insertError ?? null }));
  const maybeSingle = vi.fn(async () => ({
    data: options.get?.data ?? null,
    error: options.get?.error ?? null,
  }));
  const eqGet = vi.fn(() => ({ maybeSingle }));
  const selectGet = vi.fn(() => ({ eq: eqGet }));
  const selectUpdate = vi.fn(async () => ({
    data: options.update?.data ?? null,
    error: options.update?.error ?? null,
  }));
  const eqStatus = vi.fn(() => ({ select: selectUpdate }));
  const eqId = vi.fn(() => ({ eq: eqStatus }));
  const update = vi.fn(() => ({ eq: eqId }));
  const eqDelete = vi.fn(async () => ({ error: options.deleteError ?? null }));
  const removeRow = vi.fn(() => ({ eq: eqDelete }));
  const from = vi.fn(() => ({ insert, select: selectGet, update, delete: removeRow }));

  const createSignedUploadUrl = vi.fn(async () => options.signed ?? { data: null, error: null });
  const download = vi.fn(async () => options.download ?? { data: null, error: null });
  const remove = vi.fn(async () => ({ error: options.removeError ?? null }));
  const storageFrom = vi.fn(() => ({ createSignedUploadUrl, download, remove }));

  vi.mocked(createSupabaseServiceClient).mockReturnValue({
    from,
    storage: { from: storageFrom },
  } as never);

  return { from, insert, eqGet, eqId, eqStatus, eqDelete, storageFrom, createSignedUploadUrl, download, remove };
}

beforeEach(() => {
  vi.mocked(createSupabaseServiceClient).mockReset();
});

describe('createSupabaseVideoUploadStore', () => {
  it('inserts a row and surfaces a database error', async () => {
    const client = installClient({});
    const store = createSupabaseVideoUploadStore();
    await expect(store.insertUpload(ROW)).resolves.toEqual(ROW);
    expect(client.from).toHaveBeenCalledWith('video_uploads');
    expect(client.insert).toHaveBeenCalledWith(ROW);

    installClient({ insertError: { message: 'dup' } });
    await expect(createSupabaseVideoUploadStore().insertUpload(ROW)).rejects.toThrow(
      'Failed to record the video upload: dup',
    );
  });

  it('loads a row, an empty result, and a database error', async () => {
    const found = installClient({ get: { data: ROW, error: null } });
    await expect(createSupabaseVideoUploadStore().getUpload(ROW.id)).resolves.toEqual(ROW);
    expect(found.eqGet).toHaveBeenCalledWith('id', ROW.id);

    installClient({ get: { data: null, error: null } });
    await expect(createSupabaseVideoUploadStore().getUpload(ROW.id)).resolves.toBeNull();

    installClient({ get: { data: null, error: { message: 'down' } } });
    await expect(createSupabaseVideoUploadStore().getUpload(ROW.id)).rejects.toThrow(
      'Failed to load the video upload: down',
    );
  });

  it('reports whether the conditional update changed a row', async () => {
    const updated = installClient({ update: { data: [{ id: ROW.id }], error: null } });
    const store = createSupabaseVideoUploadStore();
    await expect(store.updateUpload(ROW.id, 'pending', { status: 'ready' })).resolves.toBe(true);
    expect(updated.eqId).toHaveBeenCalledWith('id', ROW.id);
    expect(updated.eqStatus).toHaveBeenCalledWith('status', 'pending');

    installClient({ update: { data: [], error: null } });
    await expect(createSupabaseVideoUploadStore().updateUpload(ROW.id, 'ready', { status: 'consumed' })).resolves.toBe(
      false,
    );

    installClient({ update: { data: null, error: null } });
    await expect(createSupabaseVideoUploadStore().updateUpload(ROW.id, 'ready', { status: 'consumed' })).resolves.toBe(
      false,
    );

    installClient({ update: { data: null, error: { message: 'locked' } } });
    await expect(createSupabaseVideoUploadStore().updateUpload(ROW.id, 'ready', { status: 'consumed' })).rejects.toThrow(
      'Failed to update the video upload: locked',
    );
  });

  it('deletes a row and surfaces a database error', async () => {
    const client = installClient({});
    await expect(createSupabaseVideoUploadStore().deleteUpload(ROW.id)).resolves.toBeUndefined();
    expect(client.eqDelete).toHaveBeenCalledWith('id', ROW.id);

    installClient({ deleteError: { message: 'gone' } });
    await expect(createSupabaseVideoUploadStore().deleteUpload(ROW.id)).rejects.toThrow(
      'Failed to remove the video upload: gone',
    );
  });
});

describe('createSupabaseVideoUploadStorage', () => {
  it('maps signed upload urls, including a null payload and a storage error', async () => {
    const signed = { signedUrl: 'https://storage.test/u', token: 'tok', path: 'user-1/file.mp4' };
    const client = installClient({ signed: { data: signed, error: null } });
    const storage = createSupabaseVideoUploadStorage();
    await expect(storage.createSignedUploadUrl(signed.path)).resolves.toEqual({ data: signed, error: null });
    expect(client.storageFrom).toHaveBeenCalledWith(VIDEO_UPLOAD_BUCKET);
    expect(client.createSignedUploadUrl).toHaveBeenCalledWith(signed.path);

    installClient({ signed: { data: null, error: { message: 'no bucket' } } });
    await expect(createSupabaseVideoUploadStorage().createSignedUploadUrl('p')).resolves.toEqual({
      data: null,
      error: { message: 'no bucket' },
    });
  });

  it('passes a download through and maps a storage error', async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])]);
    const client = installClient({ download: { data: blob, error: null } });
    const storage = createSupabaseVideoUploadStorage();
    await expect(storage.download('p')).resolves.toEqual({ data: blob, error: null });
    expect(client.download).toHaveBeenCalledWith('p');

    installClient({ download: { data: null, error: { message: 'missing' } } });
    await expect(createSupabaseVideoUploadStorage().download('p')).resolves.toEqual({
      data: null,
      error: { message: 'missing' },
    });
  });

  it('maps object removal, including a storage error', async () => {
    const client = installClient({});
    const storage = createSupabaseVideoUploadStorage();
    await expect(storage.remove(['a', 'b'])).resolves.toEqual({ error: null });
    expect(client.remove).toHaveBeenCalledWith(['a', 'b']);

    installClient({ removeError: { message: 'busy' } });
    await expect(createSupabaseVideoUploadStorage().remove(['a'])).resolves.toEqual({ error: { message: 'busy' } });
  });
});
