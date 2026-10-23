import { NextResponse } from 'next/server';
import { requireSupabaseSession } from '@/lib/request-auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { apiErrorResponse } from '@/lib/api-error';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { getGenerationPost, getSlotPost, personaScopeOf } from '@/lib/post-detail';
import { resolveSlotUuid } from '@/lib/schedule-slot-id';
import { logger } from '@/lib/logger';
import { withApiErrorReporting, resolveReportingUserId } from '@/lib/api-error-reporting';

//---------------
// GET /api/posts/[id] — one post's full detail, whichever kind of post the
// id is: a scheduled slot (scheduled_posts id) or a direct video generation
// (video_generations generation_id). The detail page calls this single
// endpoint instead of guessing between the slot and generation endpoints
// (issue #208) — the expected 404 from the wrong guess is gone, so every
// 404 here is a genuine miss and still warns.
//
// Both shapes carry live progress: slots via the shared enrichSlot helper,
// generations via the engine task while still running (VideoGeneration had
// no progress field before — the unified read adds it).
//---------------
async function getHandler(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) return authError;
  // The detail fans out to the engine for live progress — rate-limit like
  // the other expensive surfaces.
  const limited = await applyRateLimit(request, RATE_LIMITS.postDetail, auth.userId);
  if (limited) return limited;
  const supabase =
    auth.isApiKey === true || auth.isOAuth === true
      ? createSupabaseServiceClient()
      : await createSupabaseServerClient();

  const { id } = await context.params;
  // A persona-scoped API key reads only its personas' (and persona-less)
  // posts; an out-of-scope post is a 404 like any unknown id.
  const personaScope = personaScopeOf(auth);

  try {
    // generation_id is text (a direct id, or `batch:<scheduleId>:slot:<slotId>`),
    // so this lookup is safe with the raw param. scheduled_posts.id is uuid:
    // a batch key, a percent-encoded key, or garbage must be normalized
    // first. Feeding any of those into the uuid filter raises Postgres
    // 22P02 and the catch below would turn it into a 500 (issue #201).
    const generation = await getGenerationPost(supabase, id, auth.userId, personaScope);
    if (generation) {
      return NextResponse.json({ success: true, kind: 'generation', generation });
    }
    const slotUuid = resolveSlotUuid(id);
    const slotDetail = slotUuid === null ? null : await getSlotPost(supabase, slotUuid, auth.userId, personaScope);
    if (slotDetail) {
      return NextResponse.json({ success: true, kind: 'slot', ...slotDetail });
    }
  } catch (error) {
    logger.error('[api/posts] post detail lookup failed', error, { id });
    return apiErrorResponse(500, 'Failed to load post.', {
      route: 'GET /api/posts/[id]',
      cause: error,
    });
  }
  return apiErrorResponse(404, 'Post not found.', { route: 'GET /api/posts/[id]' });
}

//---------------
// 5xx reporting: handled server errors reach PostHog error tracking.
// A 404 here is always a genuine miss (no more guessing between two
// endpoints), so it keeps warning.
//---------------
export const GET = withApiErrorReporting('GET /api/posts/[id]', getHandler, { getUserId: resolveReportingUserId });
