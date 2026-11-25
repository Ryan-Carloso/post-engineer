import type { SupabaseClient } from '@supabase/supabase-js';

import type { GenerateAndScheduleBody } from '@/lib/contracts/videos';
import { refundSlotTokens } from '@/lib/billing/refund-tokens';
import { ensureEngineImageUrl } from '@/lib/engine-image-url';
import {
  buildJobPayload,
  hasNonEmptyString,
  type JobPersona,
} from '@/lib/generation/video-job-payload';
import {
  recordGenerationStart,
  recordGenerationUpdate,
  startEngineVideoTask,
} from '@/lib/generation/video-generation';
import { logger } from '@/lib/logger';
import { recordRecentImageId, resolveVideoImage } from '@/lib/persona-images';
import type { ResolvedCta } from './cta-validation';
import { isEngineRejection } from './dispatch-failure';
import { buildGenerateJobRequest } from './job-request';
import type { ValidatedOptions } from './options-validation';
import { signedUrl, type PersonaPrep } from './persona-prep';
import { SlotDispatchError } from './prepare-persona';

export type PublishMode = 'scheduled' | 'asap';

export interface SlotResult {
  slotId: string;
  slotAt: string;
  title: string;
  taskId: string | null;
  status: string;
  errorCode?: string;
  tokensRefunded?: boolean;
}

export interface SlotDispatchContext {
  supabase: SupabaseClient;
  userId: string;
  personaId: string | null;
  prep: PersonaPrep;
  validatedOptions: ValidatedOptions;
  effectiveCta: ResolvedCta | null;
  requestedImageId: string | null;
  generationId: string;
  scheduleId: string;
  perVideoCost: number;
  mode: PublishMode;
  recentIds: string[];
}

export interface SlotDispatchInput {
  id: string;
  slotAt: string;
  title: string;
  description: string;
  script: string;
  segments: NonNullable<GenerateAndScheduleBody['options']>['segments'];
}

export async function dispatchSlot(
  ctx: SlotDispatchContext,
  slot: SlotDispatchInput,
): Promise<SlotResult> {
  const { supabase, userId, personaId, prep, validatedOptions, scheduleId } = ctx;
  const slotGenerationId = `${ctx.generationId}:slot:${slot.id}`;
  try {
    let photoUrl: string | undefined;
    let pickedImageId: string | null = null;
    if (validatedOptions.videoType !== 'voiceover' && personaId !== null) {
      const selection = await resolveVideoImage(supabase, personaId, userId, ctx.recentIds, {
        title: slot.title,
        niche: prep.niche,
        script: slot.script,
        imageId: ctx.requestedImageId,
      });
      if (!selection.ok) {
        throw new SlotDispatchError('image_resolve_failed', selection.error);
      }
      if (selection.image) {
        const libraryUrl = await signedUrl(supabase, selection.image.image_path);
        if (!libraryUrl) {
          throw new SlotDispatchError('image_sign_failed', 'The selected persona image could not be loaded. Please try again.');
        }
        photoUrl = libraryUrl;
        if (!ctx.requestedImageId) pickedImageId = selection.image.id;
      } else {
        const hosted = await ensureEngineImageUrl(prep.avatarUrl, {
          supabase,
          userId,
        }).catch((error: unknown) => {
          throw new SlotDispatchError(
            'photo_resolve_failed',
            error instanceof Error ? error.message : 'The chosen character could not be loaded.',
          );
        });
        photoUrl = hosted ?? (await signedUrl(supabase, prep.photoPath)) ?? undefined;
      }
      if (!photoUrl && prep.photoRequired) {
        throw new SlotDispatchError('photo_missing', 'Persona photo could not be loaded. Please try again.');
      }
    }

    const jobPersona: JobPersona = {
      name: prep.personaName,
      photo_url: photoUrl,
      voice_id: prep.voiceAudioUrl ? undefined : prep.voiceIdValue,
      voice_audio_url: prep.voiceAudioUrl,
      language: prep.language,
      video_aspect: prep.videoAspect,
      video_layout: prep.videoLayout,
      hook_panel: prep.hookPanel,
      paragraph_number: prep.paragraphNumber,
      niche: prep.niche,
      face_quality: prep.faceQuality,
    };
    const payload = buildJobPayload(jobPersona, buildGenerateJobRequest({
      title: slot.title,
      description: slot.description,
      validatedOptions,
      segmentsScript: slot.script,
      ctaType: ctx.effectiveCta?.type ?? null,
      generationId: slotGenerationId,
      slotId: slot.id,
      segments: slot.segments,
    }));
    if (!hasNonEmptyString(payload.video_title)) {
      throw new SlotDispatchError('empty_title', 'Video title is empty.');
    }

    await recordGenerationStart({
      supabase,
      userId,
      generationId: slotGenerationId,
      personaId,
      personaName: prep.personaName,
      videoSubject: slot.title,
      persistence: { params: payload, mode: ctx.mode, slotAt: slot.slotAt },
    });

    const engineTask = await startEngineVideoTask(userId, payload);
    if (!engineTask.ok || !engineTask.taskId) {
      const errorCode = !engineTask.ok
        ? isEngineRejection(engineTask.upstreamStatus)
          ? 'engine_rejected'
          : 'engine_unavailable'
        : 'no_task_id';
      throw new SlotDispatchError(errorCode, 'Video service is unavailable. Please try again later.');
    }

    const { error: bindError } = await supabase
      .from('scheduled_posts')
      .update({ status: 'generating', task_id: engineTask.taskId })
      .eq('id', slot.id)
      .eq('user_id', userId);
    if (bindError) {
      logger.error('[generate-and-schedule] task_id bind failed after engine accept', bindError, {
        slotId: slot.id,
        taskId: engineTask.taskId,
        scheduleId,
      });
      throw new SlotDispatchError('bind_failed', 'Video generation started but the slot could not be linked. Contact support with the schedule ID.');
    }

    await recordGenerationUpdate({
      supabase,
      generationId: slotGenerationId,
      status: 'running',
      engineTaskId: engineTask.taskId,
    });
    if (pickedImageId && personaId !== null) {
      await recordRecentImageId(supabase, personaId, pickedImageId, userId);
      ctx.recentIds.push(pickedImageId);
    }

    return { slotId: slot.id, slotAt: slot.slotAt, title: slot.title, taskId: engineTask.taskId, status: 'generating' };
  } catch (error) {
    const dispatchError = error instanceof SlotDispatchError ? error : new SlotDispatchError('slot_failed', 'Video generation failed for this slot.');
    await supabase.from('scheduled_posts').update({ status: 'failed' }).eq('id', slot.id).eq('user_id', userId);
    const { refunded, error: refundError } = await refundSlotTokens({
      supabase,
      userId,
      scheduleId,
      slotId: slot.id,
      amount: ctx.perVideoCost,
      reason: 'Unified generate+schedule: slot dispatch failed; video refunded',
      kind: 'dispatch_failed',
    });
    if (refundError) {
      logger.error('[generate-and-schedule] per-slot refund failed', refundError, {
        slotId: slot.id,
        generationId: ctx.generationId,
        userId,
      });
    }
    await recordGenerationUpdate({
      supabase,
      generationId: slotGenerationId,
      status: 'failed',
      errorCode: dispatchError.errorCode,
      errorMessage: dispatchError.message,
      tokensRefunded: refunded,
    });
    logger.error('[generate-and-schedule] slot dispatch failed', error, {
      slotId: slot.id,
      title: slot.title,
      scheduleId,
      errorCode: dispatchError.errorCode,
    });
    return {
      slotId: slot.id,
      slotAt: slot.slotAt,
      title: slot.title,
      taskId: null,
      status: 'failed',
      errorCode: dispatchError.errorCode,
      tokensRefunded: refunded,
    };
  }
}
