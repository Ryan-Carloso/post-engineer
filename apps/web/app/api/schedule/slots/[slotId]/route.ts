import { NextResponse } from 'next/server';
import { requireSupabaseSession } from '@/lib/request-auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { apiErrorResponse } from '@/lib/api-error';

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
  if (error || !slot) {
    return { error: apiErrorResponse(404, 'Slot not found.', { route: 'DELETE /api/schedule/slots' }) };
  }
  const row = slot as SlotRow;
  const { data: schedule } = await supabase
    .from('schedules')
    .select('id, user_id')
    .eq('id', row.schedule_id)
    .maybeSingle();
  const scheduleRow = schedule as ScheduleRow | null;
  // Explicit ownership check: the service client bypasses RLS, so the
  // schedule row must belong to the caller.
  if (!scheduleRow || scheduleRow.user_id !== userId) {
    return { error: apiErrorResponse(404, 'Slot not found.', { route: 'DELETE /api/schedule/slots' }) };
  }
  return { slot: row };
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ slotId: string }> },
): Promise<NextResponse> {
  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) return authError;
  const supabase = auth.isApiKey === true
    ? createSupabaseServiceClient()
    : await createSupabaseServerClient();

  const { slotId } = await context.params;

  const owned = await loadOwnedSlot(supabase, slotId, auth.userId);
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
  // schedule instead (DELETE /api/schedule?id=...).
  const { data: remaining } = await supabase
    .from('scheduled_posts')
    .select('id')
    .eq('schedule_id', slot.schedule_id)
    .neq('id', slot.id)
    .limit(1);
  const remainingRows = Array.isArray(remaining) ? (remaining as { id: string }[]) : [];
  if (remainingRows.length === 0) {
    return apiErrorResponse(409, 'The schedule’s last slot cannot be deleted — delete the schedule instead.', {
      route: 'DELETE /api/schedule/slots',
    });
  }

  const { error: deleteError } = await supabase
    .from('scheduled_posts')
    .delete()
    .eq('id', slot.id)
    .eq('user_id', auth.userId);
  if (deleteError) {
    return apiErrorResponse(500, 'Failed to delete slot.', {
      route: 'DELETE /api/schedule/slots',
      cause: deleteError,
    });
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
export async function PATCH(
  request: Request,
  context: { params: Promise<{ slotId: string }> },
): Promise<NextResponse> {
  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) return authError;
  const supabase = auth.isApiKey === true
    ? createSupabaseServiceClient()
    : await createSupabaseServerClient();

  const { slotId } = await context.params;

  const owned = await loadOwnedSlot(supabase, slotId, auth.userId);
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
    .eq('user_id', auth.userId);
  if (updateError) {
    return apiErrorResponse(500, 'Failed to update slot.', {
      route: 'PATCH /api/schedule/slots',
      cause: updateError,
    });
  }
  return NextResponse.json({ success: true, topic });
}
