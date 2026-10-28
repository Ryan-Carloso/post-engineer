//---------------
// Slot rows for the scheduled_posts insert — extracted from route.ts so
// the route stays under the file-size ratchet.
//---------------

import type { DistributedSlot } from '@/lib/schedule/slot-distribution';
import type { ScriptSegment } from '@/lib/generation/script-segments';

export interface SlotRowInput {
  slots: DistributedSlot[];
  topics: string[];
  scheduleId: string;
  userId: string;
  faceless: boolean;
  facelessMaterial: 'broll' | 'svg' | undefined;
  segments: ScriptSegment[] | undefined;
}

// One row per slot, pending. The id is database-generated; the returned
// rows carry it for the per-slot dispatch below.
// `faceless` is stored ON the slot, not derived from the persona at read
// time: it is a per-post choice, and the engine's batch pipeline reads it
// from this row when it prices a slot's failure refund. `segments` rides
// the same row so the batch pipeline can forward it (migration 030).
export function buildSlotRows(input: SlotRowInput) {
  return input.slots.map((slot, i) => ({
    schedule_id: input.scheduleId,
    user_id: input.userId,
    slot_at: slot.slotAtISO,
    status: 'pending',
    topic: input.topics[i],
    faceless: input.faceless,
    faceless_material: input.facelessMaterial,
    segments: input.segments ?? null,
  }));
}
