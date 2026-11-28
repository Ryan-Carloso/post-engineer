import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), generateLogId: vi.fn(() => 'log-1') },
}));
vi.mock('@/lib/videos/signed-upload', () => {
  class VideoUploadError extends Error {
    constructor(
      message: string,
      public readonly status: number,
      public readonly code: string,
    ) {
      super(message);
      this.name = 'VideoUploadError';
    }
  }
  return {
    VideoUploadError,
    createSupabaseVideoUploadStore: vi.fn(),
  };
});

import { replayAsapHold, scheduleAsapHold } from '../asap-hold';
import { createSupabaseVideoUploadStore } from '@/lib/videos/signed-upload';
import type { PublishExistingContext } from '../context';

const USER_ID = 'user-uuid-1';
const UPLOAD_ID = '22222222-2222-4222-8222-222222222222';
const SCHEDULE_ID = '11111111-1111-4111-8111-111111111111';

interface HoldFakeConfig {
  scheduleLookupError?: { message: string };
  existingSchedule?: Record<string, unknown> | null;
  slotsLookupError?: { message: string };
  existingSlots?: Record<string, unknown>[];
  scheduleInsertError?: { code?: string; message?: string; details?: string } | null;
  slotInsertError?: { code?: string; message?: string; details?: string } | null;
  slotInsertRows?: Record<string, unknown>[];
}

function fakeSupabase(config: HoldFakeConfig = {}) {
  const deletedSchedules: string[] = [];
  const removedPaths: string[] = [];
  const insertedSchedules: unknown[] = [];
  const insertedSlots: unknown[] = [];

  class Query {
    private table: string;
    private op: 'select' | 'insert' | 'delete' = 'select';

    constructor(table: string) {
      this.table = table;
    }

    select(): this {
      return this;
    }

    eq(): this {
      return this;
    }

    order(): this {
      return this;
    }

    lt(): this {
      return this;
    }

    insert(values: unknown): this {
      this.op = 'insert';
      if (this.table === 'schedules') insertedSchedules.push(values);
      if (this.table === 'scheduled_posts') insertedSlots.push(...(values as unknown[]));
      return this;
    }

    delete(): this {
      this.op = 'delete';
      return this;
    }

    async maybeSingle(): Promise<{ data: unknown; error: unknown }> {
      if (this.table === 'schedules') {
        return { data: config.existingSchedule ?? null, error: config.scheduleLookupError ?? null };
      }
      return { data: null, error: null };
    }

    then<TResult1 = unknown, TResult2 = never>(
      onfulfilled?: ((value: { data: unknown; error: unknown }) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ): Promise<TResult1 | TResult2> {
      let result: { data: unknown; error: unknown };
      if (this.table === 'schedules' && this.op === 'insert') {
        result = { data: null, error: config.scheduleInsertError ?? null };
      } else if (this.table === 'schedules' && this.op === 'delete') {
        deletedSchedules.push(SCHEDULE_ID);
        result = { data: null, error: null };
      } else if (this.table === 'scheduled_posts' && this.op === 'insert') {
        result = {
          data: config.slotInsertRows ?? [{ id: 'slot-1', slot_at: new Date().toISOString(), title: 'Hold video' }],
          error: config.slotInsertError ?? null,
        };
      } else if (this.table === 'scheduled_posts') {
        result = { data: config.existingSlots ?? [], error: config.slotsLookupError ?? null };
      } else {
        result = { data: null, error: null };
      }
      return Promise.resolve(result).then(onfulfilled, onrejected);
    }
  }

  const client = {
    from: vi.fn((table: string) => new Query(table)),
    storage: {
      from: vi.fn(() => ({
        remove: vi.fn(async (paths: string[]) => {
          removedPaths.push(...paths);
          return { error: null };
        }),
      })),
    },
    __deletedSchedules: deletedSchedules,
    __removedPaths: removedPaths,
    __insertedSchedules: insertedSchedules,
    __insertedSlots: insertedSlots,
  };
  return client;
}

function uploadRow(): Record<string, unknown> {
  return {
    id: UPLOAD_ID,
    user_id: USER_ID,
    storage_path: `${USER_ID}/direct-uploads/${UPLOAD_ID}.mp4`,
    declared_content_type: 'video/mp4',
    detected_content_type: 'video/mp4',
    size_bytes: 3,
    status: 'ready',
    expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    created_at: '2026-11-14T11:00:00Z',
    consumed_at: null,
  };
}

function holdContext(client: unknown): PublishExistingContext {
  return {
    aiLabel: false,
    approvalMode: 'approval',
    route: 'POST /api/media/publish-existing',
    supabase: client as never,
    userId: USER_ID,
    request: new Request('https://post-engineer.com/api/media/publish-existing', { method: 'POST' }),
    input: {
      title: 'Hold video',
      description: 'Approve it later.',
      personaId: null,
      publishing: { mode: 'asap', providers: ['youtube'], pinterestBoardId: null },
      promptVersionId: undefined,
    } as unknown as PublishExistingContext['input'],
    accountIds: { youtube: ['ch-1'] } as unknown as PublishExistingContext['accountIds'],
    reconnectWarning: null,
    uploadRow: uploadRow() as never,
    image: null,
    logId: 'log-1',
    startTime: Date.now(),
  };
}

function mockStore(updateUpload: ReturnType<typeof vi.fn>) {
  vi.mocked(createSupabaseVideoUploadStore).mockReturnValue({ updateUpload } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('replayAsapHold', () => {
  it('returns 500 when the idempotency lookup fails', async () => {
    const client = fakeSupabase({ scheduleLookupError: { message: 'db down' } });

    const response = await replayAsapHold(client as never, SCHEDULE_ID, USER_ID, 'POST /api/media/publish-existing');

    expect(response?.status).toBe(500);
  });

  it('returns null when no schedule exists yet', async () => {
    const client = fakeSupabase({ existingSchedule: null });

    const response = await replayAsapHold(client as never, SCHEDULE_ID, USER_ID, 'POST /api/media/publish-existing');

    expect(response).toBeNull();
  });

  it('returns 500 when the slots lookup fails', async () => {
    const client = fakeSupabase({
      existingSchedule: { id: SCHEDULE_ID, created_at: new Date().toISOString() },
      slotsLookupError: { message: 'db down' },
    });

    const response = await replayAsapHold(client as never, SCHEDULE_ID, USER_ID, 'POST /api/media/publish-existing');

    expect(response?.status).toBe(500);
  });

  it('deletes a zombie schedule with no slots and returns null', async () => {
    const client = fakeSupabase({
      existingSchedule: { id: SCHEDULE_ID, created_at: new Date(Date.now() - 10 * 60 * 1000).toISOString() },
      existingSlots: [],
    });

    const response = await replayAsapHold(client as never, SCHEDULE_ID, USER_ID, 'POST /api/media/publish-existing');

    expect(response).toBeNull();
    expect(client.__deletedSchedules).toContain(SCHEDULE_ID);
  });

  it('keeps a young schedule with no slots and returns null', async () => {
    const client = fakeSupabase({
      existingSchedule: { id: SCHEDULE_ID, created_at: new Date().toISOString() },
      existingSlots: [],
    });

    const response = await replayAsapHold(client as never, SCHEDULE_ID, USER_ID, 'POST /api/media/publish-existing');

    expect(response).toBeNull();
    expect(client.__deletedSchedules).toHaveLength(0);
  });
});

describe('scheduleAsapHold', () => {
  it('returns 409 when the upload extension fails', async () => {
    const client = fakeSupabase();
    const updateUpload = vi.fn(async () => false);
    mockStore(updateUpload);

    const response = await scheduleAsapHold(holdContext(client), SCHEDULE_ID);

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.code).toBe('VIDEO_UPLOAD_CONSUMED');
    expect(client.__insertedSchedules).toHaveLength(0);
  });

  it('returns 500 when the schedule insert fails', async () => {
    const client = fakeSupabase({ scheduleInsertError: { message: 'db down' } });
    const updateUpload = vi.fn(async () => true);
    mockStore(updateUpload);

    const response = await scheduleAsapHold(holdContext(client), SCHEDULE_ID);

    expect(response.status).toBe(500);
  });

  it('returns 409 when the slot insert hits the upload reference index', async () => {
    const client = fakeSupabase({
      slotInsertError: {
        code: '23505',
        message: 'duplicate key value violates unique constraint "scheduled_posts_upload_media_ref_key"',
      },
    });
    const updateUpload = vi.fn(async () => true);
    mockStore(updateUpload);

    const response = await scheduleAsapHold(holdContext(client), SCHEDULE_ID);

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.code).toBe('VIDEO_UPLOAD_SCHEDULED');
    expect(client.__deletedSchedules).toContain(SCHEDULE_ID);
  });

  it('returns 500 when the slot insert fails and deletes the schedule', async () => {
    const client = fakeSupabase({ slotInsertError: { message: 'db down' } });
    const updateUpload = vi.fn(async () => true);
    mockStore(updateUpload);

    const response = await scheduleAsapHold(holdContext(client), SCHEDULE_ID);

    expect(response.status).toBe(500);
    expect(client.__deletedSchedules).toContain(SCHEDULE_ID);
  });

  it('stores the first comment on the held slot', async () => {
    const client = fakeSupabase();
    const updateUpload = vi.fn(async () => true);
    mockStore(updateUpload);
    const ctx = holdContext(client);
    ctx.input = { ...ctx.input, firstComment: 'Link in bio' };

    const response = await scheduleAsapHold(ctx, SCHEDULE_ID);

    expect(response.status).toBe(200);
    expect((client.__insertedSlots[0] as Record<string, unknown>).first_comment).toBe('Link in bio');
  });
});
