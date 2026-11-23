import { NextResponse } from 'next/server';
import { engineAuthHeaders, requireSupabaseSession } from '@/lib/request-auth';
import { apiErrorResponse } from '@/lib/api-error';
import { SAFE_TASK_ID } from '@/lib/video-urls';
import { enforceScopedTaskRead } from '@/lib/video-task-scope';
import { applyTaskPollLimit } from '@/lib/task-poll-limit';
import { RATE_LIMITS } from '@/lib/rate-limit';
import { withApiErrorReporting, resolveReportingUserId } from '@/lib/api-error-reporting';

async function getHandler(
  request: Request,
  context: { params: Promise<{ taskId: string }> },
): Promise<Response> {
  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) return authError;

  const baseUrl = process.env.MONEYPRINT_API_URL;
  if (!baseUrl) {
    return apiErrorResponse(500, 'MONEYPRINT_API_URL is not defined', { route: 'GET /api/persona/video-events' });
  }

  const { taskId } = await context.params;

  if (!SAFE_TASK_ID.test(taskId)) {
    return apiErrorResponse(400, 'Invalid taskId.', { route: 'GET /api/persona/video-events' });
  }

  const streamLimited = await applyTaskPollLimit(request, auth, taskId, RATE_LIMITS.taskEventsStream);
  if (streamLimited) return streamLimited;

  const scopeError = await enforceScopedTaskRead(
    auth,
    taskId,
    'GET /api/persona/video-events',
    'Video task not found.',
  );
  if (scopeError) return scopeError;

  try {
    const upstream = await fetch(
      `${baseUrl.replace(/\/+$/, '')}/api/v1/tasks/${encodeURIComponent(taskId)}/events`,
      { headers: engineAuthHeaders(auth.userId) },
    );
    if (!upstream.ok || !upstream.body) {
      return NextResponse.json(
        { success: false, error: 'Video progress stream is unavailable.' },
        { status: upstream.ok ? 502 : upstream.status },
      );
    }
    return new Response(upstream.body, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (error) {
    return apiErrorResponse(502, 'Video service is unavailable.', {
      route: 'GET /api/persona/video-events',
      cause: error,
    });
  }
}

export const GET = withApiErrorReporting('GET /api/persona/video-events/[taskId]', getHandler, { getUserId: resolveReportingUserId });
