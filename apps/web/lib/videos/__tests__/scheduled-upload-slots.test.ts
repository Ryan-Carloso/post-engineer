import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { LIVE_UPLOAD_SLOT_STATUSES, listLiveUploadSlotTimes } from '../scheduled-upload-slots';

function fakeClient(result: { data: unknown; error: { message: string } | null }) {
  const inStatus = vi.fn(async () => result);
  const inRef = vi.fn(() => ({ in: inStatus }));
  const eq = vi.fn(() => ({ in: inRef }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  const client = { from } as unknown as SupabaseClient;
  return { client, from, select, eq, inRef, inStatus };
}

describe('listLiveUploadSlotTimes', () => {
  it('reads only live upload slots for the given uploads and keeps the latest time per upload', async () => {
    const fake = fakeClient({
      data: [
        { media_ref: 'u1', slot_at: '2026-11-27T12:00:00+00:00' },
        { media_ref: 'u1', slot_at: '2026-11-29T12:00:00+00:00' },
        { media_ref: 'u2', slot_at: '2026-11-28T08:00:00+00:00' },
        { media_ref: 'u3', slot_at: 'not a date' },
        { media_ref: null, slot_at: '2026-11-28T08:00:00+00:00' },
      ],
      error: null,
    });
    const times = await listLiveUploadSlotTimes(fake.client, ['u1', 'u2', 'u3']);
    expect(fake.from).toHaveBeenCalledWith('scheduled_posts');
    expect(fake.eq).toHaveBeenCalledWith('media_kind', 'upload');
    expect(fake.inRef).toHaveBeenCalledWith('media_ref', ['u1', 'u2', 'u3']);
    expect(fake.inStatus).toHaveBeenCalledWith('status', ['pending', 'generating', 'ready', 'publishing']);
    expect([...times]).toEqual([
      ['u1', '2026-11-29T12:00:00+00:00'],
      ['u2', '2026-11-28T08:00:00+00:00'],
    ]);
  });

  it('never counts a finished slot as live', () => {
    expect(LIVE_UPLOAD_SLOT_STATUSES).not.toContain('published');
    expect(LIVE_UPLOAD_SLOT_STATUSES).not.toContain('failed');
  });

  it('skips the query for an empty batch', async () => {
    const fake = fakeClient({ data: [], error: null });
    expect((await listLiveUploadSlotTimes(fake.client, [])).size).toBe(0);
    expect(fake.from).not.toHaveBeenCalled();
  });

  it('throws on a database error so the sweep removes nothing', async () => {
    const fake = fakeClient({ data: null, error: { message: 'timeout' } });
    await expect(listLiveUploadSlotTimes(fake.client, ['u1'])).rejects.toThrow(
      'Failed to list scheduled upload slots: timeout',
    );
  });
});
