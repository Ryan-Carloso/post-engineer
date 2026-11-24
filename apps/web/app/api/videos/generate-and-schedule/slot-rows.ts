import type { DistributedSlot } from '@/lib/schedule/slot-distribution';
import type { ScriptSegment } from '@/lib/generation/script-segments';
import type { VideoType } from '@/lib/tokens';
import type { LipsyncPhotoRef } from './lipsync-photos';

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
  lipsyncPhotos?: LipsyncPhotoRef[];
  promptVersionId?: string;
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
    voiceover: input.videoType === 'voiceover',
    full_lipsync: input.videoType === 'full_lipsync',
    music_mood: input.musicMood ?? null,
    charged_tokens: input.chargedTokens,
    segments: input.segments ?? null,
    lipsync_photos: input.lipsyncPhotos ?? null,
    prompt_version_id: input.promptVersionId ?? null,
  }));
}
