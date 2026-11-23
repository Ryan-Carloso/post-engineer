import type { GenerateAndScheduleBody } from '@/lib/contracts/videos';
import type { ValidatedOptions } from './options-validation';

export interface GenerateJobRequestInput {
  title: string;
  description: string;
  validatedOptions: ValidatedOptions;
  segmentsScript: string;
  ctaType: string | null;
  generationId: string;
  slotId: string;
  segments: NonNullable<GenerateAndScheduleBody['options']>['segments'];
}

export function buildGenerateJobRequest(input: GenerateJobRequestInput): Record<string, unknown> {
  const { title, description, validatedOptions, segmentsScript, ctaType, generationId, slotId, segments } = input;
  return {
    video_title: title, video_description: description,
    video_type: validatedOptions.videoType,
    video_script: segmentsScript,
    webhook_url: validatedOptions.webhookUrl,
    cta_type: ctaType,
    generation_id: generationId,
    slot_id: slotId,
    music_mood: validatedOptions.musicMood,
    segments,
    lipsync_photos: validatedOptions.lipsyncPhotos,
    video_clip_duration: validatedOptions.videoClipDuration,
    video_transition_mode: validatedOptions.videoTransitionMode,
    video_variation_seed: validatedOptions.videoVariationSeed,
  };
}
