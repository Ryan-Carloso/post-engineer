import { NextRequest, NextResponse } from 'next/server';
import { engineAuthHeaders, requireSupabaseSession } from '@/lib/request-auth';
import { isPersonaAllowed, isScopedApiKey } from '@/lib/api-keys';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { apiErrorResponse } from '@/lib/api-error';
import { SAFE_TASK_ID } from '@/lib/video-urls';
import { logger } from '@/lib/logger';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { resolveTaskScope, type TaskScope } from '@/lib/video-task-scope';
import { withApiErrorReporting, resolveReportingUserId } from '@/lib/api-error-reporting';

async function deleteHandler(
  request: NextRequest,
  context: { params: Promise<{ taskId: string }> },
): Promise<NextResponse> {
  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) return authError;
  const limited = await applyRateLimit(request, RATE_LIMITS.videoTaskCancel, auth.userId);
  if (limited) return limited;

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

export const DELETE = withApiErrorReporting('DELETE /api/persona/video-task/[taskId]', deleteHandler, { getUserId: resolveReportingUserId });
