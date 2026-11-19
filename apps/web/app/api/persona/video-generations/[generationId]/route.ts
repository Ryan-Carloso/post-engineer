import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { requireSupabaseSession } from '@/lib/request-auth';
import { isScopedApiKey } from '@/lib/api-keys';
import { apiErrorResponse } from '@/lib/api-error';
import { generationPersonaOrFilter } from '@/lib/video-task-scope';
import { logger } from '@/lib/logger';
import { withApiErrorReporting, resolveReportingUserId } from '@/lib/api-error-reporting';
import type { VideoGenerationRow } from '@/lib/contracts/video-tasks';

interface DbGenerationRow {
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

async function getHandler(
  request: Request,
  context: { params: Promise<{ generationId: string }> },
): Promise<NextResponse> {
  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) return authError;
  const supabase =
    auth.isApiKey === true || auth.isOAuth === true
      ? createSupabaseServiceClient()
      : await createSupabaseServerClient();

  const { generationId } = await context.params;

  let generationQuery = supabase
    .from('video_generations')
    .select(
      'id, generation_id, engine_task_id, persona_name, video_subject, status, error_code, tokens_refunded, created_at, completed_at',
    )
    .eq('user_id', auth.userId)
    .eq('generation_id', generationId);
  if (isScopedApiKey(auth)) {
    const personaFilter = generationPersonaOrFilter(auth.personaIds);
    generationQuery =
      personaFilter.kind === 'null'
        ? generationQuery.is('persona_id', null)
        : generationQuery.or(personaFilter.filter);
  }
  const { data, error } = await generationQuery.single();

  if (error) {
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
  const row = data as DbGenerationRow;

  const generation: VideoGenerationRow = {
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
  };

  return NextResponse.json({
    success: true,
    generation,
  });
}

export const GET = withApiErrorReporting('GET /api/persona/video-generations/[generationId]', getHandler, { getUserId: resolveReportingUserId });
