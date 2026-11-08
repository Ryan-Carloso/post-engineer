//---------------
// Slot row for the scheduled_posts insert — extracted from route.ts so
// the route stays under the file-size ratchet.
//---------------

import type { FacelessMaterial } from '@/lib/generation/faceless-materials';
import type { DistributedSlot } from '@/lib/schedule/slot-distribution';
import type { ScriptSegment } from '@/lib/generation/script-segments';
import type { ExperimentLink } from './experiment-link';

export interface SlotRowInput {
  slots: DistributedSlot[];
  title: string;
  scheduleId: string;
  userId: string;
  faceless: boolean;
  facelessMaterial: FacelessMaterial | undefined;
  fullLipsync?: boolean;
  /** Requested BGM mood (issue #489); null means the engine default. */
  musicMood?: string;
  segments: ScriptSegment[] | undefined;
  /** Paired A/B experiment link (migration 041), checked before the charge. */
  experiment?: ExperimentLink;
}

// One row per slot, pending. The id is database-generated; the returned
// rows carry it for the per-slot dispatch below.
// `faceless` is stored ON the slot, not derived from the persona at read
// time: it is a per-post choice, and the engine's batch pipeline reads it
// from this row when it prices a slot's failure refund. `segments` rides
// the same row so the batch pipeline can forward it (migration 030), and
// `title` is the slot label (migration 031). `fullLipsync` rides the same
// row (migration 035) so a tick-dispatched or requeued slot keeps full
// lip-sync instead of silently falling back to intro-only b-roll.
// `musicMood` rides the same row (migration 045) so a tick-dispatched or
// requeued slot keeps the requested BGM mood instead of silently falling
// back to the engine's default mood.
export function buildSlotRows(input: SlotRowInput) {
  return input.slots.map((slot) => ({
    schedule_id: input.scheduleId,
    user_id: input.userId,
    slot_at: slot.slotAtISO,
    status: 'pending',
    title: input.title,
    faceless: input.faceless,
    faceless_material: input.facelessMaterial,
    full_lipsync: input.fullLipsync ?? false,
    music_mood: input.musicMood ?? null,
    segments: input.segments ?? null,
    experiment_id: input.experiment?.experimentId ?? null,
    variant_id: input.experiment?.variantId ?? null,
    experiment_pair: input.experiment?.pair ?? null,
  }));
}
