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
type DownloadLookup = {
  url: string | null;
  // True when the lookup failed transiently (engine 5xx, network error,
  // abort): the video file may still exist, so the UI must not present
  // this as unrecoverable. False for 404/unsafe-id (truly gone).
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
  // engineAuthHeaders throws on missing MONEYPRINT_API_SECRET: a config
  // error, not a transient failure. Compute it before the try so the catch
  // below only sees fetch/abort/network errors (all transient).
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
      // 404: task pruned, truly gone. 401/403: auth misconfig — retry
      // cannot fix it. 5xx/429: transient.
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
      // A 200 with a garbled body is almost certainly transient — never
      // present it as unrecoverable.
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
  // schedule ids first, so it runs after. Generation/image counts use
  // head+count (no rows cross the wire); the video list is bounded and
  // deterministically ordered (created_at, id tie-break). The schedules id
  // list is intentionally unbounded: schedules are posting configurations
  // (a handful per persona), not per-video rows — unlike generations, they
  // cannot number in the thousands.
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
  if (scheduleIds.length > 0) {
    const { count: slotsCount, error: slotsError } = await supabase
      .from('scheduled_posts')
      .select('id', { head: true, count: 'exact' })
      .in('schedule_id', scheduleIds)
      .in('status', UPCOMING_SLOT_STATUSES)
      .eq('user_id', auth.userId);
    if (slotsError) {
      logger.error('[api/persona/delete-preview] slot lookup failed', slotsError);
      return apiErrorResponse(500, 'Failed to load delete preview.', {
        route: ROUTE,
        code: ERROR_CODES.INTERNAL_ERROR,
      });
    }
    upcomingSlots = slotsCount ?? 0;
  }

  const generations = (generationsListRes.data ?? [])
    .map(asGenerationRow)
    .filter((row): row is GenerationRow => row !== null);
  const totalGenerations = generationsCountRes.count ?? 0;

  // Sequential on purpose: one small JSON body in flight at a time, and a
  // slow engine cannot fan out into dozens of concurrent lookups. The list
  // query is already limited to PREVIEW_VIDEO_CAP rows.
  const baseUrl = process.env.MONEYPRINT_API_URL;
  if (!baseUrl) {
    logger.warn('[api/persona/delete-preview] MONEYPRINT_API_URL is not set; download links unavailable');
  }
  const lookupStart = Date.now();
  let linksIncomplete = false;
  const videos: Array<{
    taskId: string | null;
    topic: string | null;
    status: string;
    downloadUrl: string | null;
  }> = [];
  for (const gen of generations) {
    let downloadUrl: string | null = null;
    if (gen.status === 'completed' && gen.engine_task_id && baseUrl) {
      if (Date.now() - lookupStart < PREVIEW_LOOKUP_BUDGET_MS) {
        const lookup = await resolveDownloadUrl(gen.engine_task_id, auth.userId, baseUrl);
        downloadUrl = lookup.url;
        // A transient failure is not "unavailable": the video may still
        // exist, so flag it for the retry note instead of the dead-end copy.
        if (lookup.transientFailure) linksIncomplete = true;
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
      id: typeof persona.id === 'string' ? persona.id : '',
      name: typeof persona.name === 'string' ? persona.name : '',
    },
    counts: {
      schedules: scheduleIds.length,
      upcomingSlots,
      generatedVideos: totalGenerations,
      personaImages: imagesCountRes.count ?? 0,
    },
    videos,
    videosTruncated: totalGenerations > videos.length,
    linksIncomplete,
  });
}
