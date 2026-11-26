import { NextResponse } from 'next/server';
import { requireSupabaseSession } from '@/lib/request-auth';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { createSupabaseServiceClient } from '@/lib/supabase/service';
import { apiErrorResponse } from '@/lib/api-error';
import { applyRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import { getSlotPost, personaScopeOf } from '@/lib/post-detail';
import { resolveSlotUuid } from '@/lib/schedule-slot-id';
import { logger } from '@/lib/logger';
import { withApiErrorReporting, resolveReportingUserId } from '@/lib/api-error-reporting';

async function getHandler(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { auth, error: authError } = await requireSupabaseSession(request);
  if (authError || !auth) return authError;
  const limited = await applyRateLimit(request, RATE_LIMITS.postDetail, auth.userId);
  if (limited) return limited;
  const supabase =
    auth.isApiKey === true || auth.isOAuth === true
      ? createSupabaseServiceClient()
      : await createSupabaseServerClient();

  const { id } = await context.params;
  const personaScope = personaScopeOf(auth);

  try {
    const slotUuid = resolveSlotUuid(id);
    const slotDetail = slotUuid === null ? null : await getSlotPost(supabase, slotUuid, auth.userId, personaScope);
    if (slotDetail) {
      return NextResponse.json({ success: true, ...slotDetail });
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

export const GET = withApiErrorReporting('GET /api/posts/[id]', getHandler, {
  reportSuccess: false,
  getUserId: resolveReportingUserId,
});
