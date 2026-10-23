import { NextRequest, NextResponse } from 'next/server';
import { engineAuthHeaders, requireSupabaseSession } from '@/lib/request-auth';
import { isPersonaAllowed, isScopedApiKey } from '@/lib/api-keys';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { apiErrorResponse } from '@/lib/api-error';
import { SAFE_TASK_ID } from '@/lib/video-urls';
import { logger } from '@/lib/logger';
import { withApiErrorReporting, resolveReportingUserId } from '@/lib/api-error-reporting';

//---------------
// DELETE /api/persona/video-task/:taskId — cancels/removes the task on the
// engine.
//
// Auth: cookie session (web) or API key / OAuth token (MCP cancel_video_task)
// via requireSupabaseSession(request). The engine's own delete handler reads
// the task through `get_task(task_id, user_id=auth.user_id)`
// (apps/engine/app/controllers/v1/video.py:586), so one user can never
// delete another user's task.
//
// A persona-scoped API key must not cancel a task outside its scope. The
// web rows that link a task to a persona are video_generations.engine_task_id
// (direct jobs) and scheduled_posts.task_id -> schedules.persona_id (scheduled
// jobs). The lookup is scoped by user_id explicitly because the service client
// bypasses RLS. An unresolvable link fails closed for a scoped key (404): the
// scope cannot be proven, so the key may not act on it.
//---------------

interface TaskScope {
  found: boolean;
  personaId: string | null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

async function resolveTaskScope(
  supabase: ReturnType<typeof createSupabaseServiceClient>,
  userId: string,
  taskId: string,
): Promise<TaskScope> {
  const { data: generation, error: generationError } = await supabase
    .from('video_generations')
    .select('persona_id')
    .eq('user_id', userId)
    .eq('engine_task_id', taskId)
    .limit(1)
    .maybeSingle();
  if (generationError) throw generationError;
  if (generation !== null) {
    return {
      found: true,
      personaId: stringOrNull((generation as { persona_id?: unknown }).persona_id),
    };
  }

  const { data: slot, error: slotError } = await supabase
    .from('scheduled_posts')
    .select('schedule_id')
    .eq('user_id', userId)
    .eq('task_id', taskId)
    .limit(1)
    .maybeSingle();
  if (slotError) throw slotError;
  if (slot === null) return { found: false, personaId: null };

  const scheduleId = stringOrNull((slot as { schedule_id?: unknown }).schedule_id);
  if (scheduleId === null) {
    // The slot row belongs to the caller (user_id filter above) but its
    // schedule link is unusable; treat it like a persona-less post.
    return { found: true, personaId: null };
  }

  const { data: schedule, error: scheduleError } = await supabase
    .from('schedules')
    .select('persona_id')
    .eq('id', scheduleId)
    .eq('user_id', userId)
    .maybeSingle();
  if (scheduleError) throw scheduleError;
  if (schedule === null) return { found: false, personaId: null };
  return {
    found: true,
    personaId: stringOrNull((schedule as { persona_id?: unknown }).persona_id),
  };
}

async function deleteHandler(
  request: NextRequest,
  context: { params: Promise<{ taskId: string }> },
): Promise<NextResponse> {
  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) return authError;

  const { taskId } = await context.params;

  if (!SAFE_TASK_ID.test(taskId)) {
    return apiErrorResponse(400, 'Invalid taskId.', { route: 'DELETE /api/persona/video-task' });
  }

  if (isScopedApiKey(auth)) {
    let scope: TaskScope;
    try {
      scope = await resolveTaskScope(createSupabaseServiceClient(), auth.userId, taskId);
    } catch (error) {
      logger.error('[api/persona/video-task] task scope lookup failed', error, { taskId });
      return apiErrorResponse(500, 'Failed to load video task.', {
        route: 'DELETE /api/persona/video-task',
        cause: error,
      });
    }
    if (!scope.found) {
      return apiErrorResponse(404, 'Video task not found.', { route: 'DELETE /api/persona/video-task' });
    }
    if (scope.personaId !== null && !isPersonaAllowed(auth.personaIds, scope.personaId)) {
      return apiErrorResponse(403, 'This API key does not have access to this video task.', {
        route: 'DELETE /api/persona/video-task',
      });
    }
  }

  const baseUrl = process.env.MONEYPRINT_API_URL;
  if (!baseUrl) {
    return apiErrorResponse(500, 'MONEYPRINT_API_URL is not defined', { route: 'DELETE /api/persona/video-task' });
  }

  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/v1/tasks/${encodeURIComponent(taskId)}`, {
      method: 'DELETE',
      headers: engineAuthHeaders(auth.userId),
    });
    if (response.status === 404) {
      // The engine scopes get_task by x-user-id, so 404 means "gone or not
      // yours" — the same answer for both, never a cross-user hint.
      return apiErrorResponse(404, 'Video task not found.', { route: 'DELETE /api/persona/video-task' });
    }
    const body: unknown = await response.json().catch(() => null);
    return NextResponse.json(body, { status: response.ok ? 200 : 502 });
  } catch (error) {
    return apiErrorResponse(502, 'Video service is unavailable.', {
      route: 'DELETE /api/persona/video-task',
      cause: error,
    });
  }
}

//---------------
// 5xx reporting: handled server errors reach PostHog error tracking.
//---------------
export const DELETE = withApiErrorReporting('DELETE /api/persona/video-task/[taskId]', deleteHandler, { getUserId: resolveReportingUserId });
