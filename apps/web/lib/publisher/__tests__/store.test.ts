// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/service', () => ({ createSupabaseServiceClient: vi.fn() }));

import type { SupabaseClient } from '@supabase/supabase-js';
import { PublisherStoreError, createPublisherStore } from '@/lib/publisher/store';
import { StorageNotFoundError } from '@/lib/publisher/store-types';
import { NOW } from './helpers';

interface Fake {
  rpc: ReturnType<typeof vi.fn>;
  from: ReturnType<typeof vi.fn>;
  storage: { from: ReturnType<typeof vi.fn> };
}

function fake(overrides: Partial<Fake> = {}): SupabaseClient {
  const client: Fake = {
    rpc: vi.fn(async () => ({ data: null, error: null })),
    from: vi.fn(),
    storage: { from: vi.fn() },
    ...overrides,
  };
  return client as unknown as SupabaseClient;
}

describe('claimNextSlot', () => {
  it('calls the claim rpc with the instant and the lease and parses the row', async () => {
    const rpc = vi.fn(async () => ({ data: { id: 'slot-1', resumed: true, schedules: { providers: ['youtube'] } }, error: null }));
    const slot = await createPublisherStore(fake({ rpc })).claimNextSlot(NOW, 1800);
    expect(rpc).toHaveBeenCalledWith('claim_next_publish_slot', { p_now: NOW.toISOString(), p_lease: '1800 seconds' });
    expect(slot).toMatchObject({ id: 'slot-1', resumed: true });
  });

  it('returns null when nothing is due', async () => {
    expect(await createPublisherStore(fake()).claimNextSlot(NOW, 1800)).toBeNull();
  });

  it('throws a tagged, scrubbed error when the rpc fails', async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: 'connect failed https://user:secret@db.internal/postgres' } }));
    const run = createPublisherStore(fake({ rpc })).claimNextSlot(NOW, 1800);
    await expect(run).rejects.toThrow(PublisherStoreError);
    await expect(run).rejects.toThrow('[publisher-store] claim_next_publish_slot failed: connect failed https://[redacted]@db.internal/postgres');
  });

  it('rejects a malformed row instead of publishing it', async () => {
    const rpc = vi.fn(async () => ({ data: { title: 'no id' }, error: null }));
    await expect(createPublisherStore(fake({ rpc })).claimNextSlot(NOW, 1800)).rejects.toThrow('without an id');
  });
});

describe('expireInactiveReadySlots', () => {
  it('maps the expired rows and ignores junk', async () => {
    const rpc = vi.fn(async () => ({
      data: [{ id: 'a', user_id: 'u', media_kind: 'upload', media_ref: 'r' }, { id: 7 }, 'x', { id: 'b' }],
      error: null,
    }));
    const expired = await createPublisherStore(fake({ rpc })).expireInactiveReadySlots(NOW);
    expect(rpc).toHaveBeenCalledWith('expire_inactive_ready_slots', { p_now: NOW.toISOString(), p_limit: 100 });
    expect(expired).toEqual([
      { id: 'a', userId: 'u', mediaKind: 'upload', mediaRef: 'r' },
      { id: 'b', userId: null, mediaKind: null, mediaRef: null },
    ]);
  });

  it('returns an empty list for a non-list answer and throws on an rpc error', async () => {
    expect(await createPublisherStore(fake()).expireInactiveReadySlots(NOW)).toEqual([]);
    const rpc = vi.fn(async () => ({ data: null, error: { message: 'nope' } }));
    await expect(createPublisherStore(fake({ rpc })).expireInactiveReadySlots(NOW)).rejects.toThrow('expire_inactive_ready_slots failed: nope');
  });
});

describe('personaBoundAccounts', () => {
  function bindingClient(result: { data: unknown; error: { message: string } | null }) {
    const eq = vi.fn(async () => result);
    const select = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ select }));
    return { client: fake({ from }), from, select, eq };
  }

  it('groups the bound account ids per provider and skips malformed rows', async () => {
    const { client, from, select, eq } = bindingClient({
      data: [
        { provider: 'youtube', provider_account_id: 'yt-1' },
        { provider: 'youtube', provider_account_id: 'yt-2' },
        { provider: 'bluesky', provider_account_id: '' },
        { provider: 7, provider_account_id: 'x' },
        { provider: 'rumble', provider_account_id: null },
      ],
      error: null,
    });
    expect(await createPublisherStore(client).personaBoundAccounts('per-1')).toEqual({ youtube: ['yt-1', 'yt-2'] });
    expect(from).toHaveBeenCalledWith('persona_default_accounts');
    expect(select).toHaveBeenCalledWith('provider, provider_account_id');
    expect(eq).toHaveBeenCalledWith('persona_id', 'per-1');
  });

  it('returns an empty binding for no rows and throws on an error', async () => {
    expect(await createPublisherStore(bindingClient({ data: null, error: null }).client).personaBoundAccounts('p')).toEqual({});
    await expect(
      createPublisherStore(bindingClient({ data: null, error: { message: 'db down' } }).client).personaBoundAccounts('p'),
    ).rejects.toThrow('persona_default_accounts read failed: db down');
  });
});

describe('updateSlot', () => {
  it('updates the slot by id and throws on an error', async () => {
    const eq = vi.fn(async () => ({ error: null }));
    const update = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ update }));
    await createPublisherStore(fake({ from })).updateSlot('slot-1', { status: 'failed' });
    expect(from).toHaveBeenCalledWith('scheduled_posts');
    expect(update).toHaveBeenCalledWith({ status: 'failed' });
    expect(eq).toHaveBeenCalledWith('id', 'slot-1');

    const failing = vi.fn(() => ({ update: () => ({ eq: async () => ({ error: { message: 'rls' } }) }) }));
    await expect(createPublisherStore(fake({ from: failing })).updateSlot('s', {})).rejects.toThrow('scheduled_posts update failed: rls');
  });
});

describe('video uploads', () => {
  const row = { id: 'up-1', user_id: 'u', status: 'ready', storage_path: 'u/up-1.mp4', declared_content_type: 'video/mp4', detected_content_type: null, consumed_at: null };

  it('reads one upload by id, returning null when it is missing', async () => {
    const maybeSingle = vi.fn(async (): Promise<{ data: unknown; error: { message: string } | null }> => ({ data: row, error: null }));
    const eq = vi.fn(() => ({ maybeSingle }));
    const from = vi.fn(() => ({ select: () => ({ eq }) }));
    expect(await createPublisherStore(fake({ from })).getVideoUpload('up-1')).toEqual({ ...row, detected_content_type: null });
    expect(eq).toHaveBeenCalledWith('id', 'up-1');
    maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    expect(await createPublisherStore(fake({ from })).getVideoUpload('up-1')).toBeNull();
    maybeSingle.mockResolvedValueOnce({ data: null, error: { message: 'down' } });
    await expect(createPublisherStore(fake({ from })).getVideoUpload('up-1')).rejects.toThrow('video_uploads read failed: down');
  });

  function claimClient(result: { data: unknown; error: { message: string } | null }) {
    const select = vi.fn(async () => result);
    const eqStatus = vi.fn(() => ({ select }));
    const eqId = vi.fn(() => ({ eq: eqStatus }));
    const update = vi.fn(() => ({ eq: eqId }));
    return { client: fake({ from: vi.fn(() => ({ update })) }), update, eqId, eqStatus };
  }

  it('claims only a ready upload and returns the consumed row, null when the claim is lost', async () => {
    const won = claimClient({ data: [{ ...row, status: 'consumed', consumed_at: NOW.toISOString() }], error: null });
    const claimed = await createPublisherStore(won.client).claimVideoUpload('up-1', NOW);
    expect(won.update).toHaveBeenCalledWith({ status: 'consumed', consumed_at: NOW.toISOString() });
    expect(won.eqId).toHaveBeenCalledWith('id', 'up-1');
    expect(won.eqStatus).toHaveBeenCalledWith('status', 'ready');
    expect(claimed).toMatchObject({ status: 'consumed', consumed_at: NOW.toISOString() });

    expect(await createPublisherStore(claimClient({ data: [], error: null }).client).claimVideoUpload('up-1', NOW)).toBeNull();
    expect(await createPublisherStore(claimClient({ data: null, error: null }).client).claimVideoUpload('up-1', NOW)).toBeNull();
    await expect(
      createPublisherStore(claimClient({ data: null, error: { message: 'down' } }).client).claimVideoUpload('up-1', NOW),
    ).rejects.toThrow('video_uploads claim failed: down');
  });
});

describe('storage', () => {
  function storageClient(bucket: Record<string, unknown>) {
    const from = vi.fn(() => bucket);
    return { client: fake({ storage: { from } }), from };
  }

  it('downloads an object as bytes from the named bucket', async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])]);
    const { client, from } = storageClient({ download: vi.fn(async () => ({ data: blob, error: null })) });
    const bytes = await createPublisherStore(client).downloadStorageObject('videos', 'u/a.mp4');
    expect(from).toHaveBeenCalledWith('videos');
    expect([...bytes]).toEqual([1, 2, 3]);
  });

  it.each([
    [{ message: 'Object not found' }],
    [{ message: 'x', status: 404 }],
    [{ message: 'x', statusCode: '404' }],
  ])('maps %j to a not-found error', async (error) => {
    const { client } = storageClient({ download: vi.fn(async () => ({ data: null, error })) });
    await expect(createPublisherStore(client).downloadStorageObject('videos', 'p')).rejects.toThrow(StorageNotFoundError);
  });

  it('throws a tagged error for any other download failure', async () => {
    const { client } = storageClient({ download: vi.fn(async () => ({ data: null, error: { message: 'service unavailable', status: 503 } })) });
    await expect(createPublisherStore(client).downloadStorageObject('videos', 'p')).rejects.toThrow('storage download failed: service unavailable');
  });

  it('reports whether the object was removed without throwing', async () => {
    const remove = vi.fn(async () => ({ error: null }));
    const { client } = storageClient({ remove });
    expect(await createPublisherStore(client).removeStorageObject('videos', 'u/a.mp4')).toBe(true);
    expect(remove).toHaveBeenCalledWith(['u/a.mp4']);
    const failing = storageClient({ remove: vi.fn(async () => ({ error: { message: 'gone' } })) });
    expect(await createPublisherStore(failing.client).removeStorageObject('videos', 'p')).toBe(false);
  });
});
