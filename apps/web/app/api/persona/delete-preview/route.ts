import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { requireSupabaseSession } from '@/lib/request-auth';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { apiErrorResponse } from '@/lib/api-error';
import { ERROR_CODES } from '@/lib/error-codes';
import { logger } from '@/lib/logger';
import { withApiErrorReporting, resolveReportingUserId } from '@/lib/api-error-reporting';
import { scopedPersonaIdQuery } from '../persona-id-query';

const ROUTE = 'GET /api/persona/delete-preview';
const UPCOMING_SLOT_STATUSES = ['ready', 'publishing'] as const;

async function getHandler(request: Request): Promise<NextResponse> {
  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) return authError;
  const limited = await applyRateLimit(request, RATE_LIMITS.deletePreview, auth.userId);
  if (limited) return limited;
  const supabase =
    auth.isApiKey === true || auth.isOAuth === true
      ? createSupabaseServiceClient()
      : await createSupabaseServerClient();

  const requested = scopedPersonaIdQuery(request, auth.personaIds, ROUTE);
  if ('error' in requested) return requested.error;
  const personaId = requested.personaId;

  const { data: persona, error: personaError } = await supabase
    .from('personas')
    .select('id, name')
    .eq('id', personaId)
    .eq('user_id', auth.userId)
    .single();
  if (personaError || !persona) {
    if (personaError?.code === 'PGRST116') {
      return apiErrorResponse(404, 'Persona not found.', {
        route: ROUTE,
        code: ERROR_CODES.PERSONA_NOT_FOUND,
      });
    }
    logger.error('[api/persona/delete-preview] persona lookup failed', personaError);
    return apiErrorResponse(500, 'Failed to load persona.', {
      route: ROUTE,
      code: ERROR_CODES.INTERNAL_ERROR,
    });
  }

  const schedulesRes = await supabase
    .from('schedules')
    .select('id')
    .eq('persona_id', personaId)
    .eq('user_id', auth.userId);
  if (schedulesRes.error) {
    logger.error('[api/persona/delete-preview] count lookup failed', { schedules: schedulesRes.error });
    return apiErrorResponse(500, 'Failed to load delete preview.', {
      route: ROUTE,
      code: ERROR_CODES.INTERNAL_ERROR,
    });
  }

  const scheduleIds = (schedulesRes.data ?? [])
    .map((row) => (typeof row === 'object' && row !== null ? (row as { id: unknown }).id : null))
    .filter((id): id is string => typeof id === 'string');
  let upcomingSlots = 0;
  let publishedSlots = 0;
  let failedSlots = 0;
  if (scheduleIds.length > 0) {
    const [upcomingRes, publishedRes, failedRes] = await Promise.all([
      supabase
        .from('scheduled_posts')
        .select('id', { head: true, count: 'exact' })
        .in('schedule_id', scheduleIds)
        .in('status', UPCOMING_SLOT_STATUSES)
        .eq('user_id', auth.userId),
      supabase
        .from('scheduled_posts')
        .select('id', { head: true, count: 'exact' })
        .in('schedule_id', scheduleIds)
        .eq('status', 'published')
        .eq('user_id', auth.userId),
      supabase
        .from('scheduled_posts')
        .select('id', { head: true, count: 'exact' })
        .in('schedule_id', scheduleIds)
        .eq('status', 'failed')
        .eq('user_id', auth.userId),
    ]);
    if (upcomingRes.error || publishedRes.error || failedRes.error) {
      logger.error('[api/persona/delete-preview] slot lookup failed', {
        upcoming: upcomingRes.error,
        published: publishedRes.error,
        failed: failedRes.error,
      });
      return apiErrorResponse(500, 'Failed to load delete preview.', {
        route: ROUTE,
        code: ERROR_CODES.INTERNAL_ERROR,
      });
    }
    upcomingSlots = upcomingRes.count ?? 0;
    publishedSlots = publishedRes.count ?? 0;
    failedSlots = failedRes.count ?? 0;
  }

  return NextResponse.json({
    success: true,
    persona: {
      id: typeof persona.id === 'string' ? persona.id : '',
      name: typeof persona.name === 'string' ? persona.name : '',
    },
    counts: {
      schedules: scheduleIds.length,
      upcomingSlots,
      publishedSlots,
      failedSlots,
    },
  });
}

export const GET = withApiErrorReporting('GET /api/persona/delete-preview', getHandler, { getUserId: resolveReportingUserId });
