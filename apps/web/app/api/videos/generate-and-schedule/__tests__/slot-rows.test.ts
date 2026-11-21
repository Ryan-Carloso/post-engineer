import { describe, it, expect } from 'vitest';
import { buildSlotRows } from '../slot-rows';

describe('buildSlotRows', () => {
  it('builds one pending row per slot with every per-post field', () => {
    const rows = buildSlotRows({
      slots: [
        { slotAtISO: '2026-09-08T09:00:00.000Z', dayIndex: 0, timeIndex: 0 },
      ],
      title: 'Porto walks',
      description: 'Agent description.',
      scheduleId: 'sched-1',
      userId: 'user-1',
      videoType: 'faceless',
      musicMood: 'calm',
      chargedTokens: 1,
      segments: [
        { kind: 'hook', text: 'Porto wins you over slowly.' },
        { kind: 'content', text: 'Walk the Ribeira in the morning light.' },
        { kind: 'content', text: 'Follow for more.' },
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      schedule_id: 'sched-1',
      user_id: 'user-1',
      slot_at: '2026-09-08T09:00:00.000Z',
      status: 'pending',
      title: 'Porto walks',
      description: 'Agent description.',
      video_type: 'faceless',
      faceless: true,
      full_lipsync: false,
      music_mood: 'calm',
      charged_tokens: 1,
      segments: [
        { kind: 'hook', text: 'Porto wins you over slowly.' },
        { kind: 'content', text: 'Walk the Ribeira in the morning light.' },
        { kind: 'content', text: 'Follow for more.' },
      ],
      prompt_version_id: null,
    });
  });

  it('derives the stored faceless/full_lipsync flags from the video mode', () => {
    const faceless = buildSlotRows({
      slots: [{ slotAtISO: '2026-09-08T09:00:00.000Z', dayIndex: 0, timeIndex: 0 }],
      title: 'Porto walks',
      description: 'Agent description.',
      scheduleId: 'sched-1',
      userId: 'user-1',
      videoType: 'faceless',
      chargedTokens: 1,
      segments: undefined,
    });
    expect(faceless[0]).toMatchObject({ video_type: 'faceless', faceless: true, full_lipsync: false });

    const full = buildSlotRows({
      slots: [{ slotAtISO: '2026-09-08T09:00:00.000Z', dayIndex: 0, timeIndex: 0 }],
      title: 'Porto walks',
      description: 'Agent description.',
      scheduleId: 'sched-1',
      userId: 'user-1',
      videoType: 'full_lipsync',
      chargedTokens: 8,
      segments: undefined,
    });
    expect(full[0]).toMatchObject({ video_type: 'full_lipsync', faceless: false, full_lipsync: true });

    const hook = buildSlotRows({
      slots: [{ slotAtISO: '2026-09-08T09:00:00.000Z', dayIndex: 0, timeIndex: 0 }],
      title: 'Porto walks',
      description: 'Agent description.',
      scheduleId: 'sched-1',
      userId: 'user-1',
      videoType: 'hook_lipsync',
      chargedTokens: 2,
      segments: undefined,
    });
    expect(hook[0]).toMatchObject({ video_type: 'hook_lipsync', faceless: false, full_lipsync: false });
  });

  it('does not write faceless_material: the column default is images', () => {
    const rows = buildSlotRows({
      slots: [{ slotAtISO: '2026-09-08T09:00:00.000Z', dayIndex: 0, timeIndex: 0 }],
      title: 'Porto walks',
      description: 'Agent description.',
      scheduleId: 'sched-1',
      userId: 'user-1',
      videoType: 'hook_lipsync',
      chargedTokens: 2,
      segments: undefined,
    });
    expect(rows[0]).not.toHaveProperty('faceless_material');
  });

  it('stores null segments when the request carries none', () => {
    const rows = buildSlotRows({
      slots: [{ slotAtISO: '2026-09-08T09:00:00.000Z', dayIndex: 0, timeIndex: 0 }],
      title: 'Porto walks',
      description: 'Agent description.',
      scheduleId: 'sched-1',
      userId: 'user-1',
      videoType: 'hook_lipsync',
      chargedTokens: 2,
      segments: undefined,
    });
    expect(rows[0]?.segments).toBeNull();
    expect(rows[0]?.video_type).toBe('hook_lipsync');
    expect(rows[0]?.faceless).toBe(false);
    expect(rows[0]?.full_lipsync).toBe(false);
    expect(rows[0]?.music_mood).toBeNull();
    expect(rows[0]?.description).toBe('Agent description.');
  });

  it('writes the prompt version the script was written from', () => {
    const rows = buildSlotRows({
      slots: [{ slotAtISO: '2026-09-08T09:00:00.000Z', dayIndex: 0, timeIndex: 0 }],
      title: 'Porto walks',
      description: 'Agent description.',
      scheduleId: 'sched-1',
      userId: 'user-1',
      videoType: 'hook_lipsync',
      chargedTokens: 2,
      segments: undefined,
      promptVersionId: '7b0e6c1e-0000-4000-8000-000000000001',
    });
    expect(rows[0]).toMatchObject({ prompt_version_id: '7b0e6c1e-0000-4000-8000-000000000001' });
  });

  it('writes the charged amount on every row, including a free (0) slot', () => {
    const rows = buildSlotRows({
      slots: [
        { slotAtISO: '2026-09-08T09:00:00.000Z', dayIndex: 0, timeIndex: 0 },
        { slotAtISO: '2026-09-09T09:00:00.000Z', dayIndex: 1, timeIndex: 0 },
      ],
      title: 'Porto walks',
      description: 'Agent description.',
      scheduleId: 'sched-1',
      userId: 'user-1',
      videoType: 'hook_lipsync',
      chargedTokens: 0,
      segments: undefined,
    });
    expect(rows.map((row) => row.charged_tokens)).toEqual([0, 0]);
  });
});
