import { describe, it, expect } from 'vitest';
import { APPROVAL_SLOT_GRACE_MS, awaitingSlots, isSlotExpired } from '@/lib/approval-queue';
import type { ScheduledSlot } from '@/lib/api';

function slot(partial: Partial<ScheduledSlot> = {}): ScheduledSlot {
  return {
    id: 'slot-1',
    scheduleId: 's1',
    slotAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    status: 'ready',
    title: 'T',
    ...partial,
  };
}

describe('isSlotExpired', () => {
  it('keeps a future slot and one inside the 5-minute grace', () => {
    const now = Date.now();
    expect(isSlotExpired(slot(), now)).toBe(false);
    expect(isSlotExpired(slot({ slotAt: new Date(now - 4 * 60 * 1000).toISOString() }), now)).toBe(false);
  });

  it('expires a slot past the 5-minute grace', () => {
    const now = Date.now();
    expect(isSlotExpired(slot({ slotAt: new Date(now - APPROVAL_SLOT_GRACE_MS - 1000).toISOString() }), now)).toBe(true);
  });
});

describe('awaitingSlots', () => {
  it('keeps only awaiting_approval slots, earliest first', () => {
    const late = slot({ id: 'late', status: 'awaiting_approval', slotAt: '2030-06-02T10:00:00.000Z' });
    const early = slot({ id: 'early', status: 'awaiting_approval', slotAt: '2030-06-01T10:00:00.000Z' });
    const ready = slot({ id: 'ready', status: 'ready' });
    const cancelled = slot({ id: 'cancelled', status: 'cancelled' });

    expect(awaitingSlots([late, ready, early, cancelled]).map((item) => item.id)).toEqual(['early', 'late']);
  });
});
