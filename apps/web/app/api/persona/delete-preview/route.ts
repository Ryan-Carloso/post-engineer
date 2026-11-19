import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { engineAuthHeaders, requireSupabaseSession } from '@/lib/request-auth';
import { isPersonaAllowed } from '@/lib/api-keys';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { apiErrorResponse } from '@/lib/api-error';
import { ERROR_CODES } from '@/lib/error-codes';
import { logger } from '@/lib/logger';
import { firstDownloadUrl, rewriteVideoUrls, SAFE_TASK_ID } from '@/lib/video-urls';
import { parsePersonaIdQuery } from '@/lib/contracts/personas';
import { withApiErrorReporting, resolveReportingUserId } from '@/lib/api-error-reporting';

const ROUTE = 'GET /api/persona/delete-preview';
const UPCOMING_SLOT_STATUSES = ['pending', 'generating', 'ready', 'publishing'];
const ENGINE_LOOKUP_TIMEOUT_MS = 8000;
const PREVIEW_VIDEO_CAP = 20;
const PREVIEW_LOOKUP_BUDGET_MS = 15_000;

interface GenerationRow {
  id: string;
  engine_task_id: string | null;
  video_subject: string | null;
  status: string;
}

function asGenerationRow(row: unknown): GenerationRow | null {
  if (typeof row !== 'object' || row === null) return null;
  const r = row as Record<string, unknown>;
  if (typeof r.id !== 'string') return null;
  return {
    id: r.id,
    engine_task_id: typeof r.engine_task_id === 'string' ? r.engine_task_id : null,
    video_subject: typeof r.video_subject === 'string' ? r.video_subject : null,
    status: typeof r.status === 'string' ? r.status : 'unknown',
  };
}

type DownloadLookup = {
  url: string | null;
  transientFailure: boolean;
};

async function resolveDownloadUrl(
  engineTaskId: string,
  userId: string,
  baseUrl: string,
): Promise<DownloadLookup> {
  if (!SAFE_TASK_ID.test(engineTaskId)) {
    logger.warn('[api/persona/delete-preview] skipping unsafe task id', { engineTaskId });
    return { url: null, transientFailure: false };
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ENGINE_LOOKUP_TIMEOUT_MS);
  let headers: Record<string, string>;
  try {
    headers = engineAuthHeaders(userId);
  } catch (error) {
    logger.error('[api/persona/delete-preview] engine auth misconfigured', { engineTaskId, error });
    clearTimeout(timeout);
    return { url: null, transientFailure: false };
  }
  try {
    const response = await fetch(
      `${baseUrl.replace(/\/+$/, '')}/api/v1/tasks/${encodeURIComponent(engineTaskId)}`,
      { headers, cache: 'no-store', signal: controller.signal },
    );
    if (!response.ok) {
      const transient = response.status >= 500 || response.status === 429;
      const logFn = response.status === 401 || response.status === 403 ? logger.error : logger.warn;
      logFn('[api/persona/delete-preview] engine task lookup failed', {
        engineTaskId,
        status: response.status,
        transient,
      });
      return { url: null, transientFailure: transient };
    }
    const body: unknown = await response.json().catch((error: unknown) => {
      logger.warn('[api/persona/delete-preview] engine task response unparseable', {
        engineTaskId,
        error,
      });
      return undefined;
    });
    if (body === undefined) {
      return { url: null, transientFailure: true };
    }
    return { url: firstDownloadUrl(rewriteVideoUrls(body, engineTaskId, baseUrl)), transientFailure: false };
  } catch (error) {
    logger.warn('[api/persona/delete-preview] engine task lookup failed', { engineTaskId, error });
    return { url: null, transientFailure: true };
  } finally {
    clearTimeout(timeout);
  }
}

async function getHandler(request: Request): Promise<NextResponse> {
  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) return authError;
  const limited = await applyRateLimit(request, RATE_LIMITS.deletePreview, auth.userId);
  if (limited) return limited;
  const supabase =
    auth.isApiKey === true || auth.isOAuth === true
      ? createSupabaseServiceClient()
      : await createSupabaseServerClient();

  const parsedPersonaId = parsePersonaIdQuery(request.url);
  if (!parsedPersonaId.ok) {
    return apiErrorResponse(400, parsedPersonaId.error, {
      route: ROUTE,
      code: ERROR_CODES.VALIDATION_FAILED,
      field: 'personaId',
    });
  }
  const personaId = parsedPersonaId.query.personaId;
  if (!isPersonaAllowed(auth.personaIds, personaId)) {
    return apiErrorResponse(403, 'This API key cannot access this persona.', {
      route: ROUTE,
      code: ERROR_CODES.PERSONA_SCOPE_DENIED,
      field: 'personaId',
    });
  }

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

  const [schedulesRes, generationsCountRes, imagesCountRes, generationsListRes] = await Promise.all([
    supabase.from('schedules').select('id').eq('persona_id', personaId).eq('user_id', auth.userId),
    supabase
      .from('video_generations')
      .select('id', { head: true, count: 'exact' })
      .eq('persona_id', personaId)
      .eq('user_id', auth.userId),
    supabase
      .from('persona_images')
      .select('id', { head: true, count: 'exact' })
      .eq('persona_id', personaId)
      .eq('user_id', auth.userId),
    supabase
      .from('video_generations')
      .select('id, engine_task_id, video_subject, status')
      .eq('persona_id', personaId)
      .eq('user_id', auth.userId)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(PREVIEW_VIDEO_CAP),
  ]);
  if (schedulesRes.error || generationsCountRes.error || imagesCountRes.error || generationsListRes.error) {
    logger.error('[api/persona/delete-preview] count lookup failed', {
      schedules: schedulesRes.error,
      generations: generationsCountRes.error ?? generationsListRes.error,
      images: imagesCountRes.error,
    });
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

  const generations = (generationsListRes.data ?? [])
    .map(asGenerationRow)
    .filter((row): row is GenerationRow => row !== null);
  const totalGenerations = generationsCountRes.count ?? 0;

  const baseUrl = process.env.MONEYPRINT_API_URL;
  if (!baseUrl) {
    logger.warn('[api/persona/delete-preview] MONEYPRINT_API_URL is not set; download links unavailable');
  }
  const lookupStart = Date.now();
  let linksIncomplete = false;
  const videos: Array<{
    taskId: string | null;
    title: string | null;
    status: string;
    downloadUrl: string | null;
  }> = [];
  for (const gen of generations) {
    let downloadUrl: string | null = null;
    if (gen.status === 'completed' && gen.engine_task_id && baseUrl) {
      if (Date.now() - lookupStart < PREVIEW_LOOKUP_BUDGET_MS) {
        const lookup = await resolveDownloadUrl(gen.engine_task_id, auth.userId, baseUrl);
        downloadUrl = lookup.url;
        if (lookup.transientFailure) linksIncomplete = true;
      } else {
        linksIncomplete = true;
      }
    }
    videos.push({
      taskId: gen.engine_task_id,
      title: gen.video_subject,
      status: gen.status,
      downloadUrl,
    });
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
      generatedVideos: totalGenerations,
      personaImages: imagesCountRes.count ?? 0,
    },
    videos,
    videosTruncated: totalGenerations > videos.length,
    linksIncomplete,
  });
}

export const GET = withApiErrorReporting('GET /api/persona/delete-preview', getHandler, { getUserId: resolveReportingUserId });
