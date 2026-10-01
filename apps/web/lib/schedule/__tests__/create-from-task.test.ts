import { describe, it, expect, vi, beforeEach } from 'vitest';

//---------------
// Tests for createScheduleFromTask — the shared helper behind the unified
// generate+schedule flow. Supabase is fully mocked; the assertions cover
// the schedule/slot payloads and the rollback on slot failure.
//---------------

import { createScheduleFromTask } from '../create-from-task';

const BASE_PARAMS = {
  userId: 'user-1',
  personaId: 'p-1' as string | null,
  providers: ['youtube', 'bluesky'] as ('youtube' | 'bluesky')[],
  youtubeAccountIds: ['yt-1'],
  instagramAccountIds: [] as string[],
  linkedinAccountIds: [] as string[],
  blueskyAccountIds: ['did:plc:abc'],
  scheduledAt: new Date('2026-10-02T20:00:00+01:00'),
  timezone: 'Europe/Lisbon',
  topic: 'launch video',
  taskId: 'task-1',
};

function mockClient(opts?: { slotError?: boolean }) {
  const scheduleInsert = vi.fn((payload: unknown) => ({
    select: vi.fn(() => ({
      single: vi.fn(async () => ({ data: { id: 'sched-1' }, error: null })),
    })),
  }));
  const slotInsert = vi.fn((rows: unknown) => {
    captured.slotRows.push(rows);
    return {
      select: vi.fn(() => ({
        single: vi.fn(async () =>
          opts?.slotError
            ? { data: null, error: { message: 'slot boom' } }
            : { data: { id: 'slot-1', slot_at: '2026-10-02T19:00:00.000Z' }, error: null },
        ),
      })),
    };
  });
  const scheduleDelete = vi.fn(() => ({
    eq: vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) })),
  }));
  const from = vi.fn((table: string) => {
    if (table === 'schedules') return { insert: scheduleInsert, delete: scheduleDelete };
    if (table === 'scheduled_posts') return { insert: slotInsert };
    throw new Error(`unexpected table ${table}`);
  });
  return { from, scheduleInsert, slotInsert, scheduleDelete };
}

const captured: { slotRows: unknown[] } = { slotRows: [] };

describe('createScheduleFromTask', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    captured.slotRows = [];
  });

  it('creates a batch schedule and a generating slot linked to the task', async () => {
    const client = mockClient();
    const supabase = { from: client.from } as never;

    const result = await createScheduleFromTask({ supabase, ...BASE_PARAMS });

    expect(result).toMatchObject({ scheduleId: expect.any(String), slotId: 'slot-1' });

    const schedulePayload = client.scheduleInsert.mock.calls[0][0] as Record<string, unknown>;
    expect(schedulePayload).toMatchObject({
      user_id: 'user-1',
      persona_id: 'p-1',
      kind: 'batch',
      providers: ['youtube', 'bluesky'],
      youtube_account_ids: ['yt-1'],
      bluesky_account_ids: ['did:plc:abc'],
      timezone: 'Europe/Lisbon',
      active: true,
    });

    const slotRow = captured.slotRows[0] as Record<string, unknown>;
    expect(slotRow).toMatchObject({
      status: 'generating',
      task_id: 'task-1',
      topic: 'launch video',
    });
  });

  it('accepts a null personaId for faceless videos', async () => {
    const client = mockClient();
    const supabase = { from: client.from } as never;

    await createScheduleFromTask({ supabase, ...BASE_PARAMS, personaId: null });

    const schedulePayload = client.scheduleInsert.mock.calls[0][0] as Record<string, unknown>;
    expect(schedulePayload.persona_id).toBeNull();
  });

  it('rolls back the schedule when the slot insert fails', async () => {
    const client = mockClient({ slotError: true });
    const supabase = { from: client.from } as never;

    await expect(createScheduleFromTask({ supabase, ...BASE_PARAMS })).rejects.toThrow(
      /Failed to create slot/,
    );
    expect(client.scheduleDelete).toHaveBeenCalled();
  });
});
