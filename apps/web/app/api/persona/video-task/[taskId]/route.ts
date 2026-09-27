import { NextRequest, NextResponse } from 'next/server';
import { engineAuthHeaders, requireSupabaseSession } from '@/lib/request-auth';

//---------------
// DELETE /api/persona/video-task/:taskId — cancela/remove task no motor.
// Disponível para cleanup do produto.
//---------------

const SAFE_TASK_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ taskId: string }> },
): Promise<NextResponse> {
  const { auth, error: authError } = await requireSupabaseSession();
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
    const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/v1/tasks/${encodeURIComponent(taskId)}`, {
      method: 'DELETE',
      headers: engineAuthHeaders(auth.userId),
    });
    const body: unknown = await response.json().catch(() => null);
    return NextResponse.json(body, { status: response.ok ? 200 : 502 });
  } catch (error) {
    console.error('[api/persona/video-task] upstream unavailable', { error });
    return NextResponse.json({ success: false, error: 'Video service is unavailable.' }, { status: 502 });
  }
}
