//---------------
// buildSlotRows — the scheduled_posts insert rows. The extraction from
// route.ts (file-size ratchet) must not drop a field: every row carries
// the per-post choices the engine batch pipeline reads back.
//---------------

import { describe, it, expect } from 'vitest';
import { buildSlotRows } from '../slot-rows';

describe('buildSlotRows', () => {
  it('builds one pending row per slot with every per-post field', () => {
    const rows = buildSlotRows({
      slots: [
        { slotAtISO: '2026-09-08T09:00:00.000Z', dayIndex: 0, timeIndex: 0 },
      ],
      title: 'Porto walks',
      scheduleId: 'sched-1',
      userId: 'user-1',
      faceless: true,
      facelessMaterial: 'svg',
      segments: [
        { kind: 'hook', text: 'Porto wins you over slowly.' },
        { kind: 'body', text: 'Walk the Ribeira in the morning light.' },
        { kind: 'cta', text: 'Follow for more.' },
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      schedule_id: 'sched-1',
      user_id: 'user-1',
      slot_at: '2026-09-08T09:00:00.000Z',
      status: 'pending',
      title: 'Porto walks',
      faceless: true,
      faceless_material: 'svg',
      segments: [
        { kind: 'hook', text: 'Porto wins you over slowly.' },
        { kind: 'body', text: 'Walk the Ribeira in the morning light.' },
        { kind: 'cta', text: 'Follow for more.' },
      ],
    });
  });

  it('stores null segments when the request carries none', () => {
    const rows = buildSlotRows({
      slots: [{ slotAtISO: '2026-09-08T09:00:00.000Z', dayIndex: 0, timeIndex: 0 }],
      title: 'Porto walks',
      scheduleId: 'sched-1',
      userId: 'user-1',
      faceless: false,
      facelessMaterial: undefined,
      segments: undefined,
    });
    expect(rows[0]?.segments).toBeNull();
    expect(rows[0]?.faceless_material).toBeUndefined();
  });
});
