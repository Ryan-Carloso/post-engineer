import { NextResponse } from 'next/server';
import { requireSupabaseSession } from '@/lib/request-auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { apiErrorResponse } from '@/lib/api-error';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { getSlotPost } from '@/lib/post-detail';
import { resolveSlotUuid } from '@/lib/schedule-slot-id';
import { logger } from '@/lib/logger';
import { withApiErrorReporting, resolveReportingUserId } from '@/lib/api-error-reporting';

//---------------
// /api/schedule/slots/:slotId — per-slot operations on scheduled posts.
// DELETE removes a single slot; a published slot can never be deleted
// (the post already went out) and slots that are mid-flight (generating,
// ready, publishing) are rejected too — the engine owns them.
// Auth: cookie session (web) or API key / OAuth token (MCP clients) via
// requireSupabaseSession. API-key callers use the service client, so
// ownership is re-checked explicitly below (RLS does not apply to it).
//---------------

interface SlotRow {
  id: string;
  schedule_id: string;
  status: string;
  topic: string | null;
}

interface ScheduleRow {
  id: string;
  user_id: string;
}

async function loadOwnedSlot(
  supabase: ReturnType<typeof createSupabaseServiceClient>,
  slotId: string,
  userId: string,
): Promise<{ slot: SlotRow } | { error: NextResponse }> {
  const { data: slot, error } = await supabase
    .from('scheduled_posts')
    .select('id, schedule_id, status, topic')
    .eq('id', slotId)
    .eq('user_id', userId)
    .single();
  if (error) {
    // PGRST116 (zero rows) is the only honest 404 — unknown id or another
    // user's slot. Anything else is a DB failure: log loudly with the real
    // error and return 500 so callers retry instead of giving up.
    if ((error as { code?: string }).code === 'PGRST116') {
      return { error: apiErrorResponse(404, 'Slot not found.', { route: 'SLOT_OPS /api/schedule/slots' }) };
    }
    logger.error('[api/schedule/slots] slot lookup failed', error);
    return {
      error: apiErrorResponse(500, 'Failed to load post.', {
        route: 'SLOT_OPS /api/schedule/slots',
        cause: error,
      }),
    };
  }
  if (!slot) {
    return { error: apiErrorResponse(404, 'Slot not found.', { route: 'SLOT_OPS /api/schedule/slots' }) };
  }
  const row = slot as SlotRow;
  const { data: schedule, error: scheduleError } = await supabase
    .from('schedules')
    .select('id, user_id')
    .eq('id', row.schedule_id)
    .maybeSingle();
  if (scheduleError) {
    logger.error('[api/schedule/slots] schedule lookup failed', scheduleError);
    return {
      error: apiErrorResponse(500, 'Failed to load post.', {
        route: 'SLOT_OPS /api/schedule/slots',
        cause: scheduleError,
      }),
    };
  }
  const scheduleRow = schedule as ScheduleRow | null;
  // Explicit ownership check: the service client bypasses RLS, so the
  // schedule row must belong to the caller.
  if (!scheduleRow || scheduleRow.user_id !== userId) {
    return { error: apiErrorResponse(404, 'Slot not found.', { route: 'SLOT_OPS /api/schedule/slots' }) };
  }
  return { slot: row };
}

//---------------
// GET — one post's full detail: the slot row, its schedule (providers +
// account ids, so clients can resolve the target accounts) and the
// persona. Presentation follows /api/schedule/status (pending→awaiting,
// live engine progress for generating/failed slots via the shared
// enrichSlot helper). Unknown id or another user's slot → 404, never the
// row.
//---------------
async function getHandler(
  request: Request,
  context: { params: Promise<{ slotId: string }> },
): Promise<NextResponse> {
  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) return authError;
  // The detail fans out to the engine (progress + publish results, 10s
  // timeouts each) — rate-limit like the other expensive surfaces.
  const limited = await applyRateLimit(request, RATE_LIMITS.deletePreview, auth.userId);
  if (limited) return limited;
  const supabase =
    auth.isApiKey === true || auth.isOAuth === true
      ? createSupabaseServiceClient()
      : await createSupabaseServerClient();

  const { slotId } = await context.params;

  // The param is a scheduled_posts uuid, but callers sometimes send the
  // engine generation key `batch:<scheduleId>:slot:<slotId>` instead.
  // Resolve the real slot uuid before any uuid-typed filter — a raw
  // non-uuid value raises Postgres 22P02 and turns into a 500. Anything
  // unresolvable is an unknown id: 404, never a database round-trip.
  const resolvedSlotId = resolveSlotUuid(slotId);
  if (resolvedSlotId === null) {
    return apiErrorResponse(404, 'Slot not found.', { route: 'GET /api/schedule/slots' });
  }

  let detail;
  try {
    detail = await getSlotPost(supabase, resolvedSlotId, auth.userId);
  } catch (error) {
    logger.error('[api/schedule/slots] slot lookup failed', error);
    return apiErrorResponse(500, 'Failed to load post.', {
      route: 'GET /api/schedule/slots',
      cause: error,
    });
  }
  if (!detail) {
    return apiErrorResponse(404, 'Slot not found.', { route: 'GET /api/schedule/slots' });
  }
  return NextResponse.json({ success: true, ...detail });
}

async function deleteHandler(
  request: Request,
  context: { params: Promise<{ slotId: string }> },
): Promise<NextResponse> {
  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) return authError;
  const supabase =
    auth.isApiKey === true || auth.isOAuth === true
      ? createSupabaseServiceClient()
      : await createSupabaseServerClient();

  const { slotId } = await context.params;

  // The param is a scheduled_posts uuid, but callers sometimes send the
  // engine generation key `batch:<scheduleId>:slot:<slotId>` (including
  // percent-encoded). Resolve the real slot uuid before any uuid-typed
  // filter — a raw non-uuid raises Postgres 22P02 and turns into a 500.
  // Anything unresolvable is an unknown id: 404, never a database round-trip.
  const resolvedSlotId = resolveSlotUuid(slotId);
  if (resolvedSlotId === null) {
    return apiErrorResponse(404, 'Slot not found.', { route: 'DELETE /api/schedule/slots' });
  }

  const owned = await loadOwnedSlot(supabase, resolvedSlotId, auth.userId);
  if ('error' in owned) return owned.error;
  const slot = owned.slot;

  // DB stores 'pending'; the API presents it as 'awaiting'. Only pending
  // (not yet dispatched to the engine) and failed (dead row cleanup) slots
  // can be deleted.
  const DELETABLE_STATUSES = new Set(['pending', 'failed']);
  if (!DELETABLE_STATUSES.has(slot.status)) {
    return apiErrorResponse(
      409,
      slot.status === 'published'
        ? 'A published post cannot be deleted.'
        : `A slot with status "${slot.status}" cannot be deleted.`,
      { route: 'DELETE /api/schedule/slots', metadata: { status: slot.status } },
    );
  }

  // The last remaining slot of a schedule cannot be deleted individually —
  // that would leave an active but empty schedule. Delete the whole
  // schedule instead (DELETE /api/schedule?id=...). The check-and-delete is
  // atomic via the delete_slot_if_not_last RPC (row lock + count + delete
  // in one transaction); two concurrent deletes cannot both slip past the
  // guard.
  const { data: deleteResult, error: rpcError } = await supabase.rpc('delete_slot_if_not_last', {
    p_slot_id: slot.id,
    p_user_id: auth.userId,
  });
  if (rpcError) {
    return apiErrorResponse(500, 'Failed to delete slot.', {
      route: 'DELETE /api/schedule/slots',
      cause: rpcError,
    });
  }
  if (deleteResult === 'is_last_slot') {
    return apiErrorResponse(409, 'The schedule’s last slot cannot be deleted — delete the schedule instead.', {
      route: 'DELETE /api/schedule/slots',
    });
  }
  if (deleteResult === 'not_found') {
    return apiErrorResponse(404, 'Slot not found.', { route: 'DELETE /api/schedule/slots' });
  }
  if (deleteResult !== 'deleted') {
    // 'not_deletable': the slot dispatched between the status check and the
    // RPC — treat as a conflict so the caller retries the read.
    return apiErrorResponse(
      409,
      slot.status === 'published'
        ? 'A published post cannot be deleted.'
        : `A slot with status "${slot.status}" cannot be deleted.`,
      { route: 'DELETE /api/schedule/slots', metadata: { status: slot.status } },
    );
  }
  return NextResponse.json({ success: true });
}

//---------------
// PATCH — edit the topic of a slot that has not been dispatched to the
// engine yet (DB status 'pending', presented as 'awaiting'). The engine
// generates each video from the stored topic, so this is the edit-text
// action; anything already generating or beyond is rejected with 409.
// Only { topic: string } is accepted; the topic is trimmed and must be
// non-empty (same contract as the creation route's parseTopics).
//---------------
async function patchHandler(
  request: Request,
  context: { params: Promise<{ slotId: string }> },
): Promise<NextResponse> {
  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) return authError;
  const supabase =
    auth.isApiKey === true || auth.isOAuth === true
      ? createSupabaseServiceClient()
      : await createSupabaseServerClient();

  const { slotId } = await context.params;

  // Same normalization as DELETE: batch keys and percent-encoded ids
  // resolve to the slot uuid; anything else 404s before a uuid filter.
  const resolvedSlotId = resolveSlotUuid(slotId);
  if (resolvedSlotId === null) {
    return apiErrorResponse(404, 'Slot not found.', { route: 'PATCH /api/schedule/slots' });
  }

  const owned = await loadOwnedSlot(supabase, resolvedSlotId, auth.userId);
  if ('error' in owned) return owned.error;
  const slot = owned.slot;

  if (slot.status !== 'pending') {
    return apiErrorResponse(409, 'Only a slot that has not started generating can be edited.', {
      route: 'PATCH /api/schedule/slots',
      metadata: { status: slot.status },
    });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiErrorResponse(400, 'Request body must be valid JSON.', {
      route: 'PATCH /api/schedule/slots',
    });
  }
  const rawTopic = (body as { topic?: unknown } | null)?.topic;
  if (typeof rawTopic !== 'string' || rawTopic.trim() === '') {
    return apiErrorResponse(400, 'topic must be a non-empty string.', {
      route: 'PATCH /api/schedule/slots',
    });
  }
  const topic = rawTopic.trim();

  const { error: updateError } = await supabase
    .from('scheduled_posts')
    .update({ topic })
    .eq('id', slot.id)
    .eq('user_id', auth.userId)
    // Re-check the status in the UPDATE predicate itself: the slot may have
    // dispatched (pending → generating) between the check above and this
    // write. Zero affected rows means the guard failed — surface 409 so the
    // caller refetches instead of believing the edit landed.
    .eq('status', 'pending')
    .select('id')
    .single();
  if (updateError) {
    if ((updateError as { code?: string }).code === 'PGRST116') {
      return apiErrorResponse(409, 'Only a slot that has not started generating can be edited.', {
        route: 'PATCH /api/schedule/slots',
        metadata: { status: slot.status },
      });
    }
    return apiErrorResponse(500, 'Failed to update slot.', {
      route: 'PATCH /api/schedule/slots',
      cause: updateError,
    });
  }
  return NextResponse.json({ success: true, topic });
}

//---------------
// 5xx reporting: handled server errors reach PostHog error tracking.
//---------------
export const GET = withApiErrorReporting('GET /api/schedule/slots/[slotId]', getHandler, { getUserId: resolveReportingUserId });
export const DELETE = withApiErrorReporting('DELETE /api/schedule/slots/[slotId]', deleteHandler, { getUserId: resolveReportingUserId });
export const PATCH = withApiErrorReporting('PATCH /api/schedule/slots/[slotId]', patchHandler, { getUserId: resolveReportingUserId });
