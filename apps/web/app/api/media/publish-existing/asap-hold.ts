import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

import { apiErrorResponse } from '@/lib/api-error';
import { ERROR_CODES, formatErrorMessage } from '@/lib/error-codes';
import { logger } from '@/lib/logger';
import { scheduleAccountColumns } from './account-columns';
import { discardStagedImage, rollbackSlotInsert, slotMediaColumns, stageSlotMedia } from './slot-media';
import {
  SCHEDULE_PK_CONSTRAINT,
  violatedConstraint,
} from './constraint-violations';
import type { PublishExistingContext } from './context';
import { buildSlotRows } from './slot-rows';
import { loadReplaySlots } from './replay';

function holdResponse(slot: { id: string; slotAt: string; status: string }, replayed: boolean): NextResponse {
  return NextResponse.json({
    success: true,
    mode: 'asap',
    approvalRequired: slot.status === 'awaiting_approval',
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
  const loaded = await loadReplaySlots(supabase, scheduleId, userId, route, 'id, slot_at, status');
  if (loaded === null) return null;
  if ('error' in loaded) return loaded.error;
  const first = loaded.rows[0] as { id: unknown; slot_at: unknown; status: unknown };
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

  const staged = await stageSlotMedia(ctx, slotAtISO);
  if ('error' in staged) return staged.error;
  const media = staged.media;

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
    await discardStagedImage(supabase, media, scheduleId, userId);
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
    firstComment: input.firstComment,
  }).map((row) => ({
    ...row,
    status: 'awaiting_approval',
    ...slotMediaColumns(media),
  }));
  const { data: inserted, error: slotsError } = await supabase
    .from('scheduled_posts')
    .insert(rows)
    .select('id, slot_at, title');
  if (slotsError || inserted === null) {
    return rollbackSlotInsert(ctx, slotsError, media, scheduleId);
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
