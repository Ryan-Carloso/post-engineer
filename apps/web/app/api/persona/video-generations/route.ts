import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { requireSupabaseSession } from '@/lib/request-auth';
import { isScopedApiKey } from '@/lib/api-keys';
import { logger } from '@/lib/logger';
import { generationPersonaOrFilter } from '@/lib/video-task-scope';
import { withApiErrorReporting, resolveReportingUserId } from '@/lib/api-error-reporting';
import {
  parseGenerationsLimit,
  type VideoGenerationRow,
} from '@/lib/contracts/video-tasks';
import { applyRateLimit, CALLER_RATE_LIMITS, profileForCaller } from '@/lib/rate-limit';

export { parseGenerationsLimit } from '@/lib/contracts/video-tasks';

async function getHandler(request: Request): Promise<NextResponse> {
  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) return authError;
  const limited = await applyRateLimit(request, profileForCaller(auth, CALLER_RATE_LIMITS.videoGenerationList), auth.userId);
  if (limited) return limited;
  const supabase =
    auth.isApiKey === true || auth.isOAuth === true
      ? createSupabaseServiceClient()
      : await createSupabaseServerClient();

  const limit = parseGenerationsLimit(new URL(request.url).searchParams.get('limit'));

  let generationsQuery = supabase
    .from('video_generations')
    .select(
      'id, generation_id, engine_task_id, persona_name, video_subject, status, error_code, tokens_refunded, created_at, completed_at',
    )
    .eq('user_id', auth.userId);
  if (isScopedApiKey(auth)) {
    const personaFilter = generationPersonaOrFilter(auth.personaIds);
    generationsQuery =
      personaFilter.kind === 'null'
        ? generationsQuery.is('persona_id', null)
        : generationsQuery.or(personaFilter.filter);
  }
  const { data, error } = await generationsQuery
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    logger.error('[api/persona/video-generations] list failed', error);
    return NextResponse.json(
      { success: false, error: 'Could not load generation history.' },
      { status: 500 },
    );
  }

  const generations: VideoGenerationRow[] = (data ?? []).map((row) => ({
    id: String(row.id),
    generationId: String(row.generation_id),
    engineTaskId: row.engine_task_id === null ? null : String(row.engine_task_id),
    personaName: row.persona_name === null ? null : String(row.persona_name),
    videoSubject: row.video_subject === null ? null : String(row.video_subject),
    status: String(row.status),
    errorCode: row.error_code === null ? null : String(row.error_code),
    tokensRefunded: row.tokens_refunded === true,
    createdAt: String(row.created_at),
    completedAt: row.completed_at === null ? null : String(row.completed_at),
  }));

  return NextResponse.json({ success: true, generations });
}

export const GET = withApiErrorReporting('GET /api/persona/video-generations', getHandler, {
  reportSuccess: false,
  getUserId: resolveReportingUserId,
});
