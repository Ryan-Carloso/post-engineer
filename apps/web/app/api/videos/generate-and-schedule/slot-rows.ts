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
  /** Tokens this slot was charged (migration 044); every refund reads it. */
  chargedTokens: number;
  segments: ScriptSegment[] | undefined;
  /** Paired A/B experiment link (migration 041), checked before the charge. */
  experiment?: ExperimentLink;
}

// One row per slot, pending. The id is database-generated; the returned
// rows carry it for the per-slot dispatch below.
// `faceless` is stored ON the slot, not derived from the persona at read
// time: it is a per-post choice the engine's batch pipeline reads back.
// `charged_tokens` (migration 044) is what the slot was charged: every
// refund path reads it instead of recomputing a price. `segments` rides
// the same row so the batch pipeline can forward it (migration 030), and
// `title` is the slot label (migration 031). `fullLipsync` rides the same
// row (migration 035) so a tick-dispatched or requeued slot keeps full
// lip-sync instead of silently falling back to intro-only b-roll.
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
    charged_tokens: input.chargedTokens,
    segments: input.segments ?? null,
    experiment_id: input.experiment?.experimentId ?? null,
    variant_id: input.experiment?.variantId ?? null,
    experiment_pair: input.experiment?.pair ?? null,
  }));
}
