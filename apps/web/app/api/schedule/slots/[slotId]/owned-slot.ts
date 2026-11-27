import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { apiErrorResponse } from '@/lib/api-error';
import { isPersonaAllowed } from '@/lib/api-keys';
import { resolveSlotUuid } from '@/lib/schedule-slot-id';
import { ERROR_CODES } from '@/lib/error-codes';
import { logger } from '@/lib/logger';

interface SlotRow {
  id: string;
  schedule_id: string;
  status: string;
  title: string | null;
  description: string | null;
  slot_at: string;
  media_ref: string | null;
  media_kind: string | null;
  media_content_type: string | null;
  first_comment: string | null;
}

interface ScheduleRow {
  id: string;
  user_id: string;
  persona_id: string | null;
  publish_mode: string | null;
}

export async function loadOwnedSlot(
  supabase: ReturnType<typeof createSupabaseServiceClient>,
  slotId: string,
  userId: string,
  personaScope: readonly string[] | null,
): Promise<{ slot: SlotRow; publishMode: 'scheduled' | 'asap' } | { error: NextResponse }> {
  const { data: slot, error } = await supabase
    .from('scheduled_posts')
    .select('id, schedule_id, status, title, description, slot_at, media_ref, media_kind, media_content_type, first_comment')
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

export interface SlotRouteContext {
  params: Promise<{ slotId: string }>;
}

export function notAwaitingApproval(route: string, verb: 'approved' | 'rejected', status: string): NextResponse {
  return apiErrorResponse(409, `Only an awaiting-approval slot can be ${verb}.`, {
    route,
    code: ERROR_CODES.SLOT_NOT_AWAITING_APPROVAL,
    metadata: { status },
  });
}

export async function loadAwaitingApprovalSlot(
  context: SlotRouteContext,
  userId: string,
  personaScope: readonly string[] | null,
  route: string,
  verb: 'approved' | 'rejected',
): Promise<{ slot: SlotRow; publishMode: 'scheduled' | 'asap' } | { error: NextResponse }> {
  const supabase = await createSupabaseServerClient();
  const resolvedSlotId = resolveSlotUuid((await context.params).slotId);
  if (resolvedSlotId === null) {
    return { error: apiErrorResponse(404, 'Slot not found.', { route }) };
  }
  const owned = await loadOwnedSlot(supabase, resolvedSlotId, userId, personaScope);
  if ('error' in owned) return owned;
  if (owned.slot.status !== 'awaiting_approval') return { error: notAwaitingApproval(route, verb, owned.slot.status) };
  return owned;
}
