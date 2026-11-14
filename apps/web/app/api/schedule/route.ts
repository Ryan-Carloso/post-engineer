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
import { batchChargeId, batchSlotRefundKey } from '@/lib/billing/batch-discount';
import { emitRefundIssued } from '@/lib/billing/refund-tokens';
import { scrubSecrets } from '@/lib/scrub';
import { CANCEL_REFUND_REASON, refundsAfterClawback } from './batch-clawback';

//---------------
// /api/schedule — read and cancel the automatic fill-schedule timetables.
// Schedules are created by POST /api/videos/generate-and-schedule (the
// singular MCP generate_persona_video tool or the web API directly);
// this route only lists them (GET) and cancels one (DELETE, used by the
// MCP cancel_schedule tool). There is no edit verb. Cancel deletes every
// unpublished slot (pending, generating, ready) before the schedule row: generate-and-schedule
// dispatches those slots immediately, and the publisher posts from the slot
// row, so deleting only the schedule would leave a post that still goes out.
// Only slots whose generation never ran are refunded (status `pending`
// with no task): each gives back its stored `charged_tokens`
// (migration 045), never a recomputed price, and a slot charged 0 has
// nothing to refund. A slot the engine already accepted (`generating`) or
// finished (`ready`) keeps its charge — the GPU cost is already sunk —
// but it is still deleted, so the post cannot go out. A cancelled video
// of a batch gives back the batch discount it no longer earns
// (batch-clawback.ts): the refundable slots are refunded in full and the
// same amount is pulled back out of the free slot's discount credit, in
// one transaction, so a later refund of that re-charged video still fits
// under the charge cap. A failed free slot is not clawed back. A soft
// refund failure is logged and reported on the response; the slot stays
// deleted. A slot already `publishing`, `published`, or `failed` is left
// alone. Every removed slot gets a response entry stating whether it was
// refunded and why.
//
// One schedule is one generate-and-schedule batch. The engine
// (fill-schedule-scheduler thread, starts with the app) reads these tables
// via the service role and does the rest: LLM script, video generation, and
// publishing at each slot's time via /api/upload-content.
//---------------

const VALID_PROVIDERS = ['youtube', 'instagram', 'linkedin', 'bluesky', 'threads', 'facebook', 'pinterest', '3speak', 'rumble', 'fanvue'] as const;
export const VALID_SCHEDULE_PROVIDERS = VALID_PROVIDERS;

function errorResponse(
  status: number,
  error: string,
  route: string,
  extra?: Record<string, unknown>,
  options?: { cause?: unknown; logMessage?: string; metadata?: Record<string, unknown> },
): NextResponse {
  return apiErrorResponse(status, error, { route, extra, ...options });
}

//---------------
// assertScheduleScope — resolves the persona that owns a schedule and
// rejects access outside a persona-scoped API key's allowed personas.
// Returns an error response when the caller must stop (404 unknown,
// 403 out of scope), or null when the caller may proceed.
//---------------
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
  // A schedule with no persona (migration 012) belongs to no persona scope, so
  // there is nothing for isPersonaAllowed to check. The row is already
  // filtered by user_id, so ownership is the whole boundary here.
  if (data.persona_id !== null && !isPersonaAllowed(personaScope, data.persona_id)) {
    return errorResponse(403, 'This API key does not have access to this schedule.', `${method} /api/schedule`);
  }
  return null;
}

async function getHandler(request?: Request): Promise<NextResponse> {
  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) return authError;
  const user = { id: auth.userId };
  const supabase = auth.isApiKey === true
    ? createSupabaseServiceClient()
    : await createSupabaseServerClient();

  const { data, error } = await supabase
    .from('schedules')
    .select('id, persona_id, providers, youtube_account_ids, instagram_account_ids, linkedin_account_ids, bluesky_account_ids, threads_account_ids, facebook_account_ids, pinterest_account_ids, pinterest_board_id, threespeak_account_ids, rumble_account_ids, days_of_week, start_hour, end_hour, posts_per_day, timezone, active, created_at, publish_mode')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true });

  if (error) {
    return errorResponse(500, 'Failed to list schedules.', 'GET /api/schedule', undefined, {
      cause: error,
    });
  }

  // Persona-scoped API keys may only see schedules of their own personas.
  // Browser sessions and unrestricted keys (personaIds null/undefined)
  // keep the full list. A schedule with no persona (migration 012) is owned
  // by no persona scope, so it is listed like an unrestricted one rather
  // than filtered away.
  const schedules = (data ?? []).filter(
    (schedule) =>
      schedule.persona_id === null ||
      isPersonaAllowed(auth.personaIds, schedule.persona_id),
  );

  return NextResponse.json({ success: true, schedules });
}

// Statuses the publisher can still turn into a post. `pending` has not
// been dispatched; `generating` and `ready` already have (generate-and-schedule
// dispatches every slot immediately, and the reconciler promotes generating
// → ready when the engine task finishes). `publishing` is left alone: the
// claim already happened and the upload may be in flight. `published` and
// `failed` are terminal.
const CANCELLABLE_SLOT_STATUSES = ['pending', 'generating', 'ready'] as const;

interface ScheduleCancelSlot {
  id: string;
  status: string;
  chargedTokens: number;
  batchId: string | null;
  taskId: string | null;
}

interface CancelRefund {
  slotId: string;
  refunded: boolean;
  alreadyRefunded: boolean;
  /** Why this slot got its tokens back — or why it did not. */
  reason: CancelRefundReason;
}

type CancelRefundReason =
  | 'not_generated'
  | 'already_generated'
  | 'already_refunded'
  | 'not_charged'
  | 'refund_failed'
  | 'discount_withheld';

function narrowCancelSlot(value: unknown): ScheduleCancelSlot | null {
  if (typeof value !== 'object' || value === null) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== 'string' || row.id.length === 0) return null;
  if (typeof row.status !== 'string') return null;
  const taskId = row.task_id;
  if (taskId !== null && taskId !== undefined && typeof taskId !== 'string') return null;
  // NOT NULL integer >= 0 in the schema: anything else is an unreadable row.
  const chargedTokens = row.charged_tokens;
  if (typeof chargedTokens !== 'number' || !Number.isInteger(chargedTokens) || chargedTokens < 0) return null;
  const batchId = row.batch_id;
  if (batchId !== null && batchId !== undefined && typeof batchId !== 'string') return null;
  return {
    id: row.id,
    status: row.status,
    chargedTokens,
    batchId: typeof batchId === 'string' ? batchId : null,
    taskId: typeof taskId === 'string' && taskId.length > 0 ? taskId : null,
  };
}

function isCancellableStatus(status: string): boolean {
  return (CANCELLABLE_SLOT_STATUSES as readonly string[]).includes(status);
}

/**
 * True when a slot's generation never ran: still `pending` with no engine
 * task. Anything else means the engine accepted the job (or finished it),
 * so the GPU cost is already sunk and the charge stands. A `pending` slot
 * that somehow carries a task id fails closed the same way — the engine
 * may have accepted the job before the status write landed.
 */
function neverGenerated(slot: ScheduleCancelSlot): boolean {
  return slot.status === 'pending' && slot.taskId === null;
}

async function deleteHandler(request: Request): Promise<NextResponse> {
  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) return authError;
  const user = { id: auth.userId };
  const supabase = auth.isApiKey === true
    ? createSupabaseServiceClient()
    : await createSupabaseServerClient();

  const scheduleId = new URL(request.url).searchParams.get('id');
  if (!scheduleId) return errorResponse(400, 'id query param is required.', 'DELETE /api/schedule');

  // A persona-scoped API key may only delete schedules of its own personas.
  // Sessions and unrestricted keys keep the previous behavior (no lookup).
  if (auth.isApiKey === true && Array.isArray(auth.personaIds)) {
    const scopeError = await assertScheduleScope(supabase, auth.personaIds, scheduleId, user.id, 'DELETE');
    if (scopeError) return scopeError;
  }

  // Each slot carries what it was charged, so the refund needs no schedule
  // row: orphan slots (schedule row already gone, no FK cascade in the
  // migration chain) are priced and removed like any other.
  const { data: slotData, error: slotsError } = await supabase
    .from('scheduled_posts')
    .select('id, status, charged_tokens, batch_id, task_id')
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

  // Delete by status, not by the id snapshot. The FK from scheduled_posts
  // to schedules is not in the migration chain (001 only comments it as
  // probable), so deleting the schedule row does not remove slots. The
  // publisher loads ready slots and posts to the embedded schedule's
  // providers: if that delete fails and the row is still there, the post
  // goes out at slot_at. Removing the slot rows is the cancel that does
  // not depend on the schedule delete succeeding. `publishing` is excluded
  // — that claim is already in flight.
  // One schedule is one generate-and-schedule batch (at most 10 slots), so
  // this select/delete is bounded by the creation route.
  const { error: slotDeleteError } = await supabase
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
    .select('id, status, charged_tokens, batch_id, task_id')
    .eq('schedule_id', scheduleId)
    .eq('user_id', user.id);
  if (remainingError) {
    // The delete already ran. Do not refund on an unread snapshot — a slot
    // that flipped to `publishing` and survived must not be refunded — and
    // do not delete the schedule row while we cannot say what remains.
    logger.error('[api/schedule] cancel could not re-read slots after delete; refunds skipped', remainingError, {
      scheduleId,
      userId: user.id,
    });
    // The slots are gone with no refund: leave a plain event (not just a
    // log line) so the skipped refund is findable by the daily billing
    // reconcile instead of surfacing only when the user asks.
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
  // Refund only rows that are actually gone. A slot that became
  // `publishing` between the snapshot and the delete is still in
  // remainingIds and must keep its charge — the post may still go out.
  const removed = cancellable.filter((slot) => !remainingIds.has(slot.id));

  // Only slots whose generation never ran go to the clawback: the
  // settlement refunds the slots it is given, so passing a generated slot
  // would pay back GPU cost that is already sunk. A generated slot keeps
  // its charge and never enters the settlement — cancelling it cannot claw
  // the free video's discount either, because the charges that earned it
  // still stand.
  const refundable = removed.filter(neverGenerated);
  const clawback = await refundsAfterClawback(supabase, user.id, refundable, scheduleId);
  if (!clawback.ok) {
    // The slots are gone but the batch could not be re-checked: refunding
    // blind could leave a free batch video behind, so no refund is issued
    // and the schedule row stays (same contract as the re-read failure).
    logger.error('[api/schedule] cancel could not re-check the batch discount; refunds skipped', clawback.error, {
      scheduleId,
      userId: user.id,
    });
    // Same trace as the re-read failure above: the slots are gone with no
    // refund, and the reconcile needs a findable record of it.
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
  // Tokens actually returned by this call (landed refunds only). An
  // already-refunded slot was returned by an earlier call, so it adds
  // nothing here — counting it would double-count across retries.
  let refundedTokens = 0;
  const batchGenerationId = batchChargeId(scheduleId);
  for (const slot of removed) {
    // A slot whose generation already ran keeps its charge: the GPU cost
    // is sunk, so there is nothing to give back. The slot is already
    // deleted above — the post cannot go out — but no refund RPC runs.
    if (!neverGenerated(slot)) {
      refunds.push({ slotId: slot.id, refunded: false, alreadyRefunded: false, reason: 'already_generated' });
      continue;
    }
    if (clawback.settledSlotIds.has(slot.id)) {
      // settle_batch_clawback already refunded this slot (and pulled the
      // discount back). Refunding the net again would pay it twice.
      const net = clawback.refundBySlot.get(slot.id) ?? 0;
      const outcome = clawback.settledBySlot.get(slot.id);
      if (outcome === undefined) {
        // The settlement claims the slot but reports no outcome: the
        // tokens cannot be confirmed as moved, so say so loudly.
        logger.error('[api/schedule] cancel refund missing settlement outcome', {
          scheduleId,
          slotId: slot.id,
          userId: user.id,
        });
        refunds.push({ slotId: slot.id, refunded: false, alreadyRefunded: false, reason: 'refund_failed' });
        continue;
      }
      if (net === 0) {
        // Fully withheld: the settlement refunded the gross charge and
        // pulled it all back into the free slot's discount, so the user
        // keeps nothing — but the slot still gets an entry saying why.
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
    // Nothing to give back: a free video (charged 0), or a refund the batch
    // clawback fully withheld. The RPC rejects a non-positive amount.
    if (amount === 0) {
      refunds.push({ slotId: slot.id, refunded: false, alreadyRefunded: false, reason: 'not_charged' });
      continue;
    }
    // The key matches the dispatch-failure refund so a slot that was
    // already refunded is not credited twice.
    const { data: refundData, error: refundError } = await supabase.rpc('refund_batch_tokens', {
      p_user_id: user.id,
      p_batch_generation_id: batchGenerationId,
      p_refund_key: batchSlotRefundKey(scheduleId, slot.id),
      p_amount: amount,
      p_reason: CANCEL_REFUND_REASON,
      p_engine_task_id: slot.taskId,
    });
    const payload = (refundData ?? {}) as { refunded?: unknown; already_refunded?: unknown };
    const alreadyRefunded = payload.already_refunded === true;
    const refunded = payload.refunded === true;
    if (refundError || (!refunded && !alreadyRefunded)) {
      // False from the RPC is a real failure (billing rule): the slot is
      // gone, the charge may still be standing. Loud log, keep going — the
      // publish is already stopped, and the response tells the caller.
      logger.error('[api/schedule] cancel refund failed', refundError ?? payload, {
        scheduleId,
        slotId: slot.id,
        userId: user.id,
      });
      refunds.push({ slotId: slot.id, refunded: false, alreadyRefunded: false, reason: 'refund_failed' });
      continue;
    }
    if (refunded) {
      refundedTokens += amount;
      emitRefundIssued(user.id, {
        kind: 'schedule_cancelled',
        amount,
        reason: CANCEL_REFUND_REASON,
        batchGenerationId,
        scheduleId,
        slotId: slot.id,
        engineTaskId: slot.taskId,
      });
    }
    refunds.push({
      slotId: slot.id,
      refunded,
      alreadyRefunded,
      reason: refunded ? 'not_generated' : 'already_refunded',
    });
  }

  const { error: deleteError } = await supabase
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
  // The wrapper never reads the body: attach the cancel facts so the
  // schedule_deleted event carries them (scheduleId + refunded count).
  // attachApiErrorProperties requires pre-scrubbed values — the success
  // path never scrubs — and the id comes straight off the query string
  // with no format check, so scrub at the call site. The count travels
  // as `refunded`, not `refundedTokens`: the scrubber redacts every
  // `token*` key, which would erase the audit value.
  attachApiErrorProperties(response, scrubSecrets({ scheduleId, refunded: refundedTokens }));
  return response;
}

//---------------
// 5xx reporting: handled server errors reach PostHog error tracking.
//---------------
export const GET = withApiErrorReporting('GET /api/schedule', getHandler, { getUserId: resolveReportingUserId });
export const DELETE = withApiErrorReporting('DELETE /api/schedule', deleteHandler, { getUserId: resolveReportingUserId });
