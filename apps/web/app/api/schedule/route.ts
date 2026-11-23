import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { requireSupabaseSession } from '@/lib/request-auth';
import { trackApiEvent } from '@/lib/analytics';
import { isPersonaAllowed } from '@/lib/api-keys';
import { apiErrorResponse } from '@/lib/api-error';
import {
  withApiErrorReporting,
  resolveReportingUserId,
  attachApiErrorProperties,
} from '@/lib/api-error-reporting';
import { logger } from '@/lib/logger';
import { batchChargeId } from '@/lib/billing/batch-discount';
import { emitRefundIssued, refundSlotTokens } from '@/lib/billing/refund-tokens';
import { scrubSecrets } from '@/lib/scrub';
import { CANCEL_REFUND_REASON, refundsAfterClawback } from './batch-clawback';
import { parseCancelScheduleQuery } from '@/lib/contracts/schedule';
import { isUuid } from '@/lib/schedule-slot-id';
import { removeCancelledMediaImages } from './cancel-media-cleanup';
import {
  CANCELLABLE_SLOT_STATUSES,
  isCancellableStatus,
  narrowCancelSlot,
  neverGenerated,
  type ScheduleCancelSlot,
} from './cancel-slots';
import { cancelRemovedEngineTasks } from './cancel-engine-tasks';
import { applyRateLimit, CALLER_RATE_LIMITS, profileForCaller, RATE_LIMITS } from '@/lib/rate-limit';


function errorResponse(
  status: number,
  error: string,
  route: string,
  extra?: Record<string, unknown>,
  options?: { cause?: unknown; logMessage?: string; metadata?: Record<string, unknown> },
): NextResponse {
  return apiErrorResponse(status, error, { route, extra, ...options });
}

async function assertScheduleScope(
  supabase: SupabaseClient,
  personaScope: readonly string[] | null | undefined,
  scheduleId: string,
  userId: string,
  method: string,
): Promise<NextResponse | null> {
  const { data, error } = await supabase
    .from('schedules')
    .select('persona_id')
    .eq('id', scheduleId)
    .eq('user_id', userId)
    .single();
  if (error && error.code !== 'PGRST116') {
    return errorResponse(500, 'Failed to fetch schedule.', `${method} /api/schedule`, undefined, {
      cause: error,
    });
  }
  if (!data) return errorResponse(404, 'Schedule not found.', `${method} /api/schedule`);
  if (data.persona_id !== null && !isPersonaAllowed(personaScope, data.persona_id)) {
    return errorResponse(403, 'This API key does not have access to this schedule.', `${method} /api/schedule`);
  }
  return null;
}

async function getHandler(request: Request): Promise<NextResponse> {
  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) return authError;
  const limited = await applyRateLimit(request, profileForCaller(auth, CALLER_RATE_LIMITS.scheduleList), auth.userId);
  if (limited) return limited;
  const user = { id: auth.userId };
  const supabase = auth.isApiKey === true || auth.isOAuth === true
    ? createSupabaseServiceClient()
    : await createSupabaseServerClient();

  const { data, error } = await supabase
    .from('schedules')
    .select('id, persona_id, providers, youtube_account_ids, instagram_account_ids, linkedin_account_ids, bluesky_account_ids, threads_account_ids, facebook_account_ids, pinterest_account_ids, pinterest_board_id, threespeak_account_ids, rumble_account_ids, fanvue_account_ids, telegram_account_ids, days_of_week, start_hour, end_hour, posts_per_day, timezone, active, created_at, publish_mode')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true });

  if (error) {
    return errorResponse(500, 'Failed to list schedules.', 'GET /api/schedule', undefined, {
      cause: error,
    });
  }

  const schedules = (data ?? []).filter(
    (schedule) =>
      schedule.persona_id === null ||
      isPersonaAllowed(auth.personaIds, schedule.persona_id),
  );

  return NextResponse.json({ success: true, schedules });
}

interface CancelRefund {
  slotId: string;
  refunded: boolean;
  alreadyRefunded: boolean;
  reason: CancelRefundReason;
}

type CancelRefundReason =
  | 'not_generated'
  | 'already_generated'
  | 'already_refunded'
  | 'not_charged'
  | 'refund_failed'
  | 'discount_withheld';

async function deleteHandler(request: Request): Promise<NextResponse> {
  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) return authError;
  const limited = await applyRateLimit(request, RATE_LIMITS.scheduleDelete, auth.userId);
  if (limited) return limited;
  const user = { id: auth.userId };
  const supabase = auth.isApiKey === true || auth.isOAuth === true
    ? createSupabaseServiceClient()
    : await createSupabaseServerClient();

  const cancelQuery = parseCancelScheduleQuery(new URL(request.url).searchParams);
  if (!cancelQuery.ok) return errorResponse(400, cancelQuery.error, 'DELETE /api/schedule');
  const scheduleId = cancelQuery.query.id;

  if (!isUuid(scheduleId)) {
    return errorResponse(404, 'Schedule not found.', 'DELETE /api/schedule');
  }

  if (auth.isApiKey === true && Array.isArray(auth.personaIds)) {
    const scopeError = await assertScheduleScope(supabase, auth.personaIds, scheduleId, user.id, 'DELETE');
    if (scopeError) return scopeError;
  }

  const { data: slotData, error: slotsError } = await supabase
    .from('scheduled_posts')
    .select('id, status, charged_tokens, batch_id, task_id, media_kind, media_ref')
    .eq('schedule_id', scheduleId)
    .eq('user_id', user.id);
  if (slotsError) {
    return errorResponse(500, 'Failed to list schedule slots.', 'DELETE /api/schedule', undefined, {
      cause: slotsError,
    });
  }

  const seen: ScheduleCancelSlot[] = [];
  for (const raw of slotData ?? []) {
    const slot = narrowCancelSlot(raw);
    if (!slot) {
      logger.error('[api/schedule] cancel skipped a slot row that could not be read', {
        scheduleId,
        userId: user.id,
      });
      continue;
    }
    seen.push(slot);
  }
  const cancellable = seen.filter((slot) => isCancellableStatus(slot.status));

  const service = createSupabaseServiceClient();
  const { error: slotDeleteError } = await service
    .from('scheduled_posts')
    .delete()
    .eq('schedule_id', scheduleId)
    .eq('user_id', user.id)
    .in('status', [...CANCELLABLE_SLOT_STATUSES]);
  if (slotDeleteError) {
    return errorResponse(500, 'Failed to cancel unpublished slots.', 'DELETE /api/schedule', undefined, {
      cause: slotDeleteError,
    });
  }

  const { data: remainingData, error: remainingError } = await supabase
    .from('scheduled_posts')
    .select('id, status, charged_tokens, batch_id, task_id, media_kind, media_ref')
    .eq('schedule_id', scheduleId)
    .eq('user_id', user.id);
  if (remainingError) {
    logger.error('[api/schedule] cancel could not re-read slots after delete; refunds skipped', remainingError, {
      scheduleId,
      userId: user.id,
    });
    trackApiEvent('cancel_refund_skipped', {
      scheduleId,
      reason: 'slots_reread_failed',
      userId: user.id,
    });
    return errorResponse(
      500,
      'Unpublished slots were removed but could not be confirmed, so prepaid tokens were not refunded.',
      'DELETE /api/schedule',
      undefined,
      { cause: remainingError },
    );
  }
  const remainingIds = new Set<string>();
  for (const raw of remainingData ?? []) {
    const slot = narrowCancelSlot(raw);
    if (slot) remainingIds.add(slot.id);
  }
  const removed = cancellable.filter((slot) => !remainingIds.has(slot.id));

  await removeCancelledMediaImages(createSupabaseServiceClient(), removed, user.id);

  await cancelRemovedEngineTasks(removed, scheduleId, user.id);

  const refundable = removed.filter(neverGenerated);
  const clawback = await refundsAfterClawback(createSupabaseServiceClient(), user.id, refundable, scheduleId);
  if (!clawback.ok) {
    logger.error('[api/schedule] cancel could not re-check the batch discount; refunds skipped', clawback.error, {
      scheduleId,
      userId: user.id,
    });
    trackApiEvent('cancel_refund_skipped', {
      scheduleId,
      reason: 'batch_recheck_failed',
      userId: user.id,
    });
    return errorResponse(
      500,
      'Unpublished slots were removed but could not be confirmed, so prepaid tokens were not refunded.',
      'DELETE /api/schedule',
      undefined,
      { cause: clawback.error },
    );
  }

  const refunds: CancelRefund[] = [];
  let refundedTokens = 0;
  const batchGenerationId = batchChargeId(scheduleId);
  for (const slot of removed) {
    if (!neverGenerated(slot)) {
      refunds.push({ slotId: slot.id, refunded: false, alreadyRefunded: false, reason: 'already_generated' });
      continue;
    }
    if (clawback.settledSlotIds.has(slot.id)) {
      if (slot.chargedTokens === 0) {
        refunds.push({ slotId: slot.id, refunded: false, alreadyRefunded: false, reason: 'not_charged' });
        continue;
      }
      const net = clawback.refundBySlot.get(slot.id) ?? 0;
      const outcome = clawback.settledBySlot.get(slot.id);
      if (outcome === undefined) {
        logger.error('[api/schedule] cancel refund missing settlement outcome', {
          scheduleId,
          slotId: slot.id,
          userId: user.id,
        });
        refunds.push({ slotId: slot.id, refunded: false, alreadyRefunded: false, reason: 'refund_failed' });
        continue;
      }
      if (net === 0) {
        refunds.push({
          slotId: slot.id,
          refunded: false,
          alreadyRefunded: outcome.alreadyRefunded,
          reason: 'discount_withheld',
        });
        continue;
      }
      if (!outcome.refunded && !outcome.alreadyRefunded) {
        logger.error('[api/schedule] cancel refund failed', outcome, {
          scheduleId,
          slotId: slot.id,
          userId: user.id,
        });
        refunds.push({ slotId: slot.id, refunded: false, alreadyRefunded: false, reason: 'refund_failed' });
        continue;
      }
      if (outcome.refunded) {
        refundedTokens += net;
        emitRefundIssued(user.id, {
          kind: 'schedule_cancelled',
          amount: net,
          reason: CANCEL_REFUND_REASON,
          batchGenerationId,
          scheduleId,
          slotId: slot.id,
          engineTaskId: slot.taskId,
        });
      }
      refunds.push({
        slotId: slot.id,
        refunded: outcome.refunded,
        alreadyRefunded: outcome.alreadyRefunded,
        reason: outcome.refunded ? 'not_generated' : 'already_refunded',
      });
      continue;
    }
    const amount = clawback.refundBySlot.get(slot.id) ?? slot.chargedTokens;
    if (amount === 0) {
      refunds.push({ slotId: slot.id, refunded: false, alreadyRefunded: false, reason: 'not_charged' });
      continue;
    }
    const { refunded, alreadyRefunded, error: refundError } = await refundSlotTokens({
      supabase: createSupabaseServiceClient(),
      userId: user.id,
      scheduleId,
      slotId: slot.id,
      amount,
      reason: CANCEL_REFUND_REASON,
      kind: 'schedule_cancelled',
      engineTaskId: slot.taskId,
    });
    if (refundError || (!refunded && !alreadyRefunded)) {
      logger.error('[api/schedule] cancel refund failed', refundError ?? { refunded, already_refunded: alreadyRefunded }, {
        scheduleId,
        slotId: slot.id,
        userId: user.id,
      });
      refunds.push({ slotId: slot.id, refunded: false, alreadyRefunded: false, reason: 'refund_failed' });
      continue;
    }
    if (refunded) {
      refundedTokens += amount;
    }
    refunds.push({
      slotId: slot.id,
      refunded,
      alreadyRefunded,
      reason: refunded ? 'not_generated' : 'already_refunded',
    });
  }

  const { error: deleteError } = await service
    .from('schedules')
    .delete()
    .eq('id', scheduleId)
    .eq('user_id', user.id);

  if (deleteError) {
    return errorResponse(
      500,
      'Unpublished slots were removed but the schedule could not be deleted.',
      'DELETE /api/schedule',
      undefined,
      { cause: deleteError },
    );
  }
  const response = NextResponse.json({
    success: true,
    cancelledSlotIds: removed.map((slot) => slot.id),
    refunds,
    batchDiscountWithheld: removed.reduce(
      (sum, slot) => sum + slot.chargedTokens - (clawback.refundBySlot.get(slot.id) ?? slot.chargedTokens),
      0,
    ),
  });
  attachApiErrorProperties(response, scrubSecrets({ scheduleId, refunded: refundedTokens }));
  return response;
}

export const GET = withApiErrorReporting('GET /api/schedule', getHandler, { getUserId: resolveReportingUserId });
export const DELETE = withApiErrorReporting('DELETE /api/schedule', deleteHandler, { getUserId: resolveReportingUserId });
