import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

import { apiErrorResponse } from '@/lib/api-error';
import { ERROR_CODES, formatErrorMessage } from '@/lib/error-codes';
import { logger } from '@/lib/logger';
import { createSupabaseVideoUploadStore } from '@/lib/videos/signed-upload';
import { SCHEDULED_UPLOAD_EXPIRY_MS } from '@/lib/videos/upload-expiry';
import {
  UPLOAD_SLOT_REFERENCE_INDEX,
  uploadAlreadyScheduledError,
} from '@/lib/videos/upload-slot-reference';
import { scheduleAccountColumns } from './account-columns';
import {
  SCHEDULE_PK_CONSTRAINT,
  violatedConstraint,
} from './constraint-violations';
import type { PublishExistingContext } from './context';
import { buildSlotRows } from './slot-rows';
import {
  ExistingMediaError,
  SCHEDULED_IMAGE_BUCKET,
  storeScheduledImage,
} from './media-resolve';
import type { ScheduledMediaKind } from './schema';

const ZOMBIE_SCHEDULE_MIN_AGE_MS = 5 * 60_000;

function holdResponse(slot: { id: string; slotAt: string; status: string }, replayed: boolean): NextResponse {
  return NextResponse.json({
    success: true,
    mode: 'asap',
    approvalRequired: true,
    ...(replayed ? { replayed: true } : {}),
    slot: { id: slot.id, slotAt: slot.slotAt, status: slot.status },
  });
}

export async function replayAsapHold(
  supabase: SupabaseClient,
  scheduleId: string,
  userId: string,
  route: string,
): Promise<NextResponse | null> {
  const { data: existing, error: existingError } = await supabase
    .from('schedules')
    .select('id, created_at')
    .eq('id', scheduleId)
    .eq('user_id', userId)
    .maybeSingle();
  if (existingError) {
    logger.error('[publish-existing] idempotency lookup failed', existingError, { scheduleId, userId });
    return apiErrorResponse(500, formatErrorMessage(ERROR_CODES.INTERNAL_ERROR), {
      route,
      code: ERROR_CODES.INTERNAL_ERROR,
    });
  }
  if (!existing) return null;
  const { data: slots, error: slotsError } = await supabase
    .from('scheduled_posts')
    .select('id, slot_at, status')
    .eq('schedule_id', scheduleId)
    .order('slot_at');
  if (slotsError) {
    logger.error('[publish-existing] replay slots lookup failed', slotsError, { scheduleId, userId });
    return apiErrorResponse(500, formatErrorMessage(ERROR_CODES.INTERNAL_ERROR), {
      route,
      code: ERROR_CODES.INTERNAL_ERROR,
    });
  }
  const rows = Array.isArray(slots) ? slots : [];
  if (rows.length === 0) {
    const createdAt = (existing as { created_at?: unknown }).created_at;
    const createdAtMs = typeof createdAt === 'string' ? Date.parse(createdAt) : Number.NaN;
    if (!Number.isNaN(createdAtMs) && Date.now() - createdAtMs >= ZOMBIE_SCHEDULE_MIN_AGE_MS) {
      await supabase
        .from('schedules')
        .delete()
        .eq('id', scheduleId)
        .eq('user_id', userId)
        .lt('created_at', new Date(Date.now() - ZOMBIE_SCHEDULE_MIN_AGE_MS).toISOString());
    }
    return null;
  }
  const first = rows[0] as { id: unknown; slot_at: unknown; status: unknown };
  return holdResponse(
    {
      id: String(first.id),
      slotAt: String(first.slot_at),
      status: typeof first.status === 'string' ? first.status : 'awaiting_approval',
    },
    true,
  );
}

export async function scheduleAsapHold(ctx: PublishExistingContext, scheduleId: string): Promise<NextResponse> {
  const { supabase, userId, input, accountIds } = ctx;
  const route = ctx.route;
  const slotAtISO = new Date().toISOString();
  const slotTime = slotAtISO.slice(11, 16);

  let mediaKindValue: ScheduledMediaKind | null = null;
  let mediaRef: string | null = null;
  let mediaContentType: string | null = null;
  let storedImagePath: string | null = null;
  const uploadStore = createSupabaseVideoUploadStore();
  try {
    if (ctx.uploadRow !== null) {
      mediaKindValue = 'upload';
      mediaRef = ctx.uploadRow.id;
      mediaContentType = ctx.uploadRow.declared_content_type ?? ctx.uploadRow.detected_content_type ?? 'video/mp4';
      const extended = await uploadStore.updateUpload(ctx.uploadRow.id, 'ready', {
        expires_at: new Date(Date.parse(slotAtISO) + SCHEDULED_UPLOAD_EXPIRY_MS).toISOString(),
      });
      if (!extended) {
        return apiErrorResponse(409, formatErrorMessage(ERROR_CODES.VIDEO_UPLOAD_CONSUMED), {
          route,
          code: ERROR_CODES.VIDEO_UPLOAD_CONSUMED,
          field: 'media.uploadId',
        });
      }
    } else if (ctx.image !== null) {
      mediaKindValue = 'image';
      mediaContentType = ctx.image.contentType;
      storedImagePath = await storeScheduledImage(supabase, userId, ctx.image.buffer, ctx.image.contentType);
      mediaRef = storedImagePath;
    }
  } catch (error) {
    if (error instanceof ExistingMediaError) {
      return apiErrorResponse(error.status, error.message, { route, code: error.code });
    }
    throw error;
  }

  const { error: scheduleError } = await supabase.from('schedules').insert({
    id: scheduleId,
    user_id: userId,
    persona_id: input.personaId,
    providers: input.publishing.providers,
    ...scheduleAccountColumns(accountIds),
    pinterest_board_id: input.publishing.pinterestBoardId,
    days_of_week: null,
    start_hour: null,
    end_hour: null,
    posts_per_day: 1,
    times: [slotTime],
    timezone: 'UTC',
    scheduled_at: null,
    active: true,
    publish_mode: 'asap',
  });
  if (scheduleError) {
    if (storedImagePath !== null) {
      await supabase.storage
        .from(SCHEDULED_IMAGE_BUCKET)
        .remove([storedImagePath])
        .catch((error: unknown) => logger.error('[publish-existing] stored image cleanup failed', error, { scheduleId, userId }));
    }
    if (violatedConstraint(scheduleError) === SCHEDULE_PK_CONSTRAINT) {
      const replay = await replayAsapHold(supabase, scheduleId, userId, route);
      if (replay !== null) return replay;
    }
    logger.error('[publish-existing] schedule insert failed', scheduleError, { scheduleId, userId });
    return apiErrorResponse(500, formatErrorMessage(ERROR_CODES.INTERNAL_ERROR), {
      route,
      code: ERROR_CODES.INTERNAL_ERROR,
    });
  }

  const rows = buildSlotRows({
    slots: [{ slotAtISO, dayIndex: 0, timeIndex: 0 }],
    title: input.title,
    description: input.description,
    scheduleId,
    userId,
    promptVersionId: input.promptVersionId,
  }).map((row) => ({
    ...row,
    status: 'awaiting_approval',
    media_kind: mediaKindValue,
    media_ref: mediaRef,
    media_content_type: mediaContentType,
  }));
  const { data: inserted, error: slotsError } = await supabase
    .from('scheduled_posts')
    .insert(rows)
    .select('id, slot_at, title');
  if (slotsError || inserted === null) {
    const uploadTaken = violatedConstraint(slotsError) === UPLOAD_SLOT_REFERENCE_INDEX;
    if (!uploadTaken) logger.error('[publish-existing] slot insert failed', slotsError, { scheduleId, userId });
    await supabase.from('schedules').delete().eq('id', scheduleId).eq('user_id', userId);
    if (storedImagePath !== null) {
      await supabase.storage
        .from(SCHEDULED_IMAGE_BUCKET)
        .remove([storedImagePath])
        .catch((error: unknown) => logger.error('[publish-existing] stored image cleanup failed', error, { scheduleId, userId }));
    }
    if (uploadTaken) {
      const taken = uploadAlreadyScheduledError();
      return apiErrorResponse(taken.status, taken.message, { route, code: taken.code, field: 'media.uploadId' });
    }
    return apiErrorResponse(500, formatErrorMessage(ERROR_CODES.INTERNAL_ERROR), {
      route,
      code: ERROR_CODES.INTERNAL_ERROR,
    });
  }
  const first = (inserted as Array<Record<string, unknown>>)[0];
  return holdResponse(
    {
      id: String(first?.id ?? ''),
      slotAt: String(first?.slot_at ?? slotAtISO),
      status: 'awaiting_approval',
    },
    false,
  );
}
