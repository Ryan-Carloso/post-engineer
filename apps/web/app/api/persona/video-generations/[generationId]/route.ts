import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { requireSupabaseSession } from '@/lib/request-auth';
import { apiErrorResponse } from '@/lib/api-error';
import { logger } from '@/lib/logger';

//---------------
// GET /api/persona/video-generations/[generationId] — one generation's
// detail, the exact row shape of the list route. The Posts detail page
// resolves by id so it never needs to pull the whole history; unknown id
// or another user's row → 404.
//---------------

interface GenerationRow {
  id: string;
  generation_id: string;
  engine_task_id: string | null;
  persona_name: string | null;
  video_subject: string | null;
  status: string;
  error_code: string | null;
  tokens_refunded: boolean;
  created_at: string;
  completed_at: string | null;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ generationId: string }> },
): Promise<NextResponse> {
  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) return authError;
  // API-key/OAuth callers have no cookie session, so the service client
  // (scoped by user_id below) is used; web sessions keep the server client.
  const supabase =
    auth.isApiKey === true || auth.isOAuth === true
      ? createSupabaseServiceClient()
      : await createSupabaseServerClient();

  const { generationId } = await context.params;

  const { data, error } = await supabase
    .from('video_generations')
    .select(
      'id, generation_id, engine_task_id, persona_name, video_subject, status, error_code, tokens_refunded, created_at, completed_at',
    )
    .eq('user_id', auth.userId)
    .eq('generation_id', generationId)
    .single();

  if (error) {
    // PGRST116 (zero rows) is the only honest 404 — unknown id or another
    // user's row. Anything else is a DB failure: log loudly with the real
    // error and return 500 so callers retry instead of giving up.
    if ((error as { code?: string }).code === 'PGRST116') {
      return apiErrorResponse(404, 'Generation not found.', {
        route: 'GET /api/persona/video-generations/[generationId]',
      });
    }
    logger.error('[api/persona/video-generations] generation lookup failed', error);
    return apiErrorResponse(500, 'Failed to load post.', {
      route: 'GET /api/persona/video-generations/[generationId]',
      cause: error,
    });
  }
  const row = data as GenerationRow;

  return NextResponse.json({
    success: true,
    generation: {
      id: row.id,
      generationId: row.generation_id,
      engineTaskId: row.engine_task_id,
      personaName: row.persona_name,
      videoSubject: row.video_subject,
      status: row.status,
      errorCode: row.error_code,
      tokensRefunded: row.tokens_refunded === true,
      createdAt: row.created_at,
      completedAt: row.completed_at,
    },
  });
}
