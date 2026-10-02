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

//---------------
// GET /api/persona/delete-preview?personaId= — what deleting the persona
// would remove: counts plus per-video download links so the user can save
// their videos first. Read-only: never mutates. Ownership is enforced like
// the DELETE handler (service-role callers are re-scoped by user_id).
//---------------

const ROUTE = 'GET /api/persona/delete-preview';
// Slots that have not reached a terminal state: these are the ones the
// user is giving up by deleting the persona.
const UPCOMING_SLOT_STATUSES = ['pending', 'generating', 'ready', 'publishing'];
const ENGINE_LOOKUP_TIMEOUT_MS = 8000;
// Cap on per-video engine lookups: each is a network call with its own
// timeout, and a persona with hundreds of videos would otherwise hold the
// request open for minutes. counts.generatedVideos still reports the full
// total; videos carries download links for the first N.
const PREVIEW_VIDEO_CAP = 20;
// Aggregate budget for the engine lookups: a slow-but-alive engine would
// otherwise burn the full per-call timeout on every video (20 x 8s).
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

// Best-effort: fetch the engine task state and extract the first
// downloadable video URL via the shared rewriter. Any failure (engine
// down, task pruned, unsafe id) yields null — the UI renders "download
// unavailable" instead of a broken link.
async function resolveDownloadUrl(
  engineTaskId: string,
  userId: string,
  baseUrl: string,
): Promise<string | null> {
  if (!SAFE_TASK_ID.test(engineTaskId)) {
    logger.warn('[api/persona/delete-preview] skipping unsafe task id', { engineTaskId });
    return null;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ENGINE_LOOKUP_TIMEOUT_MS);
  try {
    const response = await fetch(
      `${baseUrl.replace(/\/+$/, '')}/api/v1/tasks/${encodeURIComponent(engineTaskId)}`,
      { headers: engineAuthHeaders(userId), cache: 'no-store', signal: controller.signal },
    );
    if (!response.ok) {
      logger.warn('[api/persona/delete-preview] engine task lookup failed', {
        engineTaskId,
        status: response.status,
      });
      return null;
    }
    const body: unknown = await response.json().catch(() => null);
    return firstDownloadUrl(rewriteVideoUrls(body, engineTaskId, baseUrl));
  } catch (error) {
    logger.warn('[api/persona/delete-preview] engine task lookup failed', { engineTaskId, error });
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET(request: Request): Promise<NextResponse> {
  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) return authError;
  const limited = await applyRateLimit(request, RATE_LIMITS.deletePreview, auth.userId);
  if (limited) return limited;
  // Service-role bypasses RLS: every query below is re-scoped by user_id,
  // and the persona row itself is the ownership proof. OAuth callers have
  // no cookie session, so they get the service client like API keys.
  const supabase =
    auth.isApiKey === true || auth.isOAuth === true
      ? createSupabaseServiceClient()
      : await createSupabaseServerClient();

  const personaId = new URL(request.url).searchParams.get('personaId');
  if (!personaId) {
    return apiErrorResponse(400, 'personaId is required.', {
      route: ROUTE,
      code: ERROR_CODES.VALIDATION_FAILED,
      field: 'personaId',
    });
  }
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
    // PGRST116 = zero rows: missing or belongs to someone else. Any other
    // error is a real DB failure — a bare 404 would hide it.
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

  // Independent reads go through Promise.all; the slot count needs the
  // schedule ids first, so it runs after.
  const [schedulesRes, generationsRes, imagesRes] = await Promise.all([
    supabase.from('schedules').select('id').eq('persona_id', personaId).eq('user_id', auth.userId),
    supabase
      .from('video_generations')
      .select('id, engine_task_id, video_subject, status')
      .eq('persona_id', personaId)
      .eq('user_id', auth.userId),
    supabase.from('persona_images').select('id').eq('persona_id', personaId).eq('user_id', auth.userId),
  ]);
  if (schedulesRes.error || generationsRes.error || imagesRes.error) {
    logger.error('[api/persona/delete-preview] count lookup failed', {
      schedules: schedulesRes.error,
      generations: generationsRes.error,
      images: imagesRes.error,
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
  if (scheduleIds.length > 0) {
    const { data: slots, error: slotsError } = await supabase
      .from('scheduled_posts')
      .select('id')
      .in('schedule_id', scheduleIds)
      .in('status', UPCOMING_SLOT_STATUSES);
    if (slotsError) {
      logger.error('[api/persona/delete-preview] slot lookup failed', slotsError);
      return apiErrorResponse(500, 'Failed to load delete preview.', {
        route: ROUTE,
        code: ERROR_CODES.INTERNAL_ERROR,
      });
    }
    upcomingSlots = slots?.length ?? 0;
  }

  const generations = (generationsRes.data ?? [])
    .map(asGenerationRow)
    .filter((row): row is GenerationRow => row !== null);

  // Sequential on purpose: one small JSON body in flight at a time, and a
  // slow engine cannot fan out into dozens of concurrent lookups. Capped
  // at PREVIEW_VIDEO_CAP so a huge library cannot hold the request open
  // for minutes on serverless.
  const baseUrl = process.env.MONEYPRINT_API_URL;
  const lookupStart = Date.now();
  let linksIncomplete = false;
  const videos: Array<{
    taskId: string | null;
    topic: string | null;
    status: string;
    downloadUrl: string | null;
  }> = [];
  for (const gen of generations.slice(0, PREVIEW_VIDEO_CAP)) {
    let downloadUrl: string | null = null;
    if (gen.status === 'completed' && gen.engine_task_id && baseUrl) {
      if (Date.now() - lookupStart < PREVIEW_LOOKUP_BUDGET_MS) {
        downloadUrl = await resolveDownloadUrl(gen.engine_task_id, auth.userId, baseUrl);
      } else {
        // Budget spent: the video exists, but its download link could not
        // be confirmed. Flag it so the UI does not present this as
        // "unrecoverable".
        linksIncomplete = true;
      }
    }
    videos.push({
      taskId: gen.engine_task_id,
      topic: gen.video_subject,
      status: gen.status,
      downloadUrl,
    });
  }

  return NextResponse.json({
    success: true,
    persona: {
      id: persona.id,
      name: typeof persona.name === 'string' ? persona.name : '',
    },
    counts: {
      schedules: scheduleIds.length,
      upcomingSlots,
      generatedVideos: generations.length,
      personaImages: imagesRes.data?.length ?? 0,
    },
    videos,
    videosTruncated: generations.length > videos.length,
    linksIncomplete,
  });
}
