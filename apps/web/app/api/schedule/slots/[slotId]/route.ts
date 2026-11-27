import { NextResponse } from 'next/server';
import { requireSupabaseSession } from '@/lib/request-auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { apiErrorResponse } from '@/lib/api-error';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { getSlotPost, personaScopeOf } from '@/lib/post-detail';
import { isPersonaAllowed } from '@/lib/api-keys';
import { resolveSlotUuid } from '@/lib/schedule-slot-id';
import { validateScheduleWindow } from '@/lib/schedule-window';
import { hasExplicitOffset } from '@/lib/timezone';
import { logger } from '@/lib/logger';
import { withApiErrorReporting, resolveReportingUserId } from '@/lib/api-error-reporting';
import { assertAccessActive } from '@/lib/access';

interface SlotRow {
  id: string;
  schedule_id: string;
  status: string;
  title: string | null;
}

interface ScheduleRow {
  id: string;
  user_id: string;
  persona_id: string | null;
  publish_mode: string | null;
}

async function loadOwnedSlot(
  supabase: ReturnType<typeof createSupabaseServiceClient>,
  slotId: string,
  userId: string,
  personaScope: readonly string[] | null,
): Promise<{ slot: SlotRow; publishMode: 'scheduled' | 'asap' } | { error: NextResponse }> {
  const { data: slot, error } = await supabase
    .from('scheduled_posts')
    .select('id, schedule_id, status, title')
    .eq('id', slotId)
    .eq('user_id', userId)
    .single();
  if (error) {
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
    .select('id, user_id, persona_id, publish_mode')
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
  if (
    !scheduleRow ||
    scheduleRow.user_id !== userId ||
    (personaScope !== null && scheduleRow.persona_id !== null && scheduleRow.persona_id !== undefined && !isPersonaAllowed(personaScope, scheduleRow.persona_id))
  ) {
    return { error: apiErrorResponse(404, 'Slot not found.', { route: 'SLOT_OPS /api/schedule/slots' }) };
  }
  const publishMode = scheduleRow.publish_mode === 'asap' ? 'asap' : 'scheduled';
  return { slot: row, publishMode };
}

async function getHandler(
  request: Request,
  context: { params: Promise<{ slotId: string }> },
): Promise<NextResponse> {
  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) return authError;
  const limited = await applyRateLimit(request, RATE_LIMITS.deletePreview, auth.userId);
  if (limited) return limited;
  const supabase =
    auth.isApiKey === true || auth.isOAuth === true
      ? createSupabaseServiceClient()
      : await createSupabaseServerClient();

  const { slotId } = await context.params;

  const resolvedSlotId = resolveSlotUuid(slotId);
  if (resolvedSlotId === null) {
    return apiErrorResponse(404, 'Slot not found.', { route: 'GET /api/schedule/slots' });
  }

  let detail;
  try {
    detail = await getSlotPost(supabase, resolvedSlotId, auth.userId, personaScopeOf(auth));
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
  const limited = await applyRateLimit(request, RATE_LIMITS.slotWrite, auth.userId);
  if (limited) return limited;
  const supabase =
    auth.isApiKey === true || auth.isOAuth === true
      ? createSupabaseServiceClient()
      : await createSupabaseServerClient();

  const { slotId } = await context.params;

  const resolvedSlotId = resolveSlotUuid(slotId);
  if (resolvedSlotId === null) {
    return apiErrorResponse(404, 'Slot not found.', { route: 'DELETE /api/schedule/slots' });
  }

  const owned = await loadOwnedSlot(supabase, resolvedSlotId, auth.userId, personaScopeOf(auth));
  if ('error' in owned) return owned.error;
  const slot = owned.slot;

  const DELETABLE_STATUSES = new Set(['ready', 'failed', 'expired']);
  if (!DELETABLE_STATUSES.has(slot.status)) {
    return apiErrorResponse(
      409,
      slot.status === 'published'
        ? 'A published post cannot be deleted.'
        : `A slot with status "${slot.status}" cannot be deleted.`,
      { route: 'DELETE /api/schedule/slots', metadata: { status: slot.status } },
    );
  }

  const { data: deleteResult, error: rpcError } = await createSupabaseServiceClient().rpc('delete_slot_if_not_last', {
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

async function patchHandler(
  request: Request,
  context: { params: Promise<{ slotId: string }> },
): Promise<NextResponse> {
  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) return authError;
  const limited = await applyRateLimit(request, RATE_LIMITS.slotWrite, auth.userId);
  if (limited) return limited;
  const supabase =
    auth.isApiKey === true || auth.isOAuth === true
      ? createSupabaseServiceClient()
      : await createSupabaseServerClient();

  const { slotId } = await context.params;

  const resolvedSlotId = resolveSlotUuid(slotId);
  if (resolvedSlotId === null) {
    return apiErrorResponse(404, 'Slot not found.', { route: 'PATCH /api/schedule/slots' });
  }

  const owned = await loadOwnedSlot(supabase, resolvedSlotId, auth.userId, personaScopeOf(auth));
  if ('error' in owned) return owned.error;
  const { slot, publishMode } = owned;

  const EDITABLE_STATUSES = new Set(['ready']);
  if (!EDITABLE_STATUSES.has(slot.status)) {
    return apiErrorResponse(409, 'Only a ready slot can be edited.', {
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
  const rawTitle = (body as { title?: unknown } | null)?.title;
  const rawSlotAt = (body as { slotAt?: unknown } | null)?.slotAt;
  if (rawTitle === undefined && rawSlotAt === undefined) {
    return apiErrorResponse(400, 'Provide title or slotAt to update.', {
      route: 'PATCH /api/schedule/slots',
    });
  }
  if (rawSlotAt !== undefined) {
    const blocked = await assertAccessActive(auth.userId, { route: 'PATCH /api/schedule/slots' });
    if (blocked) return blocked;
  }
  const patch: { title?: string; slot_at?: string } = {};
  let title: string | undefined;
  if (rawTitle !== undefined) {
    if (typeof rawTitle !== 'string' || rawTitle.trim() === '') {
      return apiErrorResponse(400, 'title must be a non-empty string.', {
        route: 'PATCH /api/schedule/slots',
      });
    }
    title = rawTitle.trim();
    patch.title = title;
  }
  let slotAt: string | undefined;
  if (rawSlotAt !== undefined) {
    if (typeof rawSlotAt !== 'string') {
      return apiErrorResponse(400, 'slotAt must be an ISO date string.', {
        route: 'PATCH /api/schedule/slots',
      });
    }
    if (!hasExplicitOffset(rawSlotAt)) {
      return apiErrorResponse(
        400,
        'slotAt must carry an explicit timezone offset (Z or ±hh:mm).',
        { route: 'PATCH /api/schedule/slots' },
      );
    }
    if (publishMode === 'asap') {
      return apiErrorResponse(409, 'An ASAP post has no scheduled time to move.', {
        route: 'PATCH /api/schedule/slots',
      });
    }
    const window = validateScheduleWindow(rawSlotAt);
    if (!window.ok) {
      return apiErrorResponse(400, window.error, {
        route: 'PATCH /api/schedule/slots',
      });
    }
    slotAt = new Date(rawSlotAt).toISOString();
    patch.slot_at = slotAt;
  }

  const { error: updateError } = await createSupabaseServiceClient()
    .from('scheduled_posts')
    .update(patch)
    .eq('id', slot.id)
    .eq('user_id', auth.userId)
    .in('status', ['ready'])
    .select('id')
    .single();
  if (updateError) {
    if ((updateError as { code?: string }).code === 'PGRST116') {
      return apiErrorResponse(409, 'Only a ready slot can be edited.', {
        route: 'PATCH /api/schedule/slots',
        metadata: { status: slot.status },
      });
    }
    return apiErrorResponse(500, 'Failed to update slot.', {
      route: 'PATCH /api/schedule/slots',
      cause: updateError,
    });
  }
  return NextResponse.json({
    success: true,
    ...(title !== undefined ? { title } : {}),
    ...(slotAt !== undefined ? { slotAt } : {}),
  });
}

export const GET = withApiErrorReporting('GET /api/schedule/slots/[slotId]', getHandler, {
  reportSuccess: false,
  getUserId: resolveReportingUserId,
});
export const DELETE = withApiErrorReporting('DELETE /api/schedule/slots/[slotId]', deleteHandler, { getUserId: resolveReportingUserId });
export const PATCH = withApiErrorReporting('PATCH /api/schedule/slots/[slotId]', patchHandler, { getUserId: resolveReportingUserId });
