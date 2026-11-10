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
      fullLipsync: true,
      musicMood: 'calm',
      chargedTokens: 1,
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
      faceless_material: 'images',
      full_lipsync: true,
      music_mood: 'calm',
      charged_tokens: 1,
      segments: [
        { kind: 'hook', text: 'Porto wins you over slowly.' },
        { kind: 'body', text: 'Walk the Ribeira in the morning light.' },
        { kind: 'cta', text: 'Follow for more.' },
      ],
      experiment_id: null,
      variant_id: null,
      experiment_pair: null,
    });
  });

  it('stores null segments when the request carries none', () => {
    const rows = buildSlotRows({
      slots: [{ slotAtISO: '2026-09-08T09:00:00.000Z', dayIndex: 0, timeIndex: 0 }],
      title: 'Porto walks',
      scheduleId: 'sched-1',
      userId: 'user-1',
      faceless: false,
      chargedTokens: 2,
      segments: undefined,
    });
    expect(rows[0]?.segments).toBeNull();
    expect(rows[0]?.faceless_material).toBe('images');
    expect(rows[0]?.full_lipsync).toBe(false);
    expect(rows[0]?.music_mood).toBeNull();
  });

  it('writes the experiment link columns when the video joins an experiment', () => {
    const rows = buildSlotRows({
      slots: [{ slotAtISO: '2026-09-08T09:00:00.000Z', dayIndex: 0, timeIndex: 0 }],
      title: 'Porto walks',
      scheduleId: 'sched-1',
      userId: 'user-1',
      faceless: false,
      chargedTokens: 2,
      segments: undefined,
      experiment: { experimentId: '7b0e6c1e-0000-4000-8000-000000000001', variantId: 'hook-aggressive', pair: 2 },
    });
    expect(rows[0]).toMatchObject({
      experiment_id: '7b0e6c1e-0000-4000-8000-000000000001',
      variant_id: 'hook-aggressive',
      experiment_pair: 2,
    });
  });

  it('writes the charged amount on every row, including a free (0) slot', () => {
    const rows = buildSlotRows({
      slots: [
        { slotAtISO: '2026-09-08T09:00:00.000Z', dayIndex: 0, timeIndex: 0 },
        { slotAtISO: '2026-09-09T09:00:00.000Z', dayIndex: 1, timeIndex: 0 },
      ],
      title: 'Porto walks',
      scheduleId: 'sched-1',
      userId: 'user-1',
      faceless: false,
      chargedTokens: 0,
      segments: undefined,
    });
    expect(rows.map((row) => row.charged_tokens)).toEqual([0, 0]);
  });
});
