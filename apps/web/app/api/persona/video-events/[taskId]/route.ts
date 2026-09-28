import { NextResponse } from 'next/server';
import { engineAuthHeaders, requireSupabaseSession } from '@/lib/request-auth';
import { logger } from '@/lib/logger';

//---------------
// GET /api/persona/video-events/:taskId — SSE progress proxy.
// Forwards the engine's /api/v1/tasks/:taskId/events stream
// (text/event-stream). EventSource cannot send the Authorization header
// the engine requires, so the browser talks to this cookie-authenticated
// proxy instead. The stream is piped through without buffering.
// Terminal side effects (generation history + token refund) still live on
// the video-status proxy: clients do one final GET there after receiving
// a terminal snapshot.
//---------------

const SAFE_TASK_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export async function GET(
  request: Request,
  context: { params: Promise<{ taskId: string }> },
): Promise<Response> {
  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) return authError;

  const baseUrl = process.env.MONEYPRINT_API_URL;
  if (!baseUrl) {
    return NextResponse.json({ success: false, error: 'MONEYPRINT_API_URL is not defined' }, { status: 500 });
  }

  const { taskId } = await context.params;

  if (!SAFE_TASK_ID.test(taskId)) {
    return NextResponse.json({ success: false, error: 'Invalid taskId.' }, { status: 400 });
  }

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
    logger.error('[api/persona/video-events] upstream unavailable', error);
    return NextResponse.json({ success: false, error: 'Video service is unavailable.' }, { status: 502 });
  }
}
