import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { requireSupabaseSession } from '@/lib/request-auth';
import { isPersonaAllowed } from '@/lib/api-keys';
import { apiErrorResponse } from '@/lib/api-error';
import { withApiErrorReporting, resolveReportingUserId } from '@/lib/api-error-reporting';
import { logger } from '@/lib/logger';
import { computeVideoTokens, type FaceQuality } from '@/lib/tokens';

//---------------
// /api/schedule — read and cancel the automatic fill-schedule timetables.
// Schedules are created by POST /api/videos/generate-and-schedule (the web
// form and the MCP generate_persona_videos tool); this route only lists
// them (GET) and cancels one (DELETE, used by the MCP cancel_schedule
// tool). There is no edit verb. Cancel deletes every unpublished slot
// (pending, generating, ready) before the schedule row: generate-and-schedule
// dispatches those slots immediately, and the publisher posts from the slot
// row, so deleting only the schedule would leave a post that still goes out.
// Prepaid tokens for the removed slots are refunded. A soft refund failure
// is logged and reported on the response; the slot stays deleted. A slot
// already `publishing`, `published`, or `failed` is left alone.
//
// One schedule is one generate-and-schedule batch. The engine
// (fill-schedule-scheduler thread, starts with the app) reads these tables
// via the service role and does the rest: LLM topic, video generation, and
// publishing at each slot's time via /api/upload-content.
//---------------

const VALID_PROVIDERS = ['youtube', 'instagram', 'linkedin', 'bluesky'] as const;
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
    .select('id, persona_id, providers, youtube_account_ids, instagram_account_ids, linkedin_account_ids, bluesky_account_ids, days_of_week, start_hour, end_hour, posts_per_day, timezone, active, created_at, publish_mode')
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
  faceless: boolean;
  taskId: string | null;
}

interface CancelRefund {
  slotId: string;
  refunded: boolean;
  alreadyRefunded: boolean;
}

// Unknown face quality prices as "ok" (2), matching the engine refund
// (`very_good` only when the snapshot says so). Only literal true is
// faceless — NULL/missing is the expensive with-face case.
function refundFaceQuality(value: unknown): FaceQuality {
  return value === 'very_good' ? 'very_good' : 'ok';
}

function narrowCancelSlot(value: unknown): ScheduleCancelSlot | null {
  if (typeof value !== 'object' || value === null) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== 'string' || row.id.length === 0) return null;
  if (typeof row.status !== 'string') return null;
  const taskId = row.task_id;
  if (taskId !== null && taskId !== undefined && typeof taskId !== 'string') return null;
  return {
    id: row.id,
    status: row.status,
    faceless: row.faceless === true,
    taskId: typeof taskId === 'string' && taskId.length > 0 ? taskId : null,
  };
}

function isCancellableStatus(status: string): boolean {
  return (CANCELLABLE_SLOT_STATUSES as readonly string[]).includes(status);
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

  // Face quality prices the refund. A missing schedule row is not a 404:
  // orphan slots (schedule row already gone, no FK cascade in the migration
  // chain) must still be removable. A real read error stops us before any
  // delete — we will not claim a cancel we could not price.
  const { data: scheduleRow, error: scheduleLookupError } = await supabase
    .from('schedules')
    .select('id, post_face_quality')
    .eq('id', scheduleId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (scheduleLookupError) {
    return errorResponse(500, 'Failed to fetch schedule.', 'DELETE /api/schedule', undefined, {
      cause: scheduleLookupError,
    });
  }
  const faceQuality = refundFaceQuality(
    scheduleRow !== null && typeof scheduleRow === 'object'
      ? (scheduleRow as { post_face_quality?: unknown }).post_face_quality
      : undefined,
  );

  const { data: slotData, error: slotsError } = await supabase
    .from('scheduled_posts')
    .select('id, status, faceless, task_id')
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
    .select('id, status, faceless, task_id')
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

  const refunds: CancelRefund[] = [];
  const batchGenerationId = `batch:${scheduleId}`;
  for (const slot of removed) {
    // The engine task is already running (GPU spent). The user gets no
    // post, so the prepaid charge is refunded — charging for a cancelled
    // post is the worse error. The key matches the dispatch-failure refund
    // so a slot that was already refunded is not credited twice.
    const { data: refundData, error: refundError } = await supabase.rpc('refund_batch_tokens', {
      p_user_id: user.id,
      p_batch_generation_id: batchGenerationId,
      p_refund_key: `${batchGenerationId}:slot:${slot.id}`,
      p_amount: computeVideoTokens(slot.faceless, faceQuality),
      p_reason: 'Schedule cancelled before publish; video refunded',
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
    }
    refunds.push({ slotId: slot.id, refunded, alreadyRefunded });
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
  return NextResponse.json({
    success: true,
    cancelledSlotIds: removed.map((slot) => slot.id),
    refunds,
  });
}

//---------------
// 5xx reporting: handled server errors reach PostHog error tracking.
//---------------
export const GET = withApiErrorReporting('GET /api/schedule', getHandler, { getUserId: resolveReportingUserId });
export const DELETE = withApiErrorReporting('DELETE /api/schedule', deleteHandler, { getUserId: resolveReportingUserId });
