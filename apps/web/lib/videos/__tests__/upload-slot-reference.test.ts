// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { VideoUploadError } from '@/lib/videos/signed-upload';
import { assertUploadNotScheduled, uploadAlreadyScheduledError } from '@/lib/videos/upload-slot-reference';

interface Recorded {
  table: string;
  filters: Array<[string, string, unknown]>;
  limit: number | null;
}

function fakeClient(result: { data: unknown; error: unknown }): { client: SupabaseClient; recorded: Recorded } {
  const recorded: Recorded = { table: '', filters: [], limit: null };
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn((column: string, value: unknown) => {
      recorded.filters.push(['eq', column, value]);
      return query;
    }),
    neq: vi.fn((column: string, value: unknown) => {
      recorded.filters.push(['neq', column, value]);
      return query;
    }),
    limit: vi.fn((count: number) => {
      recorded.limit = count;
      return Promise.resolve(result);
    }),
  };
  const client = {
    from: vi.fn((table: string) => {
      recorded.table = table;
      return query;
    }),
  };
  return { client: client as unknown as SupabaseClient, recorded };
}

describe('assertUploadNotScheduled', () => {
  it('reads the live slots of this user that reference the upload', async () => {
    const { client, recorded } = fakeClient({ data: [], error: null });
    await expect(assertUploadNotScheduled(client, 'user-1', 'upload-1')).resolves.toBeUndefined();
    expect(recorded.table).toBe('scheduled_posts');
    expect(recorded.filters).toEqual([
      ['eq', 'user_id', 'user-1'],
      ['eq', 'media_kind', 'upload'],
      ['eq', 'media_ref', 'upload-1'],
      ['neq', 'status', 'failed'],
    ]);
    expect(recorded.limit).toBe(1);
  });

  it('throws 409 VIDEO_UPLOAD_SCHEDULED when a live slot holds the upload', async () => {
    const { client } = fakeClient({ data: [{ id: 'slot-1' }], error: null });
    const thrown = await assertUploadNotScheduled(client, 'user-1', 'upload-1').catch((error: unknown) => error);
    expect(thrown).toBeInstanceOf(VideoUploadError);
    expect(thrown).toMatchObject({ status: 409, code: 'VIDEO_UPLOAD_SCHEDULED' });
  });

  it('throws a plain error when the read fails, never a green light', async () => {
    const { client } = fakeClient({ data: null, error: { message: 'connection reset' } });
    const thrown = await assertUploadNotScheduled(client, 'user-1', 'upload-1').catch((error: unknown) => error);
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).not.toBeInstanceOf(VideoUploadError);
    expect((thrown as Error).message).toBe('scheduled upload lookup failed: connection reset');
  });
});

describe('uploadAlreadyScheduledError', () => {
  it('carries the localized default message', () => {
    const error = uploadAlreadyScheduledError();
    expect(error.message).toContain('already scheduled');
    expect(error.status).toBe(409);
  });
});
