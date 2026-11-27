import type { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

import { apiErrorResponse } from '@/lib/api-error';
import { ERROR_CODES, formatErrorMessage } from '@/lib/error-codes';
import { logger } from '@/lib/logger';
import { createSupabaseVideoUploadStore } from '@/lib/videos/signed-upload';
import { SCHEDULED_UPLOAD_EXPIRY_MS } from '@/lib/videos/upload-expiry';
import { UPLOAD_SLOT_REFERENCE_INDEX, uploadAlreadyScheduledError } from '@/lib/videos/upload-slot-reference';
import { violatedConstraint } from './constraint-violations';
import type { PublishExistingContext } from './context';
import { ExistingMediaError, SCHEDULED_IMAGE_BUCKET, storeScheduledImage } from './media-resolve';
import type { ScheduledMediaKind } from './schema';

export interface StagedSlotMedia {
  kind: ScheduledMediaKind | null;
  ref: string | null;
  contentType: string | null;
  storedImagePath: string | null;
}

export function slotMediaColumns(media: StagedSlotMedia): { media_kind: ScheduledMediaKind | null; media_ref: string | null; media_content_type: string | null } {
  return { media_kind: media.kind, media_ref: media.ref, media_content_type: media.contentType };
}

export async function stageSlotMedia(ctx: PublishExistingContext, slotAtISO: string): Promise<{ media: StagedSlotMedia } | { error: NextResponse }> {
  const route = ctx.route;
  try {
    if (ctx.uploadRow !== null) {
      const extended = await createSupabaseVideoUploadStore().updateUpload(ctx.uploadRow.id, 'ready', {
        expires_at: new Date(Date.parse(slotAtISO) + SCHEDULED_UPLOAD_EXPIRY_MS).toISOString(),
      });
      if (!extended) {
        return {
          error: apiErrorResponse(409, formatErrorMessage(ERROR_CODES.VIDEO_UPLOAD_CONSUMED), {
            route,
            code: ERROR_CODES.VIDEO_UPLOAD_CONSUMED,
            field: 'media.uploadId',
          }),
        };
      }
      const contentType = ctx.uploadRow.declared_content_type ?? ctx.uploadRow.detected_content_type ?? 'video/mp4';
      return { media: { kind: 'upload', ref: ctx.uploadRow.id, contentType, storedImagePath: null } };
    }
    if (ctx.image !== null) {
      const storedImagePath = await storeScheduledImage(ctx.supabase, ctx.userId, ctx.image.buffer, ctx.image.contentType);
      return { media: { kind: 'image', ref: storedImagePath, contentType: ctx.image.contentType, storedImagePath } };
    }
    return { media: { kind: null, ref: null, contentType: null, storedImagePath: null } };
  } catch (error) {
    if (error instanceof ExistingMediaError) {
      return { error: apiErrorResponse(error.status, error.message, { route, code: error.code }) };
    }
    throw error;
  }
}

export async function discardStagedImage(supabase: SupabaseClient, media: StagedSlotMedia, scheduleId: string, userId: string): Promise<void> {
  if (media.storedImagePath === null) return;
  await supabase.storage
    .from(SCHEDULED_IMAGE_BUCKET)
    .remove([media.storedImagePath])
    .catch((error: unknown) => logger.error('[publish-existing] stored image cleanup failed', error, { scheduleId, userId }));
}

export async function rollbackSlotInsert(
  ctx: PublishExistingContext,
  slotsError: Parameters<typeof violatedConstraint>[0],
  media: StagedSlotMedia,
  scheduleId: string,
): Promise<NextResponse> {
  const { supabase, userId, route } = ctx;
  const uploadTaken = violatedConstraint(slotsError) === UPLOAD_SLOT_REFERENCE_INDEX;
  if (!uploadTaken) logger.error('[publish-existing] slot insert failed', slotsError, { scheduleId, userId });
  await supabase.from('schedules').delete().eq('id', scheduleId).eq('user_id', userId);
  await discardStagedImage(supabase, media, scheduleId, userId);
  if (uploadTaken) {
    const taken = uploadAlreadyScheduledError();
    return apiErrorResponse(taken.status, taken.message, { route, code: taken.code, field: 'media.uploadId' });
  }
  return apiErrorResponse(500, formatErrorMessage(ERROR_CODES.INTERNAL_ERROR), {
    route,
    code: ERROR_CODES.INTERNAL_ERROR,
  });
}
