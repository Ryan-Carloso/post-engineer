import type { DistributedSlot } from '@/lib/schedule/slot-distribution';
import type { ScriptSegment } from '@/lib/generation/script-segments';
import type { VideoType } from '@/lib/tokens';
import type { ExperimentLink } from './experiment-link';

export interface SlotRowInput {
  slots: DistributedSlot[];
  title: string;
  description: string;
  scheduleId: string;
  userId: string;
  videoType: VideoType;
  musicMood?: string;
  chargedTokens: number;
  segments: ScriptSegment[] | undefined;
  experiment?: ExperimentLink;
}

export function buildSlotRows(input: SlotRowInput) {
  return input.slots.map((slot) => ({
    schedule_id: input.scheduleId,
    user_id: input.userId,
    slot_at: slot.slotAtISO,
    status: 'pending',
    title: input.title,
    description: input.description,
    video_type: input.videoType,
    faceless: input.videoType === 'faceless',
    full_lipsync: input.videoType === 'full_lipsync',
    music_mood: input.musicMood ?? null,
    charged_tokens: input.chargedTokens,
    segments: input.segments ?? null,
    experiment_id: input.experiment?.experimentId ?? null,
    variant_id: input.experiment?.variantId ?? null,
    experiment_pair: input.experiment?.pair ?? null,
  }));
}
