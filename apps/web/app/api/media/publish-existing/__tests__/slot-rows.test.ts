import { describe, it, expect } from 'vitest';
import { buildSlotRows } from '../slot-rows';

const SLOT = { slotAtISO: '2026-09-08T09:00:00.000Z', dayIndex: 0, timeIndex: 0 };

describe('buildSlotRows', () => {
  it('builds one pending row per slot with the post fields', () => {
    const rows = buildSlotRows({
      slots: [SLOT],
      title: 'Porto walks',
      description: 'Agent description.',
      scheduleId: 'sched-1',
      userId: 'user-1',
    });
    expect(rows).toEqual([
      {
        schedule_id: 'sched-1',
        user_id: 'user-1',
        slot_at: '2026-09-08T09:00:00.000Z',
        status: 'pending',
        title: 'Porto walks',
        description: 'Agent description.',
        prompt_version_id: null,
      },
    ]);
  });

  it('stores the prompt version on every slot row when one is given', () => {
    const rows = buildSlotRows({
      slots: [SLOT, { ...SLOT, slotAtISO: '2026-09-09T09:00:00.000Z', dayIndex: 1 }],
      title: 'Porto walks',
      description: '',
      scheduleId: 'sched-1',
      userId: 'user-1',
      promptVersionId: 'version-1',
    });
    expect(rows.map((row) => row.prompt_version_id)).toEqual(['version-1', 'version-1']);
  });
});
