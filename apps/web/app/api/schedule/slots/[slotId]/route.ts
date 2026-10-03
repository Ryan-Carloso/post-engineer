import { NextResponse } from 'next/server';
import { requireSupabaseSession } from '@/lib/request-auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { apiErrorResponse } from '@/lib/api-error';
import { enrichSlot } from '@/lib/schedule-slot-presentation';
import { fetchEnginePublishResults } from '@/lib/engine-tasks';
import { resolvePublishLinks, type PublishLink } from '@/lib/publish-links';
import { logger } from '@/lib/logger';

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
    return { error: apiErrorResponse(404, 'Slot not found.', { route: 'SLOT_OPS /api/schedule/slots' }) };
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
    return { error: apiErrorResponse(404, 'Slot not found.', { route: 'SLOT_OPS /api/schedule/slots' }) };
  }
  return { slot: row };
}

//---------------
// resolveSlotPublishLinks — where the post went, per provider.
//
// publish_results only exists in the engine's task record, so a published
// slot costs one engine round-trip here (single slot, not a list — no N+1).
// Only a published slot is worth it: nothing earlier has a link yet.
//
// Best-effort by design. The post is already loaded and renderable, so a
// failed lookup degrades to "no links" and logs loudly instead of turning a
// published post into a 404/500. Never throws.
//---------------
async function resolveSlotPublishLinks(
  row: { status?: unknown; task_id?: unknown },
  userId: string,
): Promise<PublishLink[]> {
  if (row.status !== 'published') return [];
  const taskId = typeof row.task_id === 'string' ? row.task_id : null;
  if (taskId === null || taskId.length === 0) return [];
  try {
    return resolvePublishLinks(await fetchEnginePublishResults(taskId, userId));
  } catch (error) {
    logger.warn('[api/schedule/slots] publish results unavailable', {
      taskId,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

//---------------
// GET — one post's full detail: the slot row, its schedule (providers +
// account ids, so clients can resolve the target accounts) and the
// persona. Presentation follows /api/schedule/status (pending→awaiting,
// live engine progress for generating/failed slots via the shared
// enrichSlot helper). Unknown id or another user's slot → 404, never the
// row.
//---------------
export async function GET(
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

  const { data: slot, error: slotError } = await supabase
    .from('scheduled_posts')
    .select('id, schedule_id, slot_at, status, topic, error, published_at, task_id')
    .eq('id', slotId)
    .eq('user_id', auth.userId)
    .single();
  if (slotError) {
    // PGRST116 (zero rows) is the only honest 404 — unknown id or another
    // user's slot. Anything else is a DB failure: log loudly with the real
    // error and return 500 so callers retry instead of giving up.
    if ((slotError as { code?: string }).code === 'PGRST116') {
      return apiErrorResponse(404, 'Slot not found.', { route: 'GET /api/schedule/slots' });
    }
    logger.error('[api/schedule/slots] slot lookup failed', slotError);
    return apiErrorResponse(500, 'Failed to load post.', {
      route: 'GET /api/schedule/slots',
      cause: slotError,
    });
  }
  const row = slot as {
    id: string;
    schedule_id: string;
    slot_at: string;
    status: string;
    topic: string | null;
    error: string | null;
    published_at: string | null;
    task_id: string | null;
  };

  const { data: schedule, error: scheduleError } = await supabase
    .from('schedules')
    .select('id, persona_id, providers, youtube_account_ids, instagram_account_ids, linkedin_account_ids')
    .eq('id', row.schedule_id)
    .eq('user_id', auth.userId)
    .maybeSingle();
  // Ownership re-check: the service client (API-key/OAuth callers)
  // bypasses RLS, so the schedule must belong to the caller.
  if (scheduleError) {
    logger.error('[api/schedule/slots] schedule lookup failed', scheduleError);
    return apiErrorResponse(500, 'Failed to load post.', {
      route: 'GET /api/schedule/slots',
      cause: scheduleError,
    });
  }
  const scheduleRow = schedule as {
    id: string;
    persona_id: string;
    providers: string[] | null;
    youtube_account_ids: string[] | null;
    instagram_account_ids: string[] | null;
    linkedin_account_ids: string[] | null;
  } | null;
  // Ownership re-check: the service client (API-key/OAuth callers)
  // bypasses RLS, so the schedule must belong to the caller.
  if (!scheduleRow) {
    return apiErrorResponse(404, 'Slot not found.', { route: 'GET /api/schedule/slots' });
  }

  const { data: persona, error: personaError } = await supabase
    .from('personas')
    .select('id, name')
    .eq('id', scheduleRow.persona_id)
    .single();
  if (personaError && (personaError as { code?: string }).code !== 'PGRST116') {
    // The persona name is cosmetic on the detail page — a failed lookup
    // degrades to a null persona, but never silently.
    logger.warn('[api/schedule/slots] persona lookup failed', {
      code: personaError.code,
      message: personaError.message,
    });
  }
  const personaRow = persona as { id: string; name: string } | null;

  const enrichment = await enrichSlot(row, auth.userId);
  const publishLinks = await resolveSlotPublishLinks(row, auth.userId);

  return NextResponse.json({
    success: true,
    slot: {
      id: row.id,
      scheduleId: row.schedule_id,
      slotAt: row.slot_at,
      status: enrichment.status,
      topic: row.topic,
      error: row.error,
      publishedAt: row.published_at,
      taskId: row.task_id,
      progress: enrichment.progress,
      stage: enrichment.stage,
      retryable: enrichment.retryable,
      publishLinks,
      // Queue position is a list concept (position among the schedule's
      // pending slots); the detail view doesn't render it.
      queuePosition: null,
      queueTotal: null,
    },
    schedule: {
      id: scheduleRow.id,
      personaId: scheduleRow.persona_id,
      providers: scheduleRow.providers ?? [],
      youtubeAccountIds: scheduleRow.youtube_account_ids ?? [],
      instagramAccountIds: scheduleRow.instagram_account_ids ?? [],
      linkedinAccountIds: scheduleRow.linkedin_account_ids ?? [],
    },
    persona: personaRow ? { id: personaRow.id, name: personaRow.name } : null,
  });
}

export async function DELETE(
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
  const supabase =
    auth.isApiKey === true || auth.isOAuth === true
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
