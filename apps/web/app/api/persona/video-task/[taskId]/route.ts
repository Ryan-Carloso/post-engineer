import { NextRequest, NextResponse } from 'next/server';
import { engineAuthHeaders, requireSupabaseSession } from '@/lib/request-auth';
import { isPersonaAllowed, isScopedApiKey } from '@/lib/api-keys';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { apiErrorResponse } from '@/lib/api-error';
import { SAFE_TASK_ID } from '@/lib/video-urls';
import { logger } from '@/lib/logger';
import { resolveTaskScope, type TaskScope } from '@/lib/video-task-scope';
import { withApiErrorReporting, resolveReportingUserId } from '@/lib/api-error-reporting';

//---------------
// DELETE /api/persona/video-task/:taskId — cancels/removes the task on the
// engine.
//
// Auth: cookie session (web) or API key / OAuth token (MCP cancel_video)
// via requireSupabaseSession(request). The engine's own delete handler reads
// the task through `get_task(task_id, user_id=auth.user_id)`
// (apps/engine/app/controllers/v1/video.py:586), so one user can never
// delete another user's task.
//
// A persona-scoped API key must not cancel a task outside its scope. The
// lookup (lib/video-task-scope) is scoped by user_id because the service
// client bypasses RLS. An unresolvable link, including a slot whose
// schedule row is gone, fails closed (404): the scope cannot be proven.
// A null persona stays allowed here. Reads use a stricter rule.
//---------------

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
    // scheduleMissing is fail-closed: a deleted schedule is not proof the
    // post was persona-less, so a scoped key may not cancel it.
    if (!scope.found || scope.scheduleMissing) {
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
